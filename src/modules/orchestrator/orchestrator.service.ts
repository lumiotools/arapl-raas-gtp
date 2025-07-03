import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OrderItem, OrderItemStatus } from 'src/entities/order-item.entity';
import { Task, TaskType, TaskStatus } from 'src/entities/task.entity';
import { Batch, BatchStatus } from 'src/entities/batch.entity';
import { Inventory } from 'src/entities/inventory.entity';
import { Station } from 'src/entities/station.entity';
import { GtpLocation } from 'src/entities/gtp-location.entity';
import { Location, LocationType, LocationAction, LocationDimension, LocationAttribute } from 'src/entities/location.entity';
import { Wait, WaitType, WaitStatus, FallbackAction } from 'src/entities/wait.entity';
import { Cargo, CargoDimension, CargoAttribute } from 'src/entities/cargo.entity';
import { InventoryService } from '../inventory/inventory.service';

interface ProductRequirement {
  productId: string;
  totalRequirement: number;
  stationRequirements: Map<string, number>;
}

@Injectable()
export class OrchestratorService {
  private readonly logger = new Logger(OrchestratorService.name);

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
    @InjectRepository(GtpLocation)
    private readonly gtpLocationRepository: Repository<GtpLocation>,
    private readonly inventoryService: InventoryService,
  ) {}

  // Run every 30 seconds
  @Cron('*/30 * * * * *')
  async processAssignedOrderItems() {
    this.logger.log('Starting orchestrator process...');
    
    try {
      // Step 1 & 2: Get assigned order items and change status to in-progress
      const assignedItems = await this.getAndUpdateAssignedItems();
      
      if (assignedItems.length === 0) {
        this.logger.log('No assigned order items found');
        return;
      }

      this.logger.log(`Found ${assignedItems.length} assigned order items`);

      // Step 3 & 4: Calculate product requirements and sort by descending order
      const productRequirements = await this.calculateProductRequirements(assignedItems);
      
      // Step 5-9: Process each product and create tasks
      for (const requirement of productRequirements) {
        await this.processProductRequirement(requirement);
      }

      this.logger.log(`Orchestrator process completed successfully`);
      
    } catch (error) {
      this.logger.error('Error in orchestrator process:', error);
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

    // Sort by descending total requirement
    return Array.from(requirementMap.values()).sort(
      (a, b) => b.totalRequirement - a.totalRequirement
    );
  }

  private async processProductRequirement(requirement: ProductRequirement) {
    // Step 5: Get all inventories for this product
    const inventories = await this.inventoryService.findAllByProductId(requirement.productId);
    
    if (!inventories || inventories.length === 0) {
      this.logger.warn(`No inventories found for product ${requirement.productId}`);
      return;
    }

    // Step 6: Find minimum number of inventories to satisfy total requirement
    const selectedInventories = this.findMinimalInventories(inventories, requirement.totalRequirement);
    
    if (selectedInventories.length === 0) {
      this.logger.warn(`Insufficient inventory for product ${requirement.productId}`);
      return;
    }

    // Step 7: Get stations sorted by priority (ascending order)
    const sortedStations = await this.getStationsSortedByPriority(Array.from(requirement.stationRequirements.keys()));

    // Step 8: Create separate batch for each inventory
    const remainingRequirements = new Map(requirement.stationRequirements);

    for (const inventory of selectedInventories) {
      // Create a separate batch for this inventory
      const batchId = await this.generateBatchId();
      await this.createBatch(batchId, inventory, requirement.productId);
      
      // Create batch tasks for this specific inventory
      await this.createBatchTasksForInventory(
        inventory,
        sortedStations,
        remainingRequirements,
        batchId
      );
      
      this.logger.log(`Created batch ${batchId} for inventory ${inventory.id}`);
    }
  }

  private findMinimalInventories(inventories: Inventory[], totalRequirement: number): Inventory[] {
    // Sort inventories by quantity (descending) to use greedy approach
    const sortedInventories = inventories
      .filter(inv => inv.quantity > 0)
      .sort((a, b) => b.quantity - a.quantity);

    const selected: Inventory[] = [];
    let remainingRequirement = totalRequirement;

    for (const inventory of sortedInventories) {
      if (remainingRequirement <= 0) break;

      selected.push(inventory);
      remainingRequirement -= inventory.quantity;
    }

    if (remainingRequirement > 0) {
      this.logger.warn(`Insufficient total inventory. Missing: ${remainingRequirement} units`);
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

  private async findLastTaskFromSameInventory(inventoryId: string): Promise<number | null> {
    // Find the most recently created batch that starts from the same inventory
    // and is not fully completed
    const batches = await this.batchRepository
      .createQueryBuilder('batch')
      .leftJoinAndSelect('batch.tasks', 'task')
      .where('task.sequence_order = 1') // First task of batch
      .orderBy('batch.created_at', 'DESC')
      .getMany();

    for (const batch of batches) {
      // Check if the first task starts from the same inventory
      const firstTask = batch.tasks?.find(task => task.sequence_order === 1);
      if (firstTask && firstTask.start_location.location_id === inventoryId) {
        // Check if this batch is fully completed
        const allTasks = await this.taskRepository.find({
          where: { batch_id: batch.batch_id }
        });

        const allCompleted = allTasks.every(task => task.status === TaskStatus.COMPLETED);
        
        if (!allCompleted) {
          // Found a non-completed batch, get its last task (highest sequence_order)
          const lastTask = await this.taskRepository.findOne({
            where: { batch_id: batch.batch_id },
            order: { sequence_order: 'DESC' }
          });
          
          if (lastTask) {
            this.logger.log(`Found dependency: New batch should depend on task ${lastTask.task_id} from batch ${batch.batch_id}`);
            return lastTask.task_id;
          }
        }
      }
    }

    return null; // No dependency found
  }

  private async createBatchTasksForInventory(
    inventory: Inventory,
    sortedStations: Station[],
    remainingRequirements: Map<string, number>,
    batchId: string
  ): Promise<void> {
    let sequenceOrder = 1; // Start fresh for each batch
    let availableQuantity = inventory.quantity;
    let lastLocation = `inventory:${inventory.id}`; // Track current location
    let previousTaskId: number | null = null; // Track previous task ID for dependencies

    // Check for cross-batch inventory dependency (for the first task only)
    const dependencyTaskId = await this.findLastTaskFromSameInventory(inventory.id);
    if (dependencyTaskId) {
      previousTaskId = dependencyTaskId;
      this.logger.log(`First task of batch ${batchId} will depend on task ${dependencyTaskId} from previous batch`);
    }

    // Create path: inventory → station1 → station2 → ... → stationN → inventory
    for (const station of sortedStations) {
      const stationRequirement = remainingRequirements.get(station.station_id) || 0;
      
      if (stationRequirement <= 0 || availableQuantity <= 0) {
        continue; // Skip if station doesn't need anything or inventory is empty
      }

      const deliveryQuantity = Math.min(availableQuantity, stationRequirement);

      // Create task to move from current location to this station
      let taskId: number;
      if (lastLocation.startsWith('inventory:')) {
        // Task: inventory → station
        taskId = await this.createTask({
          batchId,
          productId: inventory.product_id,
          sourceInventoryId: inventory.id,
          destinationStationId: station.station_id,
          quantity: availableQuantity, // Move entire available quantity
          taskType: TaskType.GOODS_TO_PERSON,
          sequenceOrder: sequenceOrder++,
          taskDependency: previousTaskId // First task may depend on previous batch
        });
      } else {
        // Task: previous station → current station
        const previousStationId = lastLocation.replace('station:', '');
        taskId = await this.createTask({
          batchId,
          productId: inventory.product_id,
          sourceStationId: previousStationId,
          destinationStationId: station.station_id,
          quantity: availableQuantity,
          taskType: TaskType.GOODS_TO_PERSON,
          sequenceOrder: sequenceOrder++,
          taskDependency: previousTaskId // Depends on previous task
        });
      }

      // Update quantities and tracking
      availableQuantity -= deliveryQuantity;
      remainingRequirements.set(station.station_id, stationRequirement - deliveryQuantity);
      lastLocation = `station:${station.station_id}`;
      previousTaskId = taskId; // Set this task as dependency for next task

      this.logger.log(`Inventory ${inventory.id} delivers ${deliveryQuantity} to station ${station.station_id} (Task ${taskId})`);
    }

    // Return remaining quantity to inventory if not at inventory
    if (!lastLocation.startsWith('inventory:') && availableQuantity >= 0) {
      const sourceStationId = lastLocation.replace('station:', '');
      const finalTaskId = await this.createTask({
        batchId,
        productId: inventory.product_id,
        sourceStationId: sourceStationId,
        destinationInventoryId: inventory.id,
        quantity: availableQuantity,
        taskType: TaskType.GOODS_TO_PERSON,
        sequenceOrder: sequenceOrder++,
        taskDependency: previousTaskId // Depends on previous task
      });
      
      this.logger.log(`Return task created (Task ${finalTaskId}) - depends on Task ${previousTaskId}`);
    }

    // Update inventory quantity in database
    const finalQuantity = availableQuantity;
    await this.inventoryRepository.update(
      { id: inventory.id },
      { quantity: finalQuantity }
    );

    this.logger.log(`Inventory ${inventory.id} final quantity: ${finalQuantity}`);
  }

  private async createTask(taskData: {
    batchId: string;
    productId: string;
    sourceInventoryId?: string;
    sourceStationId?: string;
    destinationStationId?: string;
    destinationInventoryId?: string;
    quantity: number;
    taskType: TaskType;
    sequenceOrder: number;
    taskDependency?: number | null;
  }): Promise<number> {
    // Create start location
    const startLocation = this.createLocation(
      taskData.sourceInventoryId || taskData.sourceStationId!,
      taskData.sourceInventoryId ? 'inventory' : 'station',
      this.getLocationAction(taskData, 'start')
    );

    // Create end location
    const endLocation = this.createLocation(
      taskData.destinationInventoryId || taskData.destinationStationId!,
      taskData.destinationInventoryId ? 'inventory' : 'station',
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
      wait: waitObject,
      cargos: cargosArray
    });

    const savedTask = await this.taskRepository.save(task);
    this.logger.log(`Created task ${savedTask.task_id}: ${taskData.taskType} - ${taskData.quantity} units of ${taskData.productId}${taskData.taskDependency ? ` (depends on task ${taskData.taskDependency})` : ''}`);
    
    return savedTask.task_id;
  }

  private createLocation(
    locationId: string,
    locationType: 'inventory' | 'station',
    locationAction: LocationAction
  ): Location {
    return {
      location_id: locationId,
      location_type: LocationType.ZONE,
      location_action: locationAction,
      location_dimension: { length: 0, height: 0, width: 0 },
      location_attribute: { attribute_name: locationType }
    };
  }

  private createWaitObject(): Wait {
    return {
      wait_type: WaitType.TRIGGER,
      wait_condition: null,
      start_location_wait_time: 0,
      end_location_wait_time: 0,
      start_location_available_wait: false,
      end_location_available_wait: false,
      wait_status: WaitStatus.NOT_STARTED,
      timeout: 1800, // 30 minutes default
      fallback_action: FallbackAction.ERROR
    };
  }

  private createCargoArray(productId: string): Cargo[] {
    return [{
      cargo_code: productId,
      cargo_type: 'Pallet',
      cargo_dimension: { length: 0, width: 0, height: 0 },
      cargo_attributes: null,
      cargo_weight: 0
    }];
  }

  private getLocationAction(taskData: any, position: 'start' | 'end'): LocationAction {
    const isInventoryToStation = taskData.sourceInventoryId && taskData.destinationStationId;
    const isStationToStation = taskData.sourceStationId && taskData.destinationStationId;
    const isStationToInventory = taskData.sourceStationId && taskData.destinationInventoryId;

    if (isInventoryToStation) {
      return position === 'start' ? LocationAction.PICK : LocationAction.WAIT;
    } else if (isStationToStation) {
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

  // Manual trigger method for testing
  async triggerOrchestrator() {
    this.logger.log('Manually triggering orchestrator...');
    await this.processAssignedOrderItems();
  }

  // Get batch status
  async getBatchStatus(batchId: string) {
    return await this.batchRepository.findOne({
      where: { batch_id: batchId },
      relations: ['tasks']
    });
  }

  // Get all batches
  async getAllBatches() {
    return await this.batchRepository.find({
      order: { created_at: 'DESC' }
    });
  }
}
