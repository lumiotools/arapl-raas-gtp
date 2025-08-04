import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, MoreThan, Not, OneToOne, Repository } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom, last, min, take } from 'rxjs';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OrderItem, OrderItemStatus } from 'src/entities/order-item.entity';
import { Task, TaskType, TaskStatus, MOVE_TYPE } from 'src/entities/task.entity';
import { Batch, BatchStatus } from 'src/entities/batch.entity';
import { Inventory } from 'src/entities/inventory.entity';
import { Station, LocationStatus } from 'src/entities/station.entity';
import { WaitingLocation, WaitingLocationType } from 'src/entities/waiting-location.entity';
import { GtpLocation } from 'src/entities/gtp-location.entity';
import { ProductRequirement as ProductRequirementEntity } from 'src/entities/product-requirement.entity';
import { Location, LocationType, LocationAction, LocationDimension, LocationAttribute } from 'src/entities/location.entity';
import { Wait, WaitType, WaitStatus, FallbackAction } from 'src/entities/wait.entity';
import { Cargo, CargoDimension, CargoAttribute } from 'src/entities/cargo.entity';
import { InventoryService } from '../inventory/inventory.service';
import { LoggingService } from '../../services/logging.service';
import { MessageCode } from '../trigger/trigger.controller';
import { StationsService } from '../stations/stations.service';
import {config} from 'dotenv';
import { ScheduleMapping } from 'src/entities/schedule_mapping.entity';

/**
 * OrchestratorService - Robust event-driven warehouse orchestration logic
 * 
 * KEY FEATURES:
 * 1. Optimal Inventory Selection: Prefers single inventory, processes all available if insufficient
 * 2. Event-Driven Task Sequencing: Based on ProductRequirement and real-time station availability  
 * 3. FIFO Station Requests: First-requesting task gets the station when it becomes available
 * 4. Partial Quantity Handling: Tasks drop required quantities at stations, carry remaining to next stations
 * 5. Inventory Return & Update: When tasks return to inventory, quantities are restored to inventory
 * 6. Comprehensive Edge Case Handling: All waiting locations full, insufficient inventory, race conditions
 * 
 * WORKFLOW:
 * - Inventory → Station: Drop required quantity, continue with remaining quantity to next station
 * - Station → Station: Continue workflow with remaining quantity after drop
 * - Station → Waiting Location: When required stations are busy
 * - Waiting Location → Station: When station becomes available (webhook-driven)
 * - Station/Waiting Location → Inventory: Return remaining quantity and update inventory
 * 
 * TASK COMPLETION EVENTS:
 * - Station tasks: TRIGGERED → handleTaskCompletion() → create next task with remaining quantity
 * - Waiting location tasks: COMPLETED → handleWaitingLocationTaskCompletion() → continue to next station
 * - Inventory return tasks: COMPLETED → handleInventoryReturnTaskCompletion() → update inventory quantities
 */

interface ProductRequirement {
  productId: string;
  totalRequirement: number;
  stationRequirements: Map<string, number>;
}

@Injectable()
export class OrchestratorService {
  private readonly logger = new Logger(OrchestratorService.name);

  private orchestratorWorking = false;

  constructor(
    @InjectRepository(OrderItem)
    private readonly orderItemRepository: Repository<OrderItem>,
    @InjectRepository(Task)
    private readonly taskRepository: Repository<Task>,
    @InjectRepository(Batch)
    private readonly batchRepository: Repository<Batch>,
    @InjectRepository(Inventory)
    private readonly inventoryRepository: Repository<Inventory>,
    @InjectRepository(Station)
    private readonly stationRepository: Repository<Station>,
    @InjectRepository(WaitingLocation)
    private readonly waitingLocationRepository: Repository<WaitingLocation>,
    @InjectRepository(GtpLocation)
    private readonly gtpLocationRepository: Repository<GtpLocation>,
    @InjectRepository(ProductRequirementEntity)
    private readonly productRequirementRepository: Repository<ProductRequirementEntity>,
    @InjectRepository(ScheduleMapping)
    private readonly scheduleMappingRepository: Repository<ScheduleMapping>,
    private readonly inventoryService: InventoryService,
    private readonly httpService: HttpService,
    private readonly loggingService: LoggingService,
    private readonly stationService: StationsService
  ) {}

  async processAssignedOrderItems() {
    try {
      // Step 3 & 4: Calculate product requirements and sort by descending order
      let productRequirements: ProductRequirement[];
      productRequirements = await this.loadProductRequirementsFromDatabase();
      // first check waiting locations for this product.
      const waitingLocations = await this.waitingLocationRepository.find({
        where: {
          status: LocationStatus.OCCUPIED,
        }
      });
      console.log(`waiting locations: ${JSON.stringify(waitingLocations)}`);
      if (waitingLocations.length > 0) {
        // this.logger.log(`Found ${waitingLocations.length} waiting locations with tasks holded by product ${productId}`);
        for (const waitingLocation of waitingLocations) {
          const taskId = waitingLocation.holded_by;
          if (!taskId){continue;}
          const task = await this.taskRepository.findOne({where: { task_id: taskId }});
          if (!task){continue;}

          // Check if this task's product is in the current requirements
          const hasRequirement = productRequirements.some(req => req.productId === task.product_id);
          // check if the product requirement is paused
          const productIsPaused = await this.productRequirementRepository.findOne({where: { product_id: task.product_id, isPaused: true }});
          // the product at waiting location has no requirement and it is not paused as well - return to inventory.
          if (!hasRequirement && !productIsPaused) {
            // find first task of the batch
            const firstTaskInBatch = await this.taskRepository.findOne({where: { batch_id: task.batch_id, sequence_order: 1 }});
            if (!firstTaskInBatch) {continue;} // first task is not present - skip this task
            // Check if this batch already has a return to inventory task (skip if yes)
            const existingReturnTask = await this.taskRepository
              .createQueryBuilder('task')
              .where('task.batch_id = :batchId', { batchId: task.batch_id })
              .andWhere(`task.end_location->'location_attribute'->>'attribute_value' = :attrValue`, { attrValue: 'inventory' })
              .getOne();
            if (existingReturnTask) {continue;}

            const originalInventoryId = firstTaskInBatch.start_location.location_id;
            const [returnTaskId, returnTask]= await this.createTask({
              batchId: task.batch_id,
              productId: task.product_id,
              sourceWaitingLocationId: waitingLocation.location_id,
              destinationInventoryId: originalInventoryId,
              quantity: task.quantity,
              taskType: TaskType.GOODS_TO_PERSON,
              move_type: MOVE_TYPE.WAITING_LOCATION_TO_INVENTORY,
              sequenceOrder: task.sequence_order + 1, // Next sequence order
              taskDependency: task.task_id // Use last task of batch as dependency
            });

            console.log(`returnTask: ${returnTask?.task_id}`);
            
            if (returnTask) {
              const inventory = await this.inventoryRepository.findOne({where: { id: originalInventoryId }});
              if (inventory) {
                inventory.status = LocationStatus.RESERVED;
                await this.inventoryRepository.save(inventory);
              }
              // send this task to WMS
              await this.sendSingleTaskToWms(returnTask);
              this.logger.log(`New Task: ${returnTaskId}, Product ID: ${task.product_id}, quantity: ${task.quantity}, start location: ${waitingLocation.location_id} (waiting location), destination location: ${originalInventoryId} (inventory)`);
              await this.loggingService.log(`New Task: ${returnTaskId}, Product ID: ${task.product_id}, quantity: ${task.quantity}, start location: ${waitingLocation.location_id} (waiting location), destination location: ${originalInventoryId} (inventory)`);
            }
            continue;
          }
          else if (hasRequirement) {
            const productId = task.product_id; // take product ID from the task (which is at waiting location)
            // find all product requirements for this product that is not paused
            const databaseRequirement = await this.productRequirementRepository.find({
              where : { product_id: productId , isPaused: false},
              order: { station_id: 'ASC' }
            });
            const stationIds = databaseRequirement.map(pr => pr.station_id);// get all station IDs from the requirements
            const sortedStations = await this.getStationsSortedByPriority(stationIds);// sort stations by priority
            for (const stat in sortedStations){
              const stationID = sortedStations[stat].station_id;
              const station = await  this.stationRepository.findOne({where: { station_id: stationID }});
              if (!station){continue;}
              if (station.status === LocationStatus.AVAILABLE) { // check if station is available
                const batchId = task.batch_id || await this.generateBatchId();
                const [returnTaskId, returnTask] = await this.createTask({
                  batchId,
                  productId,
                  sourceWaitingLocationId: waitingLocation.location_id,
                  destinationStationId: station.station_id,
                  quantity: task.quantity,
                  taskType: TaskType.GOODS_TO_PERSON,
                  move_type: MOVE_TYPE.WAITING_LOCATION_TO_STATION,
                  sequenceOrder: task.sequence_order + 1, // Next sequence order
                  taskDependency: task.task_id // Use last task of batch as dependency
                });
                if (!returnTask) {continue;}
                await this.reserveStationAndSendTask(returnTask, station); // Reserve the station and send task to WMS
                this.logger.log(`New Task: ${returnTaskId}, Product ID: ${productId}, quantity: ${task.quantity}, start location: ${waitingLocation.location_id} (waiting location), destination location: ${station.station_id} (station)`);
                await this.loggingService.log(`New Task: ${returnTaskId}, Product ID: ${productId}, quantity: ${task.quantity}, start location: ${waitingLocation.location_id} (waiting location), destination location: ${station.station_id} (station)`);
                break; // Exit loop after processing first available station
              }
            }
          }
        }
      }
      for (const requirement of productRequirements) {
        await this.processProductRequirement(requirement.productId, productRequirements);
      }
      return { message: 'Orchestrator process completed successfully' };
      
    } catch (error) {
      return { message: 'Orchestrator process completed', error: error.message };
    }
  }

  private async getAndUpdateAssignedItems(): Promise<OrderItem[]> {
    const assignedItems = await this.orderItemRepository.find({
      where: { status: OrderItemStatus.ASSIGNED },
      relations: ['assignedGtpLocation', 'assignedGtpLocation.station']
    });

    // Update status to IN_PROGRESS
    if (assignedItems.length > 0) {
      await this.orderItemRepository.update(
        { status: OrderItemStatus.ASSIGNED },
        { status: OrderItemStatus.IN_PROGRESS }
      );
    }

    return assignedItems;
  }

  private async calculateProductRequirements(orderItems: OrderItem[]): Promise<ProductRequirement[]> {
    const requirementMap = new Map<string, ProductRequirement>();

    for (const item of orderItems) {
      const productId = item.product_id;
      const stationId = item.assignedGtpLocation?.station_id;
      
      if (!stationId) {
        this.logger.warn(`Order item ${item.order_item_id} has no station assigned`);
        continue;
      }

      if (!requirementMap.has(productId)) {
        requirementMap.set(productId, {
          productId,
          totalRequirement: 0,
          stationRequirements: new Map<string, number>()
        });
      }

      const requirement = requirementMap.get(productId)!;
      requirement.totalRequirement += item.quantity;
      
      const currentStationReq = requirement.stationRequirements.get(stationId) || 0;
      requirement.stationRequirements.set(stationId, currentStationReq + item.quantity);
    }

    // Save requirements to database
    await this.saveProductRequirementsToDatabase(requirementMap);

    // Sort by descending total requirement
    return Array.from(requirementMap.values()).sort(
      (a, b) => b.totalRequirement - a.totalRequirement
    );
  }

  private async saveProductRequirementsToDatabase(requirementMap: Map<string, ProductRequirement>): Promise<void> {
    this.logger.log('Saving product requirements to database...');
    
    for (const [productId, requirement] of requirementMap) {
      for (const [stationId, requirementQuantity] of requirement.stationRequirements) {
        // Check if requirement already exists
        const existingRequirement = await this.productRequirementRepository.findOne({
          where: { product_id: productId, station_id: stationId }
        });

        if (existingRequirement) {
          // Update existing requirement
          await this.productRequirementRepository.update(
            { product_id: productId, station_id: stationId },
            { requirement: requirementQuantity + existingRequirement.requirement }
          );
          this.logger.log(`Updated requirement: Product ${productId} at Station ${stationId} = ${requirementQuantity}`);
        } else {
          // Create new requirement
          const newRequirement = this.productRequirementRepository.create({
            product_id: productId,
            station_id: stationId,
            requirement: requirementQuantity
          });
          await this.productRequirementRepository.save(newRequirement);
          this.logger.log(`Created requirement: Product ${productId} at Station ${stationId} = ${requirementQuantity}`);
        }
      }
    }
  }

  private async processProductRequirement(productId: string, productRequirements: ProductRequirement[]) {
    const allInventories = await this.inventoryService.findAllByProductId(productId);
    if (!allInventories || allInventories.length === 0) {return;}

    // read the requirement of the product from the database
    const databaseRequirement = await this.productRequirementRepository.find({
      where : { product_id: productId , isPaused: false, isCancelled: false },
      order: { station_id: 'ASC' }
    });
    let effectiveSystemRequirement = databaseRequirement.reduce((sum, req) => sum + req.requirement, 0);
    for (const inventory of allInventories) {
      if (inventory.isProcessing){
        effectiveSystemRequirement -= (inventory.quantity - inventory.defective_quantity - inventory.missing_quantity);
      }
    }

    // filter inventories - status - available and quantity-def-missing > 0 and isProcessing = false
    const filteredInventories = allInventories.filter(inv => 
      inv.status === LocationStatus.AVAILABLE && inv.quantity - inv.defective_quantity - inv.missing_quantity > 0 && !inv.isProcessing
    );

    const selectedInventories = this.selectOptimalInventories(filteredInventories, effectiveSystemRequirement);

    // Get stations sorted by priority (ascending order) 
    const stationIds = databaseRequirement.map(pr => pr.station_id);
    const sortedStations = await this.getStationsSortedByPriority(stationIds);
    if (effectiveSystemRequirement <= 0) {return;}

    if (selectedInventories.length === 0) {return;}

    for (const inventory of selectedInventories) {
      const taskID = await this.createSingleTaskToFirstAvailableStation(
        inventory,
        sortedStations
      );
      if (!taskID){
        const inventory_to_station_waiting_location = await this.waitingLocationRepository.find({
          where: { type: WaitingLocationType.INVENTORY_TO_STATION, is_active:true, status: LocationStatus.AVAILABLE}
        });
        for (const waitingLocation of inventory_to_station_waiting_location) {
          if (waitingLocation.status !== LocationStatus.AVAILABLE || waitingLocation.holded_by !== null) {continue;} // a task is already holded by this waiting location
          const batchId = await this.generateBatchId();
          await this.createBatch(batchId, inventory, inventory.product_id);
          const [returnTaskId, returnTask] = await this.createTask({
            batchId,
            productId: inventory.product_id,
            sourceInventoryId: inventory.id,
            destinationWaitingLocationId: waitingLocation.location_id,
            quantity: inventory.quantity,
            taskType: TaskType.GOODS_TO_PERSON,
            move_type: MOVE_TYPE.INVENTORY_TO_WAITING_LOCATION,
            sequenceOrder: 1, // First task in this batch
            taskDependency: null // No dependency for first task
          });
          waitingLocation.status = LocationStatus.RESERVED;
          waitingLocation.holded_by = returnTaskId;
          await this.waitingLocationRepository.save(waitingLocation);
          if (returnTask) {
            inventory.isProcessing = true;
            inventory.status = LocationStatus.RESERVED;
            await this.inventoryRepository.save(inventory);
            
            // Send task to WMS
            await this.sendSingleTaskToWms(returnTask);
            this.logger.log(`New Task: ${returnTaskId}, Product ID: ${inventory.product_id}, quantity: ${inventory.quantity}, start location: ${inventory.id} (inventory), destination location: ${waitingLocation.location_id} (waiting location)`);
            await this.loggingService.log(`New Task: ${returnTaskId}, Product ID: ${inventory.product_id}, quantity: ${inventory.quantity}, start location: ${inventory.id} (inventory), destination location: ${waitingLocation.location_id} (waiting location)`);
            break;
          } else {
            this.logger.error(`Failed to create return task for product ${inventory.product_id} from inventory ${inventory.id} to waiting location ${waitingLocation.location_id}`);
          }
        }
      }
    }
  }

  /**
   * Select the minimum combination of inventories to satisfy the total requirement.
   * Prefers single inventory if possible, otherwise finds optimal combination.
   * If insufficient inventory exists, processes ALL available inventories.
   */
  private selectOptimalInventories(inventories: Inventory[], totalRequired: number): Inventory[] {
    // Sort inventories by quantity descending (prefer larger inventories first)
    const sortedInventories = [...inventories].sort((a, b) => (b.quantity-b.defective_quantity-b.missing_quantity) - (a.quantity-a.defective_quantity-a.missing_quantity));
    
    // Calculate total available inventory quantity
    const totalAvailable = sortedInventories.reduce((sum, inv) => sum + inv.quantity - inv.defective_quantity - inv.missing_quantity, 0);

    // First, check if any single inventory can satisfy the entire requirement
    const singleInventory = sortedInventories.find(inv => inv.quantity - inv.defective_quantity - inv.missing_quantity >= totalRequired);
    if (singleInventory) {return [singleInventory];}

    // Check if we have sufficient total inventory
    if (totalAvailable < totalRequired) {
      // Return ALL inventories to fulfill as much as possible
      const allValidInventories = sortedInventories.filter(inv => inv.quantity - inv.defective_quantity - inv.missing_quantity > 0 && !inv.isProcessing);
      return allValidInventories;
    }
    const selected: Inventory[] = [];
    let remainingRequired = totalRequired;
    for (const inventory of sortedInventories) {
      if (remainingRequired <= 0) break;
      if (inventory.quantity - inventory.defective_quantity - inventory.missing_quantity > 0) {
        selected.push(inventory);
        remainingRequired -= (inventory.quantity - inventory.defective_quantity - inventory.missing_quantity);
      }
    }

    return selected;
  }

  private async getStationsSortedByPriority(stationIds: string[]): Promise<Station[]> {
    const stations = await this.stationRepository.find({
      where: stationIds.map(id => ({ station_id: id }))
    });

    // Sort by priority in ascending order (lower priority number = higher priority)
    return stations.sort((a, b) => a.priority - b.priority);
  }



  /**
   * Create a single task to the first available station in priority order.
   * If no station is available, create station requests for all required stations.
   */
  private async createSingleTaskToFirstAvailableStation(
    inventory: Inventory,
    sortedStations: Station[]
  ): Promise<number | null> {
    // Find the first available station in priority order
    let targetStation: Station | null = null;
    
    for (const station of sortedStations) {
      // Check if the station is available (not RESERVED or OCCUPIED)
      const station_id = station.station_id;
      const fetchStation = await this.stationRepository.findOne({
        where: { station_id },
      });
      if (fetchStation && fetchStation.status === LocationStatus.AVAILABLE) {
        targetStation = fetchStation;
        break; // Take the first available station, don't skip to lower priority
      }
    }

    if (targetStation) {
      // Station is available - create task immediately
      const batchId = await this.generateBatchId();
      await this.createBatch(batchId, inventory, inventory.product_id);
      const [taskId,task] = await this.createTask({
        batchId,
        productId: inventory.product_id,
        sourceInventoryId: inventory.id,
        destinationStationId: targetStation.station_id,
        quantity: inventory.quantity, // Move entire available quantity
        taskType: TaskType.GOODS_TO_PERSON,
        move_type: MOVE_TYPE.INVENTORY_TO_STATION,
        sequenceOrder: 1, // First (and only) task in this batch
        taskDependency: null // May depend on previous batch
      });
      if (task) {
        // reserve the inventory location
        inventory.isProcessing = true;
        inventory.status = LocationStatus.RESERVED;
        await this.inventoryRepository.save(inventory);
        await this.reserveStationAndSendTask(task, targetStation); 
      }
      this.logger.log(`New Task: ${taskId}, Product ID: ${inventory.product_id}, quantity: ${inventory.quantity}, start location: ${inventory.id} (inventory), destination location: ${targetStation.station_id} (station)`);
      await this.loggingService.log(`New Task: ${taskId}, Product ID: ${inventory.product_id}, quantity: ${task?.quantity}, start location: ${inventory.id} (inventory), destination location: ${targetStation.station_id} (station)`);
      return taskId;
    } else {
      // No station is available - create task without station and add station request for first required station only
      // this.logger.warn(`No available stations found for (inventory ${inventory.id}) - skipping task creation`);
      return null;
    }
  }

  private async createTask(taskData: {
    batchId: string;
    productId: string;
    sourceInventoryId?: string;
    sourceStationId?: string;
    sourceWaitingLocationId?: string;
    destinationStationId?: string;
    destinationInventoryId?: string;
    destinationWaitingLocationId?: string;
    quantity: number;
    taskType: TaskType;
    move_type:MOVE_TYPE;
    sequenceOrder: number;
    taskDependency?: number | null;
  }): Promise<[number, Task | null]> {
    // Create start location
    const startLocation = this.createLocation(
      taskData.sourceInventoryId || taskData.sourceStationId || taskData.sourceWaitingLocationId!,
      taskData.sourceInventoryId ? 'inventory' : taskData.sourceStationId ? 'station' : 'waiting_location',
      this.getLocationAction(taskData, 'start')
    );

    // Create end location
    const endLocation = this.createLocation(
      taskData.destinationInventoryId || taskData.destinationStationId || taskData.destinationWaitingLocationId!,
      taskData.destinationInventoryId ? 'inventory' : taskData.destinationStationId ? 'station' : 'waiting_location',
      this.getLocationAction(taskData, 'end')
    );

    // Create wait object
    const waitObject = this.createWaitObject();

    // Create cargos array
    const cargosArray = this.createCargoArray(taskData.productId);

    const task = this.taskRepository.create({
      batch_id: taskData.batchId,
      product_id: taskData.productId,
      quantity: taskData.quantity,
      task_type: taskData.taskType,
      sequence_order: taskData.sequenceOrder,
      task_dependency: taskData.taskDependency || undefined,
      status: TaskStatus.PENDING,
      start_location: startLocation,
      end_location: endLocation,
      move_type: taskData.move_type,
      wait: waitObject,
      cargos: cargosArray
    });

    const savedTask = await this.taskRepository.save(task);
    this.logger.log(`Created task ${savedTask.task_id}: ${taskData.taskType} - ${taskData.quantity} units of ${taskData.productId}${taskData.taskDependency ? ` (depends on task ${taskData.taskDependency})` : ''}`);

    await this.batchRepository.increment(
      { batch_id: taskData.batchId },
      'total_tasks',
      1
    );
    
    return [savedTask.task_id, savedTask];
  }

  private createLocation(
    locationId: string,
    locationType: 'inventory' | 'station' | 'waiting_location',
    locationAction: LocationAction
  ): Location {
    return {
      location_id: locationId,
      location_type: LocationType.ZONE,
      location_action: locationAction,
      location_dimension: { length: 1, height: 1, width: 1 },
      location_attribute: { 
        attribute_name: 'location_type',
        attribute_value: locationType
      }
    };
  }

  private createWaitObject(): Wait {
    return {
      wait_type: WaitType.TRIGGER
    };
  }

  private createCargoArray(productId: string): Cargo[] {
    return [{
      cargo_code: productId,
      cargo_type: 'Pallet',
      cargo_dimension: { length: 1, width: 1, height: 1 },
      cargo_attributes: null,
      cargo_weight: 1
    }];
  }

  private getLocationAction(taskData: any, position: 'start' | 'end'): LocationAction {
    const isInventoryToStation = taskData.sourceInventoryId && taskData.destinationStationId;
    const isStationToStation = taskData.sourceStationId && taskData.destinationStationId;
    const isStationToInventory = taskData.sourceStationId && taskData.destinationInventoryId;
    const isStationToWaiting = taskData.sourceStationId && taskData.destinationWaitingLocationId;
    const isWaitingToStation = taskData.sourceWaitingLocationId && taskData.destinationStationId;

    if (isInventoryToStation || isWaitingToStation) {
      return position === 'start' ? LocationAction.PICK : LocationAction.WAIT;
    } else if (isStationToStation || isStationToWaiting) {
      return position === 'start' ? LocationAction.PICK : LocationAction.WAIT;
    } else if (isStationToInventory) {
      return position === 'start' ? LocationAction.PICK : LocationAction.DROP;
    }

    // Default fallback
    return LocationAction.NOP;
  }

  private async generateBatchId(): Promise<string> {
    const timestamp = Date.now();
    return `B${timestamp.toString().slice(-10)}`;
  }

  private async createBatch(batchId: string, inventory: Inventory, productId: string) {
    const description = `Batch for inventory ${inventory.id} - Product ${productId} (Qty: ${inventory.quantity})`;

    const batch = this.batchRepository.create({
      batch_id: batchId,
      description,
      status: BatchStatus.PENDING,
      total_tasks: 0, // Will be updated as tasks are created
      completed_tasks: 0
    });

    await this.batchRepository.save(batch);
  }

  private async reserveStationAndSendTask(task: Task, station: Station): Promise<void> {
    this.logger.log(`Reserving station ${station.station_id} for task ${task.task_id}`);
    
    // Mark station as reserved and set holded_by to task ID
    await this.stationRepository.update(
      { station_id: station.station_id },
      { 
        status: LocationStatus.RESERVED,
        holded_by: task.task_id
      }
    );

    // Note: Product requirement will be removed when task completes at station

    // Send single task to WMS
    await this.sendSingleTaskToWms(task);
  }

  public async sendSingleTaskToWms(task: Task): Promise<void> {
    // Safety check: Only send tasks that are in PENDING status
    if (task.status !== TaskStatus.PENDING) {
      this.logger.warn(`Task ${task.task_id} is not in PENDING status (current: ${task.status}) - skipping WMS send`);
      return;
    }

    try {
      const requestBody = {
        tasks: [{
          task_id: task.task_id.toString(),
          task_type: task.task_type,
          task_dependency: task.task_dependency?.toString() || null,
          start_location: task.start_location,
          end_location: task.end_location,
          wait: task.wait,
          cargos: task.cargos
        }]
      };
      const warehouse_name = process.env.WMS_WAREHOUSE_NAME || 'warehouse';
      const warehosue_key = process.env.WMS_WAREHOUSE_AUTH_kEY || 'test';
      const wms_base_url = process.env.WMS_BASE_URL || 'http://localhost:3030/robot-job';  

      const response = await firstValueFrom(
        this.httpService.post(`${wms_base_url}/robot-job/${warehouse_name}/tasks`, requestBody, {
          headers: {
            'authorization': `${warehosue_key}`,
            'Content-Type': 'application/json'
          }
        })
      );

      // Mark task as sent to prevent duplicate sending
      await this.taskRepository.update(
        { task_id: task.task_id },
        { status: TaskStatus.ASSIGNED }
      );

      this.logger.log(`Successfully sent task ${task.task_id} to WMS API layer and marked as ASSIGNED`);
      
    } catch (error) {
      this.logger.error(`Failed to send task ${task.task_id} to WMS API layer:`, error.message);
      if (error.response) {
        this.logger.error(`Response status: ${error.response.status}`);
        this.logger.error(`Response data:`, error.response.data);
      }
    }
  }

  // Method to be called from trigger when a task completes at a station
  async handleTaskCompletion(completedTask: Task, isSkipOperation: boolean = false , dropped_quantity: number, message_code: MessageCode): Promise<void> {
    if (completedTask.status !== TaskStatus.TRIGERRED) {return;}

    const operationType = isSkipOperation ? 'skip' : 'normal completion';
    this.logger.log(`Handling task ${operationType} for task ${completedTask.task_id} at station - TRIGGERED is the final state`);
    
    try {
      // DUPLICATE PREVENTION: Check if a next task already exists with this task as dependency
      const existingNextTask = await this.taskRepository.findOne({
        where: { 
          task_dependency: completedTask.task_id,
          batch_id: completedTask.batch_id
        }
      });
      if (existingNextTask) {return;}
      let back_to_inventory : boolean = false;
      let remainingQuantity: number;
      let droppedQuantity: number;

      if (isSkipOperation) {
        // For skip operations: preserve full quantity, no drops, no product requirement updates
        remainingQuantity = completedTask.quantity - dropped_quantity;
        droppedQuantity = dropped_quantity;
        this.logger.log(`⏩ Skip operation: preserving full quantity ${remainingQuantity} - no drops at station`);
        await this.loggingService.log(`Skip task ${completedTask.task_id}: preserved quantity ${remainingQuantity}, no product requirements updated`);
      } else {
        // For normal completion: calculate dropped quantity and update requirements
        
        remainingQuantity = completedTask.quantity - dropped_quantity;
        if (message_code == MessageCode.DEFECTIVE_PRODUCT) {
          back_to_inventory = true;
        }
        if (message_code == MessageCode.INSUFFICIENT_QUANTITY) {
          back_to_inventory = true;
        }
        droppedQuantity = dropped_quantity

        // Update inventory quantity (reduce by dropped amount)
        const firstTask = await this.taskRepository.findOne({
          where: {
            batch_id: completedTask.batch_id,
            sequence_order: 1
          }
        });
        const inventoryId = firstTask?.start_location?.location_id || completedTask.start_location?.location_id;
        const inventory = await this.inventoryRepository.findOne({
          where: { id: inventoryId }
        });
        if (!inventory) {return;}
        inventory.quantity -= droppedQuantity;
        if (message_code == MessageCode.DEFECTIVE_PRODUCT) {
          inventory.defective_quantity = remainingQuantity;
        }
        if (message_code == MessageCode.INSUFFICIENT_QUANTITY) {
          inventory.missing_quantity = remainingQuantity;
        }
        await this.inventoryRepository.save(inventory);

        // Remove the fulfilled product requirement from database (quantity has been dropped at this station)
        const currentStationId = completedTask.end_location.location_id;
        await this.removeProductRequirement(completedTask.product_id, currentStationId, droppedQuantity, message_code);
        
        this.logger.log(`📦 Normal completion: dropped ${droppedQuantity} units, remaining ${remainingQuantity} units`);
      }
      
      if (remainingQuantity > 0 && !back_to_inventory) {
        const remainingRequirements = await this.getRemainingProductRequirements(
          completedTask.product_id,
          completedTask.batch_id
        );
        if (remainingRequirements.length > 0) {
          await this.createNextStationTask(completedTask, remainingRequirements, remainingQuantity);
        } else {
          await this.createReturnToInventoryTask(completedTask, remainingQuantity);
        }
      } else if (remainingQuantity > 0 && back_to_inventory) {
        await this.createReturnToInventoryTask(completedTask, remainingQuantity);
      } else {
        await this.createReturnToInventoryTask(completedTask, 0);
      }

      this.logger.log(`Task ${completedTask.task_id} processing completed - TRIGGERED remains as final state`);

      // Check if batch is completed (TRIGERRED tasks count as completed for batch purposes)
      await this.checkAndUpdateBatchCompletion(completedTask.batch_id);
    } catch (error) {
      this.logger.error(`Error processing next task for ${completedTask.task_id}:`, error.message);
      throw error;
    }
  }

  /**
   * Calculate remaining quantity after dropping required amount at current station
   */
  private async calculateRemainingQuantityAfterDrop(completedTask: Task): Promise<number> {
    const currentStationId = completedTask.end_location.location_id;
    
    this.logger.log(`🔍 Calculating remaining quantity for task ${completedTask.task_id} at station ${currentStationId}`);
    this.logger.log(`📦 Task originally carried: ${completedTask.quantity} units of product ${completedTask.product_id}`);
    
    // Get the product requirement for this station
    const stationRequirement = await this.productRequirementRepository.findOne({
      where: { 
        product_id: completedTask.product_id,
        station_id: currentStationId
      }
    });

    if (!stationRequirement) {
      // No specific requirement for this station - return all quantity (no drop)
      this.logger.warn(`⚠️  No product requirement found for product ${completedTask.product_id} at station ${currentStationId} - returning full quantity`);
      return completedTask.quantity;
    }

    // Calculate remaining quantity after dropping required amount
    const requiredDrop = stationRequirement.requirement;
    const remainingQuantity = Math.max(0, completedTask.quantity - requiredDrop);
    
    this.logger.log(`📋 Station ${currentStationId} requires ${requiredDrop} units of product ${completedTask.product_id}`);
    this.logger.log(`📦 Task had ${completedTask.quantity} units → dropping ${requiredDrop} units → remaining: ${remainingQuantity} units`);
    
    return remainingQuantity;
  }

  private async getRemainingProductRequirements(productId: string, batchId: string): Promise<ProductRequirementEntity[]> {
    // Get all product requirements for this product
    const allRequirements = await this.productRequirementRepository.find({
      where: { product_id: productId , isPaused: false}
    });

    // Get stations with their priority info
    const stationIds = allRequirements.map(req => req.station_id);
    const stations = await this.stationRepository.find({
      where: stationIds.map(id => ({ station_id: id }))
    });

    // Sort requirements by station priority (ascending - lower number = higher priority)
    const sortedRequirements = allRequirements.sort((a, b) => {
      const stationA = stations.find(s => s.station_id === a.station_id);
      const stationB = stations.find(s => s.station_id === b.station_id);
      return (stationA?.priority || 999) - (stationB?.priority || 999);
    });

    return sortedRequirements;
  }

  private async createNextStationTask(completedTask: Task, remainingRequirements: ProductRequirementEntity[], remainingQuantity: number): Promise<void> {
    // Find next available station in priority order
    let nextAvailableStation: Station | null = null;
    const currentStationId = completedTask.end_location.location_id;
    const currentStationPriority = (await this.stationRepository.findOne({
      where: { station_id: currentStationId }
    }))?.priority || 999;
    for (const requirement of remainingRequirements) {
      const station = await this.stationRepository.findOne({
        where: { station_id: requirement.station_id}
      });
      if (station && (station.station_id == currentStationId || station.priority < currentStationPriority)) {
        // Skip current station
        continue;
      }
      if (station && station.status === LocationStatus.AVAILABLE) {
        nextAvailableStation = station;
        break;
      }
    }
    if (!nextAvailableStation) {
      for (const requirement of remainingRequirements) {
        const station = await this.stationRepository.findOne({
          where: { station_id: requirement.station_id }
        });
        if (station && station.station_id == currentStationId) {
          continue;
        }
        if (station && station.status === LocationStatus.AVAILABLE) {
          nextAvailableStation = station;
          break;
        }
      }
    }

    const nextSequenceOrder = completedTask.sequence_order + 1;
    
    if (nextAvailableStation) {

      // Station available - create direct task to station with remaining quantity
      const [taskId,newTask] = await this.createTask({
        batchId: completedTask.batch_id,
        productId: completedTask.product_id,
        sourceStationId: completedTask.end_location.location_id,
        destinationStationId: nextAvailableStation.station_id,
        quantity: remainingQuantity, // Use remaining quantity after previous drop
        move_type: MOVE_TYPE.STATION_TO_STATION,    
        taskType: TaskType.GOODS_TO_PERSON,
        sequenceOrder: nextSequenceOrder,
        taskDependency: completedTask.task_id
      });
      if (newTask) {
        // Update station to be held by this task
        await this.stationRepository.update(
          { station_id: nextAvailableStation.station_id },
          { holded_by: newTask.task_id , status: LocationStatus.RESERVED }
        );

        // Send task to WMS
        await this.sendSingleTaskToWms(newTask);
      }

      // Note: Product requirement will be removed when task completes at station

      this.logger.log(`Created next station task ${taskId}: station ${completedTask.end_location.location_id} → station ${nextAvailableStation.station_id} with ${remainingQuantity} units (station reserved and task sent to WMS)`);
    } else {
      await this.createWaitingLocationTask(completedTask, remainingRequirements, nextSequenceOrder, remainingQuantity);
    }
  }

  private async createWaitingLocationTask(
    completedTask: Task, 
    remainingRequirements: ProductRequirementEntity[], 
    sequenceOrder: number,
    remainingQuantity: number
  ): Promise<void> {
    // Find an available waiting location
    const availableWaitingLocation = await this.waitingLocationRepository.findOne({
      where: { status: LocationStatus.AVAILABLE, is_active: true, type: WaitingLocationType.STATION_TO_STATION },
      order: { location_id: 'ASC' } // FIFO selection
    });

    if (!availableWaitingLocation) {
      this.logger.warn(`No available waiting locations found for task ${completedTask.task_id} - cannot create waiting location task`);
      return;
    }

    // Reserve waiting location first (will be updated with actual task ID after creation)
    

    // Create task to waiting location
    const [waitingTaskId, waitingTask] = await this.createTask({
      batchId: completedTask.batch_id,
      productId: completedTask.product_id,
      sourceStationId: completedTask.end_location.location_id,
      destinationWaitingLocationId: availableWaitingLocation.location_id,
      quantity: remainingQuantity, // Use remaining quantity
      move_type: MOVE_TYPE.STATION_TO_WAITING_LOCATION,
      taskType: TaskType.GOODS_TO_PERSON,
      sequenceOrder: sequenceOrder,
      taskDependency: completedTask.task_id
    });

    await this.waitingLocationRepository.update(
      { location_id: availableWaitingLocation.location_id },
      { status: LocationStatus.RESERVED, holded_by: waitingTaskId }
    );

    if (waitingTask) {
      // Update waiting location to be held by this new task
      await this.waitingLocationRepository.update(
        { location_id: availableWaitingLocation.location_id },
        { holded_by: waitingTask.task_id }
      );

      // Send task to WMS
      await this.sendSingleTaskToWms(waitingTask);

      this.logger.log(`Created waiting location task ${waitingTaskId}: station ${completedTask.end_location.location_id} → waiting location ${availableWaitingLocation.location_id} (task sent to WMS)`);
    }
  }

  private async createReturnToInventoryTask(completedTask: Task, remainingQuantity: number): Promise<void> {
    // Get the original inventory location from the first task in this batch
    const firstTask = await this.taskRepository.findOne({
      where: { batch_id: completedTask.batch_id, sequence_order: 1 }
    });

    if (!firstTask) {return;}

    const originalInventoryId = firstTask.start_location.location_id;
    const nextSequenceOrder = completedTask.sequence_order + 1;

    const inventory = await this.inventoryRepository.findOne({
      where: { id: originalInventoryId }
    });
    if (!inventory) {return;}
    // Ensure we only create a return task if there's quantity to return
    inventory.status = LocationStatus.RESERVED;
    await this.inventoryRepository.save(inventory);

    // Create return task only if there's quantity to return or to complete the batch workflow
    const [returnTaskId, returnTask] = await this.createTask({
      batchId: completedTask.batch_id,
      productId: completedTask.product_id,
      sourceStationId: completedTask.end_location.location_id,
      destinationInventoryId: originalInventoryId,
      quantity: remainingQuantity, // Return remaining quantity
      move_type: MOVE_TYPE.STATION_TO_INVENTORY,
      taskType: TaskType.GOODS_TO_PERSON, // Always GOODS_TO_PERSON as you specified
      sequenceOrder: nextSequenceOrder,
      taskDependency: completedTask.task_id
    });
    if (returnTask) {
      await this.sendSingleTaskToWms(returnTask);
    }  
  }

  private async removeProductRequirement(productId: string, stationId: string, droppedQuantity: number, message_code: MessageCode): Promise<void> {
    try {
      this.logger.log(`Removing product requirement for Product ${productId} at Station ${stationId} - dropped quantity: ${droppedQuantity}`);
      const existingRequirement = await this.productRequirementRepository.findOne({
        where: { product_id: productId, station_id: stationId }
      });
      if (!existingRequirement) {
        this.logger.warn(`No product requirement found for Product ${productId} at Station ${stationId} - nothing to remove`);
        return;
      }
      // if (message_code == MessageCode.NOT_REQUIRED) {
      //   this.productRequirementRepository.delete({
      //     product_id: productId,
      //     station_id: stationId
      //   });
      //   return;
      // }
      existingRequirement.requirement -= droppedQuantity;
      const gtpLocations = await this.gtpLocationRepository.find({
        where: { station_id: stationId }
      });
      console.log(`GTP Locations for Station ${stationId}:`, JSON.stringify(gtpLocations, null, 2));
      for (const gtpLocation of gtpLocations) {
        const order_item = await this.orderItemRepository.findOne({
          where: { assigned_gtp_location: gtpLocation.gtp_location_id, product_id: productId, status: OrderItemStatus.IN_PROGRESS }
        });
        if (order_item && message_code == MessageCode.NOT_REQUIRED) {
          order_item.status = OrderItemStatus.COMPLETED;
          order_item.remaining_quantity = 0;
          await this.orderItemRepository.save(order_item);
        }
        console.log(`Order Item for GTP Location ${gtpLocation.gtp_location_id}:`, JSON.stringify(order_item, null, 2));
        console.log(`Order Item Product ID: ${order_item ? order_item.product_id : 'None'}`);
        if (order_item && order_item.product_id == productId) {
          console.log(`Processing Order Item ${order_item.order_item_id} for Product ${productId} at GTP Location ${gtpLocation.gtp_location_id}`);
          if (droppedQuantity >= order_item.remaining_quantity) {
            droppedQuantity -= order_item.remaining_quantity;
            order_item.status = OrderItemStatus.COMPLETED;
            // order_item.assigned_gtp_location = null;
            order_item.remaining_quantity = 0;
            await this.orderItemRepository.save(order_item);
            await this.loggingService.log(`Order ${order_item.order_id}: Product ${productId} at GTP Location ${gtpLocation.gtp_location_id} completed.`);
          }
          else{
            order_item.remaining_quantity -= droppedQuantity;
            droppedQuantity = 0;
            await this.orderItemRepository.save(order_item);
            break;
          }
          console.log(`Updated Order Item ${order_item.order_item_id} - new quantity: ${order_item.quantity}`);
        }
      }
      if (existingRequirement.requirement == 0 || message_code == MessageCode.NOT_REQUIRED) {
        const result = await this.productRequirementRepository.delete({
          product_id: productId,
          station_id: stationId
        });

        if (result.affected && result.affected > 0) {
          this.logger.log(`Removed fulfilled product requirement: Product ${productId} at Station ${stationId}`);
        } else {
          this.logger.warn(`No product requirement found to remove for Product ${productId} at Station ${stationId}`);
        }
      }
      else if (existingRequirement.requirement > 0) {
        // If requirement is still greater than 0, just update it
        await this.productRequirementRepository.save(existingRequirement);
        this.logger.log(`Updated product requirement: Product ${productId} at Station ${stationId} - remaining requirement: ${existingRequirement.requirement}`);
      }
      // const gtpLocations = await this.gtpLocationRepository.find({
      //   where: { station_id: stationId}
      // });
      // for (const gtpLocation of gtpLocations) {
      //   const order_item = await this.orderItemRepository.findOne({
      //     where: { assigned_gtp_location: gtpLocation.gtp_location_id }
      //   });
      //   if (order_item) {
      //     if (droppedQuantity >= order_item.quantity) {
      //       droppedQuantity -= order_item.quantity;
      //       order_item.status = OrderItemStatus.COMPLETED;
      //       order_item.assigned_gtp_location = null;
      //       order_item.quantity = 0;
      //       await this.orderItemRepository.save(order_item);
      //     }
      //     else{
      //       droppedQuantity = 0;
      //       order_item.quantity -= droppedQuantity;
      //       await this.orderItemRepository.save(order_item);
      //       break;
      //     }
      //   }
      // }
    } catch (error) {
      this.logger.error(`Failed to remove product requirement for Product ${productId} at Station ${stationId}:`, error);
    }
  }

  // Get all waiting locations
  async getAllWaitingLocations() {
    return await this.waitingLocationRepository.find({
      order: { location_id: 'ASC' }
    });
  }

  // Get waiting location by ID
  async getWaitingLocationById(locationId: string) {
    return await this.waitingLocationRepository.findOne({
      where: { location_id: locationId }
    });
  }

  private async freeRobot(robotId: string): Promise<void> {
    if (!robotId) {
      // await this.loggingService.log('Cannot free robot: robot_id is null or empty');
      return;
    }

    try {
      const response = await this.httpService.post(`${process.env.WMS_BASE_URL}/orchestrator/robot/set-available`, {
        robot_id: robotId
      }).toPromise();

      if (response && response.data) {
        // await this.loggingService.log(`Robot ${robotId} freed successfully: ${response.data.message || 'Robot set to available'}`);
      } else {
        // await this.loggingService.log(`Robot ${robotId} freed successfully`);
      }
    } catch (error) {
      // await this.loggingService.log(`Failed to free robot ${robotId}: ${error.message}`);
      // Don't throw error to avoid breaking the main process
    }
  }

  // Manual trigger method for testin

  @Cron('*/10 * * * * *')
  async orchestratorCronJob() {
    await this.triggerOrchestrator();
  }

  public async writeInDatabase(){
    const assignedItems = await this.getAndUpdateAssignedItems();
        
    if (assignedItems.length === 0) {
      return { message: 'No assigned order items found' };
    }
    await this.calculateProductRequirements(assignedItems);
    return { message: 'Assigned order items processed successfully'};
  }
  
  public async triggerOrchestrator() {
      if (this.orchestratorWorking) {
        this.logger.warn('Orchestrator is already running - skipping manual trigger');
        return {"message": "Service is already running, Try again in few seconds."};
      }
      try{
        this.orchestratorWorking  = true;

        await this.scheduleLPtoPickLocation();

        const cancelledStationIds = await this.stationService.getCancelledStations();

        for (const stationId of cancelledStationIds) {
          await this.stationService.removeProductRequirment(stationId);
          this.logger.log(`Processing cancelled station ${stationId}`);
          const station  =  await this.stationRepository.findOne({
            where: { station_id: stationId }
          });
          if (station) {
            const task_id = station.holded_by;
            if (task_id) {
              const lastTask = await this.taskRepository.findOne({
                where: { task_id: task_id }
              });
              const firstTask = await this.taskRepository.findOne({
                where: { batch_id: lastTask?.batch_id, sequence_order: 1 }
              });
              const inventory = await this.inventoryRepository.findOne({
                where: { id: firstTask?.start_location?.location_id}
              });
              const robotId = lastTask?.robot_id;
              if (robotId){
                await this.freeRobot(robotId);
              }
              if (firstTask && lastTask && inventory && inventory.status === LocationStatus.AVAILABLE) {
                inventory.status = LocationStatus.RESERVED;
                await this.inventoryRepository.save(inventory);
                const [newTaskID, newTask] = await this.createTask({
                  batchId: lastTask.batch_id,
                  productId: lastTask.product_id,
                  sourceStationId: station.station_id,
                  destinationInventoryId: firstTask.start_location.location_id,
                  quantity: lastTask.quantity,
                  taskType: TaskType.GOODS_TO_PERSON,
                  move_type: MOVE_TYPE.STATION_TO_INVENTORY,
                  sequenceOrder: lastTask.sequence_order + 1,
                  taskDependency: lastTask.task_id
                });
                if (!newTask){console.error(`New task ${newTaskID} not found after creation`); break;}
                await this.sendSingleTaskToWms(newTask);
                this.loggingService.log(`New Task: ${newTaskID} created for cancelled station ${stationId} - returning to inventory`);
              }
            }
          } else {
            this.logger.warn(`Station ${stationId} not found for cancellation`);
          }
        }
        
        const res = await this.processAssignedOrderItems();
        this.orchestratorWorking = false;
        
        return res;
      }
      catch (error) {
        this.orchestratorWorking = false;
        this.logger.error(`Error during orchestrator trigger: ${error.message}`);
        throw new Error(`Failed to trigger orchestrator: ${error.message}`);
      }
      finally {
        this.orchestratorWorking = false;
      }
      
    }


  async scheduleLPtoPickLocation() {
    try {

        // 1. Get all GTP locations
        const gtpLocations = await this.gtpLocationRepository.find();
        
        // Process each GTP location
        for (const gtpLocation of gtpLocations) {
            const gtpLocationId = gtpLocation.gtp_location_id;
            console.log(`Processing GTP Location ID: ${gtpLocationId}`);
            // 2. Check if this GTP location is already assigned to any order item 
            // in pending, assigned, or in_progress state
            const existingAssignment = await this.orderItemRepository.findOne({
                where: { 
                    assigned_gtp_location: gtpLocationId,
                    status: In([OrderItemStatus.PENDING, OrderItemStatus.IN_PROGRESS, OrderItemStatus.ASSIGNED])
                }
            });
            
            // If GTP location is already assigned, skip it
            if (existingAssignment) {
                continue;
            }
            console.log(`Existing Assignment: ${existingAssignment ? 'Found' : 'Not Found'} for GTP Location ID: ${gtpLocationId}`);
            
            // 3. Find all mappings for this available GTP location
            const scheduleMappings = await this.scheduleMappingRepository.find({
                where: {
                    gtp_location_id: gtpLocationId
                }
            });

            console.log(`Found ${scheduleMappings.length} schedule mappings for GTP Location ID: ${gtpLocationId}`);

            // take out all the license plate ID for schedule mappings
            const allLicensePlates = scheduleMappings.map(mapping => mapping.license_plate_id);
            const orderItemsWithLP = await this.orderItemRepository.findOne({
              where: { license_plate_id: In(allLicensePlates) },
              order: { order_item_id: 'ASC' }
            });

            // most recently included license plate ID
            const mostRecentLP = orderItemsWithLP ? orderItemsWithLP.license_plate_id : null;
            if (mostRecentLP){
              // fetch all the order_items with this license plate ID
              const orderItemsWithMostRecentLP = await this.orderItemRepository.find({
                where: { license_plate_id: mostRecentLP, assigned_gtp_location: IsNull() },
              });
              console.log(`Found ${orderItemsWithMostRecentLP.length} unassigned order items with most recent LP: ${mostRecentLP}`);
              for (const orderItem of orderItemsWithMostRecentLP) {
                // 5. Assign current GTP location to ALL order items with this LP
                // and set their status to assigned
                orderItem.assigned_gtp_location = gtpLocationId;
                orderItem.status = OrderItemStatus.ASSIGNED;
                await this.orderItemRepository.save(orderItem);
              }
              console.log(`Assigned ${orderItemsWithMostRecentLP.length} order items with LP ${mostRecentLP} to GTP ${gtpLocationId}`);
              // 6. Write in database
              await this.writeInDatabase();
              // Remove the schedule mapping since it's been used
              const scheduleToRemove = scheduleMappings.find(mapping => mapping.license_plate_id === mostRecentLP);
              if (scheduleToRemove) {
                console.log(`Removing schedule mapping for LP ${mostRecentLP} and GTP ${gtpLocationId}`);
                await this.scheduleMappingRepository.remove(scheduleToRemove);
              }
            }
        }
        
        
        
    } catch (error) {
        console.error('Error in scheduleLPtoPickLocation:', error);
        throw error;
    }
  }

  // Get batch status
  public async getBatchStatus(batchId: string) {
    return await this.batchRepository.findOne({
      where: { batch_id: batchId },
      relations: ['tasks']
    });
  }

  // Get all batches
  public async getAllBatches() {
    return await this.batchRepository.find({
      order: { created_at: 'DESC' }
    });
  }

  // Get all product requirements
  public async getAllProductRequirements() {
    return await this.productRequirementRepository.find({
      order: { product_id: 'ASC', station_id: 'ASC' }
    });
  }

  // Get product requirements by product ID
  public async getProductRequirementsByProductId(productId: string) {
    return await this.productRequirementRepository.find({
      where: { product_id: productId },
      order: { station_id: 'ASC' }
    });
  }

  // Get product requirements by station ID  
  public async getProductRequirementsByStationId(stationId: string) {
    return await this.productRequirementRepository.find({
      where: { station_id: stationId },
      order: { product_id: 'ASC' }
    });
  }

  // Get all tasks in the system
  public async getAllTasks() {
    try {
      // Get all tasks ordered by creation date (newest first)
      const tasks = await this.taskRepository.find({
        order: { created_at: 'DESC' }
      });

      return {
        success: true,
        message: `Found ${tasks.length} tasks in the system`,
        data: tasks
      };
    } catch (error) {
      this.logger.error(`Failed to get all tasks: ${error.message}`);
      throw new Error(`Failed to retrieve tasks: ${error.message}`);
    }
  }

  // Method to be called from webhook when a task completes at waiting location (requirement 2)
  async handleWaitingLocationTaskCompletion(completedTask: Task): Promise<void> {
    // Safety check: Only process completion for tasks that are actually COMPLETED
    if (completedTask.status !== TaskStatus.COMPLETED) {
      this.logger.warn(`Waiting location task ${completedTask.task_id} completion handler called but task status is ${completedTask.status} - skipping`);
      return;
    }

    this.logger.log(`Handling waiting location task completion for task ${completedTask.task_id} - webhook signaled COMPLETED`);
    
    try {
      // DUPLICATE PREVENTION: Check if a next task already exists with this task as dependency
      const existingNextTask = await this.taskRepository.findOne({
        where: { 
          task_dependency: completedTask.task_id,
          batch_id: completedTask.batch_id
        }
      });

      if (existingNextTask) {
        this.logger.warn(`⚠️  Next task ${existingNextTask.task_id} already exists with dependency on completed task ${completedTask.task_id} - skipping duplicate creation`);
        // Check if batch is completed and exit
        await this.checkAndUpdateBatchCompletion(completedTask.batch_id);
        return;
      }

      // Get remaining product requirements for this product
      const remainingRequirements = await this.getRemainingProductRequirements(
        completedTask.product_id,
        completedTask.batch_id
      );

      if (remainingRequirements.length === 0) {
        // No more stations to visit - calculate remaining quantity and return to inventory
        const remainingQuantity = await this.calculateRemainingQuantityAfterDrop(completedTask);
        await this.createReturnToInventoryTask(completedTask, remainingQuantity);
        
        // Check if batch is completed
        await this.checkAndUpdateBatchCompletion(completedTask.batch_id);
        return;
      }

    // Check available stations in priority order
    let availableStation: Station | null = null;
    
    for (const requirement of remainingRequirements) {
      const station = await this.stationRepository.findOne({
        where: { station_id: requirement.station_id }
      });

      if (station && station.status === LocationStatus.AVAILABLE) {
        availableStation = station;
        break; // Take first available station in priority order
      }
    }

    const nextSequenceOrder = completedTask.sequence_order + 1;

    if (availableStation) {
      // Station is available - reserve it and create task
      await this.stationRepository.update(
        { station_id: availableStation.station_id },
        { 
          status: LocationStatus.RESERVED,
          holded_by: null // Will be set after task creation
        }
      );

      // Calculate remaining quantity for next task (all quantity since waiting location doesn't consume any)
      const remainingQuantity = completedTask.quantity;

      // Create task from waiting location to station
      const [taskId,newTask] = await this.createTask({
        batchId: completedTask.batch_id,
        productId: completedTask.product_id,
        sourceWaitingLocationId: completedTask.end_location.location_id,
        destinationStationId: availableStation.station_id,
        quantity: remainingQuantity, // Waiting location doesn't consume quantity
        move_type: MOVE_TYPE.WAITING_LOCATION_TO_STATION, 
        taskType: TaskType.GOODS_TO_PERSON,
        sequenceOrder: nextSequenceOrder,
        taskDependency: completedTask.task_id
      });
      if (newTask) {
        // Update station to be held by this task
        await this.stationRepository.update(
          { station_id: availableStation.station_id },
          { holded_by: newTask.task_id }
        );
        // Send task to WMS
        await this.sendSingleTaskToWms(newTask);
      }

      // Note: Product requirement will be removed when task completes at station

      this.logger.log(`✅ Created task ${taskId}: waiting location ${completedTask.end_location.location_id} → station ${availableStation.station_id} (station reserved and task sent to WMS)`);
    } else {
      // skip
      // No station available - create task to first required station and add station request
      // const firstRequiredStation = remainingRequirements[0];
      
      // // Calculate remaining quantity for next task (all quantity since waiting location doesn't consume any)
      // const remainingQuantity = completedTask.quantity;
      
      // // Create task from waiting location to first required station (as placeholder)
      // const taskId = await this.createTask({
      //   batchId: completedTask.batch_id,
      //   productId: completedTask.product_id,
      //   sourceWaitingLocationId: completedTask.end_location.location_id,
      //   destinationStationId: firstRequiredStation.station_id,
      //   quantity: remainingQuantity, // Waiting location doesn't consume quantity
      //   taskType: TaskType.GOODS_TO_PERSON,
      //   sequenceOrder: nextSequenceOrder,
      //   taskDependency: completedTask.task_id
      // });

      // // Get the created task and add station request (DO NOT send to WMS yet)
      // const newTask = await this.taskRepository.findOne({
      //   where: { task_id: taskId }
      // });

      // if (newTask) {
      //   await this.addStationRequest(newTask, firstRequiredStation.station_id);
      //   this.logger.log(`✅ Created task ${taskId}: waiting location ${completedTask.end_location.location_id} → station ${firstRequiredStation.station_id} (station request added, will send to WMS when station becomes available)`);
      // }
    }

    this.logger.log(`Waiting location task ${completedTask.task_id} processing completed - COMPLETED remains as final state`);

    // Check if batch is completed
    await this.checkAndUpdateBatchCompletion(completedTask.batch_id);
    } catch (error) {
      this.logger.error(`Error processing waiting location task completion for ${completedTask.task_id}:`, error.message);
      throw error;
    }
  }

  /**
   * Handle task completion when returning to inventory - update inventory quantities
   */
  async handleInventoryReturnTaskCompletion(completedTask: Task): Promise<void> {
    // Safety check: Only process completion for tasks that are actually COMPLETED
    if (completedTask.status !== TaskStatus.COMPLETED) {
      this.logger.warn(`Inventory return task ${completedTask.task_id} completion handler called but task status is ${completedTask.status} - skipping`);
      return;
    }

    this.logger.log(`Handling inventory return task completion for task ${completedTask.task_id} - updating inventory quantities`);
    
    try {
      const inventoryId = completedTask.end_location.location_id;
      const returnedQuantity = completedTask.quantity;

      if (returnedQuantity > 0) {
        // Update inventory quantity by adding back the returned quantity
        await this.inventoryRepository.increment(
          { id: inventoryId },
          'quantity',
          returnedQuantity
        );

        this.logger.log(`✅ Updated inventory ${inventoryId}: added back ${returnedQuantity} units of product ${completedTask.product_id}`);
      } else {
        this.logger.log(`📋 Task ${completedTask.task_id} returned to inventory ${inventoryId} with 0 quantity (all items were distributed to stations)`);
      }

      // Check if batch is completed
      await this.checkAndUpdateBatchCompletion(completedTask.batch_id);
    } catch (error) {
      this.logger.error(`Error handling inventory return for task ${completedTask.task_id}:`, error.message);
      throw error;
    }
  }

  // Check if batch is completed and update batch status
  private async checkAndUpdateBatchCompletion(batchId: string): Promise<void> {
    try {
      // Get all tasks in the batch
      const allTasks = await this.taskRepository.find({
        where: { batch_id: batchId }
      });

      if (allTasks.length === 0) {
        return;
      }

      // Check if all tasks are completed (COMPLETED or TRIGGERED count as finished)
      const allCompleted = allTasks.every(task => 
        task.status === TaskStatus.COMPLETED || task.status === TaskStatus.TRIGERRED
      );
      
      if (allCompleted) {
        // Update batch status to completed
        await this.batchRepository.update(
          { batch_id: batchId },
          { 
            status: BatchStatus.COMPLETED,
            completed_tasks: allTasks.length
          }
        );
        
        this.logger.log(`✅ Batch ${batchId} marked as COMPLETED - all ${allTasks.length} tasks finished!`);
      } else {
        // Update completed_tasks count (both COMPLETED and TRIGGERED count)
        const completedCount = allTasks.filter(task => 
          task.status === TaskStatus.COMPLETED || task.status === TaskStatus.TRIGERRED
        ).length;
        await this.batchRepository.update(
          { batch_id: batchId },
          { completed_tasks: completedCount }
        );
      }
    } catch (error) {
      this.logger.error(`Error checking batch completion for ${batchId}:`, error.message);
    }
  }

  /**
   * Handle task when it goes to PROCESSING state - release the source station
   */
  async handleTaskProcessing(processingTask: Task): Promise<void> {
    // Safety check: Only process tasks that are actually in PROCESSING status
    if (processingTask.status !== TaskStatus.PROCESSING) {
      this.logger.warn(`Task ${processingTask.task_id} processing handler called but task status is ${processingTask.status} - skipping`);
      return;
    }

    this.logger.log(`Handling task ${processingTask.task_id} going to PROCESSING state - releasing source station`);
    
    try {
      // Release the source station (where the task started from)
      const sourceStationId = processingTask.start_location.location_id;
      const sourceLocationType = processingTask.start_location.location_attribute?.attribute_value;
      
      // Only release if source is a station (not inventory or waiting location)
      if (sourceLocationType === 'station') {
        await this.releaseStation(sourceStationId, processingTask.task_id);
      } 
      else if (sourceLocationType === 'waiting_location') {
        const waitingLocation = await this.waitingLocationRepository.findOne({
          where: { location_id: sourceStationId }
        });
        if (waitingLocation) {
          // Release waiting location
          await this.waitingLocationRepository.update(
            { location_id: sourceStationId },
            { 
              status: LocationStatus.AVAILABLE,
              holded_by: null
            }
          );
          this.logger.log(`✅ Waiting location ${sourceStationId} released and marked as AVAILABLE`);
        }
      }
        
        else {
        this.logger.log(`Task ${processingTask.task_id} source is ${sourceLocationType} (${sourceStationId}) - no station release needed`);
      }
    } catch (error) {
      this.logger.error(`Error handling task processing for ${processingTask.task_id}:`, error.message);
      throw error;
    }
  }

  /**
   * Release a station and make it available for other tasks
   * Also process any pending station requests for this station
   */
  private async releaseStation(stationId: string, taskId: number): Promise<void> {
    this.logger.log(`Releasing station ${stationId} from task ${taskId}`);
    
    // Mark station as available
    await this.stationRepository.update(
      { station_id: stationId},
      { 
        status: LocationStatus.AVAILABLE,
        holded_by: null
      }
    );
    
    this.logger.log(`✅ Station ${stationId} released and marked as AVAILABLE`);
    
    // Immediately process any pending station requests for this station
    // await this.processStationRequests(stationId);
  }

  private async loadProductRequirementsFromDatabase(): Promise<ProductRequirement[]> {
    this.logger.log('Loading product requirements from database...');
    
    // Load all product requirements from database
    const dbRequirements = await this.productRequirementRepository.find({
      where: { isPaused: false , isCancelled: false},
      order: { product_id: 'ASC', station_id: 'ASC' }
    });

    // if (dbRequirements.length === 0) {
    //   this.logger.log('No product requirements found in database');
    //   return [];
    // }

    // Group by product_id and format to match ProductRequirement interface
    const requirementMap = new Map<string, ProductRequirement>();

    for (const dbReq of dbRequirements) {
      const productId = dbReq.product_id;
      
      if (!requirementMap.has(productId)) {
        requirementMap.set(productId, {
          productId,
          totalRequirement: 0,
          stationRequirements: new Map<string, number>()
        });
      }

      const requirement = requirementMap.get(productId)!;
      requirement.totalRequirement += dbReq.requirement;
      requirement.stationRequirements.set(dbReq.station_id, dbReq.requirement);
      requirementMap.set(productId, requirement);
    }

    // Convert to array and sort by descending total requirement
    const productRequirements = Array.from(requirementMap.values()).sort(
      (a, b) => b.totalRequirement - a.totalRequirement
    );

    this.logger.log(`Loaded ${productRequirements.length} product requirements from database`);
    return productRequirements;
  }

  async getTaskbyID(taskId: string): Promise<Task> {
    const task = await this.taskRepository.findOne({
      where: { task_id: parseInt(taskId) }, 
    });
    if (!task) {
      throw new NotFoundException(`Task with ID ${taskId} not found`);
    }
    return task;
  }

  async pauseAllProductRequirements() {
    const result = await this.productRequirementRepository
      .createQueryBuilder()
      .update()
      .set({ isPaused: true })
      .execute();
    return result;
  }

  async cancelAllProductRequirements(){
    const result = await this.productRequirementRepository
      .createQueryBuilder()
      .update()
      .set({ isCancelled: true })
      .execute();
    
    const inprogressOrderItems = await this.orderItemRepository.find({
      where: { status: OrderItemStatus.IN_PROGRESS }
    });
    for (const orderItem of inprogressOrderItems) {
      this.loggingService.log(`Order ${orderItem.order_id}: Cancelled - Product ${orderItem.product_id}`);
    }

    const result2 = await this.orderItemRepository
      .createQueryBuilder()
      .update()
      .set({ status: OrderItemStatus.CANCELLED}) // , assigned_gtp_location: null 
      .where("status = :status", { status: OrderItemStatus.IN_PROGRESS })
      .execute();
    
    const findAllmapping = await this.scheduleMappingRepository.find();
    for (const mapping of findAllmapping) {
      const lp = mapping.license_plate_id;
      await this.orderItemRepository.update(
        {
          license_plate_id: lp,
          status: In([OrderItemStatus.PENDING, OrderItemStatus.ASSIGNED, OrderItemStatus.IN_PROGRESS])
        },
        { status: OrderItemStatus.CANCELLED }
      )
    }
    const result3 = await this.scheduleMappingRepository.deleteAll();
    return result;
  }

  async resumeAllProductRequirements() {
    const result = await this.productRequirementRepository
      .createQueryBuilder()
      .update()
      .set({ isPaused: false })
      .execute();
    return result;
  }
}
