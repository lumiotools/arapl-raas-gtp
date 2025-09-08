import { BadRequestException, Injectable, Logger, Move, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, IsNull, LessThan, LessThanOrEqual, MoreThan, MoreThanOrEqual, Not, OneToOne, Repository } from 'typeorm';
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
import { WaitingLocationService } from '../waiting_location/waiting_location.service';
import { Robot } from 'src/entities';

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

export interface TaskDetails{
  task_id: string;
  batch_id: string;
  product_id: string;
  robot_id: string;
  quantity: number;
  move_type: MOVE_TYPE;
  status: TaskStatus;
  start_location_id: string;
  end_location_id: string;
  created_at: Date;
  updated_at: Date;
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
    @InjectRepository(Robot)
    private readonly robotRepository: Repository<Robot>,
    private readonly inventoryService: InventoryService,
    private readonly httpService: HttpService,
    private readonly loggingService: LoggingService,
    private readonly stationService: StationsService,
    private readonly waitingLocationService: WaitingLocationService
  ) {}

  async processAssignedOrderItems() {
    try {
      // Calculate product requirements and sort by descending order
      let productRequirements: ProductRequirement[];
      productRequirements = await this.loadProductRequirementsFromDatabase();
      // first check waiting locations for this product.
      const waitingLocations = await this.waitingLocationRepository.find({
        where: {
          status: LocationStatus.OCCUPIED,
        }
      });
      // fetch all the waiting locations that are occupied
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
          console.log(`has Requirement : ${hasRequirement ? 'Yes' : 'No'}, product_id: ${task.product_id}`);
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
            const reserved = await this.inventoryService.reserveInventory(originalInventoryId);
            if (!reserved) {
              this.logger.error(`Failed to reserve inventory ${originalInventoryId}`);
              return;
            }
            const [returnTaskId, returnTask]= await this.createTask({
              batchId: task.batch_id,
              productId: task.product_id,
              sourceWaitingLocationId: waitingLocation.location_id,
              destinationInventoryId: originalInventoryId,
              quantity: task.quantity,
              robotId: task.robot_id,
              taskType: TaskType.GOODS_TO_PERSON,
              move_type: MOVE_TYPE.WAITING_LOCATION_TO_INVENTORY,
              sequenceOrder: task.sequence_order + 1, // Next sequence order
              taskDependency: task.task_id // Use last task of batch as dependency
            });

            console.log(`returnTask: ${returnTask?.task_id}`);
            
            if (returnTask) {
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
            console.log(`sorted stations: ${JSON.stringify(sortedStations)}`)
            for (const stat in sortedStations){
              const stationID = sortedStations[stat].station_id;
              const station = await  this.stationRepository.findOne({where: { station_id: stationID }});
              if (!station){continue;}
              if (station.status === LocationStatus.AVAILABLE) {
                const reserved = await this.stationService.reserveStation(station.station_id);
                if (!reserved) {
                  console.log(`can't reserve the station ${station.station_id}`);
                  continue;
                }
                const batchId = task.batch_id;
                const [returnTaskId, returnTask] = await this.createTask({
                  batchId,
                  productId,
                  sourceWaitingLocationId: waitingLocation.location_id,
                  destinationStationId: station.station_id,
                  quantity: task.quantity,
                  robotId: task.robot_id,
                  taskType: TaskType.GOODS_TO_PERSON,
                  move_type: MOVE_TYPE.WAITING_LOCATION_TO_STATION,
                  sequenceOrder: task.sequence_order + 1, // Next sequence order
                  taskDependency: task.task_id // Use last task of batch as dependency
                });
                if (!returnTask) {
                  await this.stationRepository.update(station.station_id, { status: LocationStatus.AVAILABLE });
                  continue;
                }
                await this.reserveStationAndSendTask(returnTask, station); // Reserve the station and send task to WMS
                this.logger.log(`New Task: ${returnTaskId}, Product ID: ${productId}, quantity: ${task.quantity}, start location: ${waitingLocation.location_id} (waiting location), destination location: ${station.station_id} (station)`);
                await this.loggingService.log(`New Task: ${returnTaskId}, Product ID: ${productId}, quantity: ${task.quantity}, start location: ${waitingLocation.location_id} (waiting location), destination location: ${station.station_id} (station)`);
                break; // Exit loop after processing first available station
              }
            }
          }
        }
      }
      if (productRequirements.length == 0){
        return;
      }
      for (const requirement of productRequirements) {
        // check if the system is in waiting state
        const isWaiting = await this.checkIfSystemIsInWaitingState();
        if (isWaiting){break;}
        const isRobotAvailable = await this.isRobotAvailable();
        if (!isRobotAvailable){ break; }
        await this.processProductRequirement(requirement.productId);
      }
      return { message: 'Orchestrator process completed successfully' };
      
    } catch (error) {
      return { message: 'Orchestrator process completed', error: error.message };
    }
  }

  async isRobotAvailable(): Promise<boolean> {
    const robots = await this.robotRepository.find();
    if (robots.length === 0){
      return false;
    }
    const robot = robots[0];
    return robot.total_robots - robot.robot_in_use > 0
  }
  async incrementRobotInUse(): Promise<void> {
    console.log('increment robot in use count');
    const queryRunner = this.robotRepository.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
        // Atomic increment - no race condition possible
        const result = await queryRunner.manager
            .createQueryBuilder()
            .update(Robot)
            .set({ 
                robot_in_use: () => "robot_in_use + 1" 
            })
            .execute();

        if (result.affected === 0) {
            throw new Error('No Robot Entry Found');
        }
        
        await queryRunner.commitTransaction();
    } catch (error) {
        await queryRunner.rollbackTransaction();
        throw error;
    } finally {
        await queryRunner.release();
    }
  }

  async decrementRobotInUse(): Promise<void> {
    const queryRunner = this.robotRepository.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
        // Atomic decrement with safety check to prevent negative values
        const result = await queryRunner.manager
            .createQueryBuilder()
            .update(Robot)
            .set({ 
                robot_in_use: () => "GREATEST(robot_in_use - 1, 0)" 
            })
            .execute();

        if (result.affected === 0) {
            throw new Error('No Robot Entry Found');
        }
        
        await queryRunner.commitTransaction();
    } catch (error) {
        await queryRunner.rollbackTransaction();
        throw error;
    } finally {
        await queryRunner.release();
    }
  }


  async checkIfSystemIsInWaitingState(): Promise<boolean> {
    const robots = await this.robotRepository.find();
    if (robots.length === 0){
      return false;
    }
    const isWaiting = robots[0].is_waiting;
    return isWaiting;
  }

  async markSystemAsWaiting(): Promise<void> {
    const queryRunner = this.robotRepository.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    
    try {
      const robots = await queryRunner.manager.find(Robot);
      if (robots.length === 0) {
      throw new Error('No Robot Entry Found');
      }
      await queryRunner.manager.update(Robot, robots[0].id, { is_waiting: true });
      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async unmarkSystemAsWaiting(): Promise<void> {
    const queryRunner = this.robotRepository.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const robots = await queryRunner.manager.find(Robot);
      if (robots.length === 0) {
        throw new Error('No Robot Entry Found');
      }
      await queryRunner.manager.update(Robot, robots[0].id, { is_waiting: false });
      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
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
      console.log(`product id: ${productId}, station_id: ${stationId}`);
      if (!stationId) {continue;}

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
    console.log(`requirement Map: ${JSON.stringify(Array.from(requirementMap.entries()))}`)
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
          console.log(`Created requirement: Product ${productId} at Station ${stationId} = ${requirementQuantity}`);
          await this.productRequirementRepository.save(newRequirement);
          this.logger.log(`Created requirement: Product ${productId} at Station ${stationId} = ${requirementQuantity}`);
        }
      }
    }
    console.log(`Finished saving product requirements: ${JSON.stringify(Array.from(requirementMap.entries()))}`);
  }

  private async processProductRequirement(productId: string): Promise<void> {

    const allInventories = await this.inventoryService.findAllByProductId(productId);
    if (!allInventories || allInventories.length === 0) {return;}

    // read the requirement of the product from the database
    const databaseRequirement = await this.productRequirementRepository.find({
      where : { product_id: productId , isPaused: false, isCancelled: false },
      order: { station_id: 'ASC' }
    });
    let effectiveSystemRequirement = databaseRequirement.reduce((sum, req) => sum + req.requirement, 0);
    let db_req = effectiveSystemRequirement;
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
    let sortedStations = await this.getStationsSortedByPriority(stationIds);
    if (db_req > 0) {
      const taskComingToInventory = await this.taskRepository.findOne({
        where:{product_id: productId, move_type: In([MOVE_TYPE.WAITING_LOCATION_TO_INVENTORY, MOVE_TYPE.STATION_TO_INVENTORY]), status: In([TaskStatus.PROCESSING])}
      })
      console.log(`task coming to inventory: ${JSON.stringify(taskComingToInventory)}`)
      if (taskComingToInventory && taskComingToInventory.robot_id) {
        console.log(`found task from inventory: trying to cancel`)
        try{
          const inventory_id = taskComingToInventory.end_location.location_id;
          const inventory = await this.inventoryRepository.findOne({ where: { id: inventory_id } });
          if (inventory && inventory?.quantity - inventory?.missing_quantity - inventory?.defective_quantity > 0){
            let is_station_task_created = false;
            const robotIdToUse = taskComingToInventory.robot_id;
            for (const station of sortedStations) {
              const reserved = await this.stationService.reserveStation(station.station_id);
              if (!reserved) {  
                continue;
              }
              await this.CancelTask(taskComingToInventory);
              if (!robotIdToUse) {
                await this.stationRepository.update(station.station_id, { status: LocationStatus.AVAILABLE });
                return;
              }
              const batchId = taskComingToInventory.batch_id;
              console.log(`cancelling at db_req > 0`)
              const [returnTaskId, returnTask] = await this.createTask({
                batchId,
                productId: taskComingToInventory.product_id,
                sourceStationId: station.station_id,
                destinationStationId: station.station_id,
                quantity: taskComingToInventory.quantity,
                robotId: robotIdToUse,
                taskType: TaskType.GOODS_TO_PERSON,
                move_type: MOVE_TYPE.STATION_TO_STATION,
                sequenceOrder: taskComingToInventory.sequence_order + 1, // Next sequence order
                taskDependency: taskComingToInventory.task_id // Use last task of batch as dependency
              });
              if (!returnTask) {
                await this.stationRepository.update(station.station_id, { status: LocationStatus.AVAILABLE });
                continue;
              }
              await this.reserveStationAndSendTask(returnTask, station); // Reserve the station and send task to WMS
              // remove the robotIdToUse from idleRobot list
              console.log(`sent cancellation task followup`)
              // Remove this station from sortedStations to prevent creating another task for the same station
              sortedStations = sortedStations.filter(st => st.station_id !== station.station_id);
              this.logger.log(`New Task: ${returnTaskId}, Product ID: ${productId}, quantity: ${taskComingToInventory.quantity}, start location: ${taskComingToInventory.start_location.location_id} (inventory), destination location: ${station.station_id} (station)`);
              await this.loggingService.log(`New Task: ${returnTaskId}, Product ID: ${productId}, quantity: ${taskComingToInventory.quantity}, start location: ${taskComingToInventory.start_location.location_id} (inventory), destination location: ${station.station_id} (station)`);
              is_station_task_created = true;
              break;
            }
            const waitingLocations = await this.waitingLocationRepository.find({where: {status: LocationStatus.AVAILABLE}});
            for (const waitLocation of waitingLocations){
              if (is_station_task_created){break;}
              let reserved = await this.waitingLocationService.reserveWaitingLocation(waitLocation.location_id);
              if (!reserved){
                continue;
              }
              reserved  = await this.stationService.reserveStation(taskComingToInventory.start_location.location_id);
              if (!reserved) {  
                await this.waitingLocationRepository.update(waitLocation.location_id, { status: LocationStatus.AVAILABLE });
                continue;
              }
              if (!robotIdToUse) {
                await this.waitingLocationRepository.update(waitLocation.location_id, { status: LocationStatus.AVAILABLE });
                break;
              }
              const batchId = taskComingToInventory.batch_id;
              console.log(`cancelling at db_req > 0 - waiting location`)
              const [returnTaskId, returnTask] = await this.createTask({
                batchId: batchId,
                productId: taskComingToInventory.product_id,
                sourceStationId: taskComingToInventory.start_location.location_id,
                destinationWaitingLocationId: waitLocation.location_id,
                quantity: taskComingToInventory.quantity,
                robotId: robotIdToUse,
                taskType: TaskType.GOODS_TO_PERSON,
                move_type: MOVE_TYPE.STATION_TO_WAITING_LOCATION,
                sequenceOrder: taskComingToInventory.sequence_order + 1, // Next sequence order
                taskDependency: taskComingToInventory.task_id // Use last task of batch as dependency
              });
              if (returnTask) {
                await this.waitingLocationRepository.update({location_id: waitLocation.location_id},{status:LocationStatus.RESERVED, holded_by: returnTaskId});
                await this.stationRepository.update(taskComingToInventory.start_location.location_id, { status: LocationStatus.RESERVED, holded_by: returnTaskId });
                await this.sendSingleTaskToWms(returnTask);
                this.logger.log(`New Task: ${returnTaskId}, Product ID: ${productId}, quantity: ${taskComingToInventory.quantity}, start location: ${taskComingToInventory.start_location.location_id} (inventory), destination location: ${waitLocation.location_id} (waiting location)`);
                await this.loggingService.log(`New Task: ${returnTaskId}, Product ID: ${productId}, quantity: ${taskComingToInventory.quantity}, start location: ${taskComingToInventory.start_location.location_id} (inventory), destination location: ${waitLocation.location_id} (waiting location)`);
                break;
              }
              if (!returnTask){
                await this.waitingLocationRepository.update({location_id: waitLocation.location_id},{status:LocationStatus.AVAILABLE, holded_by: null});
                await this.stationRepository.update(taskComingToInventory.start_location.location_id, { status: LocationStatus.AVAILABLE, holded_by: null });
              }
            }
          }
        }
        catch (error) {
          this.logger.error(`Error cancelling task ${taskComingToInventory.task_id}: ${error.message}`);
        }
      }
      
    }

    if (db_req > 0){
      const taskToWaitingLocation = await this.taskRepository.findOne({
        where: { product_id: productId, status: In([TaskStatus.PROCESSING]), move_type: In([MOVE_TYPE.INVENTORY_TO_WAITING_LOCATION]) }
      });
      if (taskToWaitingLocation && taskToWaitingLocation.robot_id) {
        // If a task is found, we can use it
        this.logger.log(`Found existing task for product ${productId}: ${taskToWaitingLocation.task_id}`);
        for (const station of sortedStations){
          if (station.status === LocationStatus.AVAILABLE) {
            const reserved = await this.stationService.reserveStation(station.station_id);
            if (!reserved) {  
              continue;
            }
            await this.CancelTask(taskToWaitingLocation);
            const [returnTaskId, returnTask] = await this.createTask({
              batchId: taskToWaitingLocation.batch_id,
              productId,
              sourceStationId: station.station_id,
              destinationStationId: station.station_id,
              quantity: taskToWaitingLocation.quantity,
              robotId: taskToWaitingLocation.robot_id,
              taskType: TaskType.GOODS_TO_PERSON,
              move_type: MOVE_TYPE.STATION_TO_STATION,
              sequenceOrder: taskToWaitingLocation.sequence_order + 1, // Next sequence order
              taskDependency: taskToWaitingLocation.task_id // Use last task of batch as dependency
            });
            if (!returnTask) {
              await this.stationRepository.update(station.station_id, { status: LocationStatus.AVAILABLE });
              continue;
            }
            await this.reserveStationAndSendTask(returnTask, station); // Reserve the station and send task to WMS
            // remove the robotIdToUse from idleRobot list
            this.logger.log(`New Task: ${returnTaskId}, Product ID: ${productId}, quantity: ${taskToWaitingLocation.quantity}, start location: ${taskToWaitingLocation.end_location.location_id} (waiting location), destination location: ${station.station_id} (station)`);
            await this.loggingService.log(`New Task: ${returnTaskId}, Product ID: ${productId}, quantity: ${taskToWaitingLocation.quantity}, start location: ${taskToWaitingLocation.end_location.location_id} (waiting location), destination location: ${station.station_id} (station)`);
            sortedStations = sortedStations.filter(s => s.station_id !== station.station_id);
            break;
          }
        }
      }
    }
    console.log(`effectiveSystemRequirement: ${effectiveSystemRequirement}`);
    if (effectiveSystemRequirement <= 0){
      return ;
    }

    if (selectedInventories.length === 0) {return ;}

    console.log(`sorted Stations: ${JSON.stringify(sortedStations)}`);

    for (const inventory of selectedInventories) {
      const isWaiting = await this.checkIfSystemIsInWaitingState();
      if (isWaiting){break;}
      const isRobotAvailable = await this.isRobotAvailable();
      if (!isRobotAvailable){break;}
      const taskID = await this.createSingleTaskToFirstAvailableStation(
        inventory,
        sortedStations,
      );
      if (!taskID){
        const inventory_to_station_waiting_location = await this.waitingLocationRepository.find({
          where: { type: WaitingLocationType.INVENTORY_TO_STATION, status: LocationStatus.AVAILABLE}
        });
        for (const waitingLocation of inventory_to_station_waiting_location) {
          if (waitingLocation.status !== LocationStatus.AVAILABLE || waitingLocation.holded_by !== null) {continue;} // a task is already holded by this waiting location
          let reserved = await this.waitingLocationService.reserveWaitingLocation(waitingLocation.location_id);
          if (!reserved) {
            continue;
          }
          const robotIdToUse = null;
          console.log(`robotIdToUse: ${robotIdToUse}`);
          const batchId = await this.generateBatchId();
          await this.createBatch(batchId, inventory, inventory.product_id);
          const [returnTaskId, returnTask] = await this.createTask({
            batchId,
            productId: inventory.product_id,
            sourceInventoryId: inventory.id,
            destinationWaitingLocationId: waitingLocation.location_id,
            quantity: inventory.quantity,
            robotId: robotIdToUse,
            taskType: TaskType.GOODS_TO_PERSON,
            move_type: MOVE_TYPE.INVENTORY_TO_WAITING_LOCATION,
            sequenceOrder: 1, // First task in this batch
            taskDependency: null // No dependency for first task
          });
          waitingLocation.holded_by = returnTaskId;
          await this.waitingLocationRepository.save(waitingLocation);
          if (!returnTask) {
            await this.waitingLocationRepository.update({ location_id: waitingLocation.location_id }, { status: LocationStatus.AVAILABLE, holded_by: null });
            continue;
          }
          inventory.isProcessing = true;
          await this.inventoryRepository.update({ id: inventory.id }, { isProcessing: true, status: LocationStatus.RESERVED, holded_by: returnTaskId });

          await this.markSystemAsWaiting();
          await this.incrementRobotInUse();
          // Send task to WMS
          await this.sendSingleTaskToWms(returnTask);
          // remove the robotIdToUse from idleRobot list
          this.logger.log(`New Task: ${returnTaskId}, Product ID: ${inventory.product_id}, quantity: ${inventory.quantity}, start location: ${inventory.id} (inventory), destination location: ${waitingLocation.location_id} (waiting location)`);
          await this.loggingService.log(`New Task: ${returnTaskId}, Product ID: ${inventory.product_id}, quantity: ${inventory.quantity}, start location: ${inventory.id} (inventory), destination location: ${waitingLocation.location_id} (waiting location)`);
          break;
        }
      }
    }
  }

  async CancelTask(parking_task: Task): Promise<any> {
    try {
      console.log(`Cancelling task ${parking_task.task_id}`);
      const warehouse_name = process.env.WMS_WAREHOUSE_NAME || 'warehouse';
      const warehouse_key = process.env.WMS_WAREHOUSE_AUTH_kEY || 'test'; // Fixed typo
      const wms_base_url = process.env.WMS_BASE_URL || 'http://localhost:3030';
      const fms_batch_id = parking_task.fms_batch_id;
      
      const requestBody = {
        "force": true,
        "reason": "Cancel the current Parking Location Task",
        "timestamp": new Date().toISOString()
      };
      
      const response = await fetch(`${wms_base_url}/robot-job/${warehouse_name}/tasks/${fms_batch_id}/cancel`, {
        method: 'PATCH',
        headers: {
          'authorization': warehouse_key,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });
      
      if (!response.ok) {
        // Try to get error details
        let errorMessage = response.statusText;
        try {
          const errorData = await response.text();
          errorMessage = errorData || response.statusText;
        } catch (e) {
          // If can't read response, use statusText
        }
        throw new Error(`Failed to cancel task ${parking_task.task_id}: ${errorMessage}`);
      }
      
      // Check if response is JSON
      const contentType = response.headers.get('content-type');
      let res;
      if (contentType && contentType.includes('application/json')) {
        res = await response.json();
      } else {
        res = await response.text();
      }
      
      console.log(`cancel response: ${JSON.stringify(res)}`);
      return res;
      
    } catch (error) {
      console.error(`Error cancelling task ${parking_task.task_id}:`, error);
      throw new Error(`Failed to cancel task ${parking_task.task_id}: ${error.message}`);
    }
  }

  async setInitialConfiguration(){
    await this.stationService.findAll();
    await this.waitingLocationService.findAll();
    const robots = await this.robotRepository.find();
    if (robots.length === 0){
      await this.robotRepository.save({id: crypto.randomUUID(), is_waiting: false, total_robots: 1, robot_in_use: 0 });
    }
    // else{
    //   await this.robotRepository.updateAll({ is_waiting: false, total_robots: 4, robot_in_use: 0 });
    // }
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
      this.logger.warn(`Insufficient inventory for product: need ${totalRequired}, have ${totalAvailable} - processing ALL available inventories`);
      // Return ALL inventories to fulfill as much as possible
      const allValidInventories = sortedInventories.filter(inv => inv.quantity - inv.defective_quantity - inv.missing_quantity > 0 && !inv.isProcessing);
      this.logger.log(`Processing all ${allValidInventories.length} available inventories to fulfill partial requirement`);
      return allValidInventories;
    }

    // Sufficient inventory exists - find minimum combination using greedy approach
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
    sortedStations: Station[],
  ): Promise<string | null> {
    // Find the first available station in priority order
    let targetStation: Station | null = null;
    
    for (const station of sortedStations) {
      // Check if the station is available (not RESERVED or OCCUPIED)
      const station_id = station.station_id;
      const fetchStation = await this.stationRepository.findOne({
        where: { station_id },
      });
      if (fetchStation && fetchStation.status === LocationStatus.AVAILABLE && await this.stationService.reserveStation(station_id)) {
        targetStation = fetchStation;
        break; // Take the first available station, don't skip to lower priority
      }
    }
    console.log(`target station: ${JSON.stringify(targetStation)}`);

    if (targetStation) {
      // Station is available - create task immediately
      const batchId = await this.generateBatchId();
      await this.createBatch(batchId, inventory, inventory.product_id);
      console.log(`checking robot id to use`);
      const robotIdToUse = null;
      const [taskId,task] = await this.createTask({
        batchId,
        productId: inventory.product_id,
        sourceInventoryId: inventory.id,
        destinationStationId: targetStation.station_id,
        robotId: robotIdToUse,
        quantity: inventory.quantity, // Move entire available quantity
        taskType: TaskType.GOODS_TO_PERSON,
        move_type: MOVE_TYPE.INVENTORY_TO_STATION,
        sequenceOrder: 1, // First (and only) task in this batch
        taskDependency: null // May depend on previous batch
      });
      if(!task){
        await this.stationRepository.update(targetStation.station_id, { status: LocationStatus.AVAILABLE });
        return null;
      }
      // reserve the inventory location
      inventory.isProcessing = true;
      inventory.status = LocationStatus.RESERVED;
      await this.inventoryRepository.update({ id: inventory.id }, { isProcessing: true, status: LocationStatus.RESERVED, holded_by: taskId });
      await this.markSystemAsWaiting();
      await this.incrementRobotInUse();
      await this.reserveStationAndSendTask(task, targetStation);
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
    productId?: string;
    sourceInventoryId?: string;
    sourceStationId?: string;
    sourceWaitingLocationId?: string;
    destinationStationId?: string;
    destinationInventoryId?: string;
    destinationWaitingLocationId?: string;
    quantity?: number;
    taskType: TaskType;
    robotId?: string | null;
    move_type: MOVE_TYPE;
    sequenceOrder: number;
    taskDependency?: string | null;
  }): Promise<[string, Task | null]> {
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
    console.log(`startLocation: ${JSON.stringify(startLocation)}`);
    console.log(`endLocation: ${JSON.stringify(endLocation)}`);

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
      robot_id: taskData.robotId || undefined
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
      location_type: LocationType.PALLET,
      location_action: locationAction,
      location_attribute: { 
        attribute_name: 'location_type',
        attribute_value: locationType
      }
    };
  }

  private createWaitObject(): Wait | null {
    return null;
  }

  private createCargoArray(productId: string): Cargo[] | null {
    return null;
  }

  private getLocationAction(taskData: any, position: 'start' | 'end'): LocationAction {
    const isInventoryToStation = taskData.sourceInventoryId && taskData.destinationStationId;
    const isInventoryToWaitLocation = taskData.sourceInventoryId && taskData.destinationWaitingLocationId;
    const isStationToStation = taskData.sourceStationId && taskData.destinationStationId;
    const isStationToInventory = taskData.sourceStationId && taskData.destinationInventoryId;
    const isStationToWaiting = taskData.sourceStationId && taskData.destinationWaitingLocationId;
    const isWaitingToStation = taskData.sourceWaitingLocationId && taskData.destinationStationId;
    const isWaitingToInventory = taskData.sourceWaitingLocationId && taskData.destinationInventoryId;

    if (isInventoryToStation) return position === 'start' ? LocationAction.PICK : LocationAction.NOP_PAUSE;
    if (isInventoryToWaitLocation) return position === 'start' ? LocationAction.PICK : LocationAction.NOP_PAUSE;
    if (isStationToStation) return position === 'start' ? LocationAction.NOP_RESUME : LocationAction.NOP_PAUSE;
    if (isStationToWaiting) return position === 'start' ? LocationAction.NOP_RESUME : LocationAction.NOP_PAUSE;
    if (isWaitingToStation) return position === 'start' ? LocationAction.NOP_RESUME : LocationAction.NOP_PAUSE;
    if (isStationToInventory) return position === 'start' ? LocationAction.NOP_RESUME : LocationAction.DROP;
    if (isWaitingToInventory) return position === 'start' ? LocationAction.NOP_RESUME : LocationAction.DROP;

    // Default fallback
    return LocationAction.NOP_PAUSE;
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
        // batch_job_id: task.batch_id,
        batch_priority: 0,
        batch_type: "DISCRETE",
        tasks: [{
          task_id: task.task_id.toString(),
          task_type: "GOODSTOPERSON",
          task_dependency: null,
          robot_id: task.robot_id,
          start_location: {
            location_id: task.start_location?.location_id,
            location_type: task.start_location?.location_type,
            location_action: task.start_location?.location_action,
            location_dimension: {
              length: 1,
              width: 1,
              height: 1
            }
          },
          end_location: {
            location_id: task.end_location?.location_id,
            location_type: task.end_location?.location_type,
            location_action: task.end_location?.location_action,
            location_dimension: {
              length: 1,
              width: 1,
              height: 1
            }
          },
          wait: null,
          cargos: null,
        }]
      };
      console.log(`Sending task ${task.task_id} to WMS with request body: ${JSON.stringify(requestBody)}`);
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
  async handleTaskCompletion(completedTask: Task, dropped_quantity: number, message_code: MessageCode): Promise<void> {
    if (completedTask.status !== TaskStatus.TRIGERRED) {return;}
    // this.logger.log(`Handling task ${operationType} for task ${completedTask.task_id} at station - TRIGGERED is the final state`);
    
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
      await this.removeProductRequirement(completedTask, completedTask.product_id, currentStationId, droppedQuantity, message_code);
      
      this.logger.log(`📦 Normal completion: dropped ${droppedQuantity} units, remaining ${remainingQuantity} units`);
      
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
    console.log(`create next station task. current station: ${currentStationId}, priority: ${currentStationPriority}`);
    for (const requirement of remainingRequirements) {
      const station = await this.stationRepository.findOne({
        where: { station_id: requirement.station_id}
      });
      if (station && (station.station_id == currentStationId || station.priority < currentStationPriority)) {
        // Skip current station
        continue;
      }
      if (station && station.status === LocationStatus.AVAILABLE && await this.stationService.reserveStation(station.station_id)) {
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
        if (station && station.status === LocationStatus.AVAILABLE && await this.stationService.reserveStation(station.station_id)) {
          nextAvailableStation = station;
          break;
        }
      }
    }
    console.log('found next station:', JSON.stringify(nextAvailableStation));

    const nextSequenceOrder = completedTask.sequence_order + 1;
    
    if (nextAvailableStation) {

      // Station available - create direct task to station with remaining quantity
      const [taskId,newTask] = await this.createTask({
        batchId: completedTask.batch_id,
        productId: completedTask.product_id,
        sourceStationId: completedTask.end_location.location_id,
        destinationStationId: nextAvailableStation.station_id,
        robotId: completedTask.robot_id,
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
    const availableWaitingLocations = await this.waitingLocationRepository.find({
      where: { status: LocationStatus.AVAILABLE, type: WaitingLocationType.STATION_TO_STATION},
      order: { location_id: 'ASC' } // FIFO selection
    });

    for (const availableWaitingLocation of availableWaitingLocations) {
      if (!availableWaitingLocation) {
        this.logger.warn(`No available waiting locations found for task ${completedTask.task_id} - cannot create waiting location task`);
        continue;
      }
      // Reserve waiting location first (will be updated with actual task ID after creation)
      const reserved = await this.waitingLocationService.reserveWaitingLocation(availableWaitingLocation.location_id);
      if (!reserved) {
        this.logger.error(`Failed to reserve waiting location ${availableWaitingLocation.location_id} for task ${completedTask.task_id}`);
        continue;
      }

      // Create task to waiting location
      const [waitingTaskId, waitingTask] = await this.createTask({
        batchId: completedTask.batch_id,
        productId: completedTask.product_id,
        sourceStationId: completedTask.end_location.location_id,
        destinationWaitingLocationId: availableWaitingLocation.location_id,
        quantity: remainingQuantity, // Use remaining quantity
        move_type: MOVE_TYPE.STATION_TO_WAITING_LOCATION,
        robotId: completedTask.robot_id,
        taskType: TaskType.GOODS_TO_PERSON,
        sequenceOrder: sequenceOrder,
        taskDependency: completedTask.task_id
      });

      if (waitingTask) {
        // Update waiting location to be held by this new task
        await this.waitingLocationRepository.update(
          { location_id: availableWaitingLocation.location_id },
          { holded_by: waitingTask.task_id }
        );

        // Send task to WMS
        await this.sendSingleTaskToWms(waitingTask);

        this.logger.log(`Created waiting location task ${waitingTaskId}: station ${completedTask.end_location.location_id} → waiting location ${availableWaitingLocation.location_id} (task sent to WMS)`);
        break;
      }

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

    const reserved = await this.inventoryService.reserveInventory(originalInventoryId);
    if (!reserved) {
      this.logger.error(`Failed to reserve inventory ${originalInventoryId} for task ${completedTask.task_id}`);
      return;
    }

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
      taskDependency: completedTask.task_id,
      robotId: completedTask.robot_id
    });
    if (returnTask) {
      await this.sendSingleTaskToWms(returnTask);
    }  
  }

  private async removeProductRequirement(task: Task, productId: string, stationId: string, droppedQuantity: number, message_code: MessageCode): Promise<void> {
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
            if (!order_item.completedTasks) {
              order_item.completedTasks = [];
            }
            order_item.completedTasks.push(task);
            await this.orderItemRepository.save(order_item);
            // await this.orderItemRepository.update({ order_item_id: order_item.order_item_id, product_id: productId }, { remaining_quantity: order_item.remaining_quantity, completedTasks: order_item.completedTasks, status: order_item.status });
            console.log(`Order Item ${order_item.order_item_id} completed - remaining quantity: 0`);
            await this.loggingService.log(`Order ${order_item.order_id}: Product ${productId} at GTP Location ${gtpLocation.gtp_location_id} completed.`);
          }
          else{
            order_item.remaining_quantity -= droppedQuantity;
            droppedQuantity = 0;
            if(!order_item.completedTasks) {
              order_item.completedTasks = [];
            }
            order_item.completedTasks.push(task);
            await this.orderItemRepository.save(order_item);
            // await this.orderItemRepository.update({ order_item_id: order_item.order_item_id, product_id: productId }, { remaining_quantity: order_item.remaining_quantity, completedTasks: order_item.completedTasks, status: order_item.status });
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

  // Manual trigger method for testing
  @Cron('*/10 * * * * *')
  async orchestratorCronJob() {
    await this.triggerOrchestrator();
  }

  public async writeInDatabase(){
    const assignedItems = await this.getAndUpdateAssignedItems(); // get order items that are in assigned state.
        
    if (assignedItems.length === 0) {
      return { message: 'No assigned order items found' };
    }
    await this.calculateProductRequirements(assignedItems);
    return { message: 'Assigned order items processed successfully'};
  }

  public async triggerLicensePlateService(license_plate_id: string){
    // get all the orderItems in assigned state and license plate = license_plate_id
    const assignedOrderItems = await this.orderItemRepository.find({
      where:{
        status: OrderItemStatus.ASSIGNED,
        license_plate_id: license_plate_id,
      },
      relations: ['assignedGtpLocation', 'assignedGtpLocation.station']
    });
    if (assignedOrderItems.length === 0) {
      console.log(`No assigned order items found for license plate ${license_plate_id}`);
      return { message: 'No assigned order items found' };
    }
    console.log(`Assigned order items for license plate ${license_plate_id}: ${JSON.stringify(assignedOrderItems)}`);
    // update the status to in_progress
    for (const orderItem of assignedOrderItems) {
      orderItem.status = OrderItemStatus.IN_PROGRESS;
      await this.orderItemRepository.save(orderItem);
    }
    console.log(`License plate ${license_plate_id} started successfully`);
    await this.calculateProductRequirements(assignedOrderItems);
    return { message: 'License plate started successfully' };
  }
  
  public async triggerOrchestrator() {
      if (this.orchestratorWorking) {
        this.logger.warn('Orchestrator is already running - skipping manual trigger');
        return {"message": "Service is already running, Try again in few seconds."};
      }
      try{
        this.orchestratorWorking  = true;

        // add a function that sends a task again
        await this.resendPendingTasks();

        await this.scheduleLPtoPickLocation();
        // check if a there is lp plate waiting for a pick location

        const stations = await this.stationRepository.find();
        for (const station of stations) {
          if (station.status === LocationStatus.AVAILABLE){
            await this.handleStationToWaitCancel(station.station_id);
          }
        }

        const cancelledStationIds = await this.stationService.getCancelledStations(); // get all the cancelled stations.

        // create tasks from all the cancelled stations to their respective inventories
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
              // if (robotId){
              //   await this.freeRobot(robotId);
              // }
              if (firstTask && lastTask && inventory && inventory.status === LocationStatus.AVAILABLE) {
                const reserved = await this.inventoryService.reserveInventory(inventory.id);
                if (!reserved) {
                  this.logger.warn(`Inventory ${inventory.id} couldn't be reserved.`);
                  continue;
                }
                const [newTaskID, newTask] = await this.createTask({
                  batchId: lastTask.batch_id,
                  productId: lastTask.product_id,
                  sourceStationId: station.station_id,
                  destinationInventoryId: firstTask.start_location.location_id,
                  quantity: lastTask.quantity,
                  taskType: TaskType.GOODS_TO_PERSON,
                  move_type: MOVE_TYPE.STATION_TO_INVENTORY,
                  sequenceOrder: lastTask.sequence_order + 1,
                  taskDependency: lastTask.task_id,
                  robotId: lastTask.robot_id
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
        // now process all the order items that are in assigned state.
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
            // 2. Check if this GTP location is already assigned to any order item 
            // in pending, assigned, or in_progress state
            const existingAssignment = await this.orderItemRepository.findOne({
                where: { 
                    assigned_gtp_location: gtpLocationId,
                    status: In([OrderItemStatus.PENDING, OrderItemStatus.IN_PROGRESS, OrderItemStatus.ASSIGNED])
                }
            });
            // If GTP location is already assigned, skip it
            if (existingAssignment) {continue;}
            
            // 3. Find all mappings for this available GTP location
            const scheduleMappings = await this.scheduleMappingRepository.find({
                where: {
                    gtp_location_id: gtpLocationId
                }
            });
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
                where: { license_plate_id: mostRecentLP, assigned_gtp_location: IsNull(), status: OrderItemStatus.PENDING },
              });
              for (const orderItem of orderItemsWithMostRecentLP) {
                // 5. Assign current GTP location to ALL order items with this LP
                // and set their status to assigned
                orderItem.assigned_gtp_location = gtpLocationId;
                orderItem.status = OrderItemStatus.ASSIGNED;
                await this.orderItemRepository.save(orderItem);
              }
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

  async resendPendingTasks() {
    try {
      const twoMinutesAgo = new Date(Date.now() - 1 * 60 * 1000);
      const pendingTasks = await this.taskRepository.find({
        where: { 
          status: TaskStatus.PENDING,
          created_at: LessThan(twoMinutesAgo)
        },
        order: { created_at: 'ASC' } // FIFO order
      });
      if (pendingTasks.length === 0) {return;}
      for (const task of pendingTasks) {
        this.sendSingleTaskToWms(task);
      }
    } catch(error){
      this.logger.error(`Error resending pending tasks: ${error.message}`);
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

      // if (remainingRequirements.length === 0) {
      //   // No more stations to visit - calculate remaining quantity and return to inventory
      //   const remainingQuantity = await this.calculateRemainingQuantityAfterDrop(completedTask);
      //   await this.createReturnToInventoryTask(completedTask, remainingQuantity);
        
      //   // Check if batch is completed
      //   await this.checkAndUpdateBatchCompletion(completedTask.batch_id);
      //   return;
      // }

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
        taskDependency: completedTask.task_id,
        robotId: completedTask.robot_id
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
        await this.releaseStation(sourceStationId);
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
      } else {
        this.logger.log(`Task ${processingTask.task_id} source is ${sourceLocationType} (${sourceStationId}) - no station release needed`);
      }
    } catch (error) {
      this.logger.error(`Error handling task processing for ${processingTask.task_id}:`, error.message);
      throw error;
    }
  }

  async handleStationToWaitCancel(stationId:string){
    const prdReqForStation = await this.getProductRequirementsByStationId(stationId);
    if (prdReqForStation.length > 0){
      const reservationStatus = await this.stationService.reserveStation(stationId);
      if (!reservationStatus) return;
    }
    for (const requirement of prdReqForStation) {
      const product_id = requirement.product_id;
      const carrying_task = await this.taskRepository.findOne({
        where: { product_id: product_id, status: In([TaskStatus.PROCESSING]), move_type: In([MOVE_TYPE.STATION_TO_WAITING_LOCATION, MOVE_TYPE.INVENTORY_TO_WAITING_LOCATION]) }
      });
      try{
        if (carrying_task && carrying_task.robot_id) {
          const firstTask = await this.taskRepository.findOne({where: { batch_id: carrying_task.batch_id, sequence_order: 1 }});
          const inventoryId = firstTask?.start_location?.location_id;
          const inventory = await this.inventoryRepository.findOne({where: { id: inventoryId }});
          if (inventory && inventory.quantity - inventory.defective_quantity - inventory.missing_quantity <= 0){continue;}
          console.log(`cancel at release station.`)
          // reserve the current station
          const response = await this.CancelTask(carrying_task);
          await this.taskRepository.update({ task_id: carrying_task.task_id }, { status: TaskStatus.CANCELLED });
          await this.waitingLocationRepository.update({ location_id: carrying_task.end_location.location_id }, { status: LocationStatus.AVAILABLE, holded_by: null });
          const [task_id, task] = await this.createTask({
            batchId: carrying_task.batch_id,
            productId: product_id,
            sourceStationId: stationId,
            destinationStationId: stationId,
            quantity: carrying_task.quantity,
            taskType: TaskType.GOODS_TO_PERSON,
            robotId: carrying_task.robot_id,
            move_type: MOVE_TYPE.STATION_TO_STATION,
            sequenceOrder: carrying_task.sequence_order+1, 
            taskDependency: carrying_task.task_id
          });
          if (task && task_id){
            await this.stationRepository.update(
              { station_id: stationId },
              { status: LocationStatus.RESERVED, holded_by: task_id }
            );
            await this.sendSingleTaskToWms(task);
            return;
          }
        }
      }
      catch(error){
        this.releaseStation(stationId);
        this.logger.error(`Error processing product requirement for station ${stationId}:`, error.message);
      }
    }
    this.releaseStation(stationId);
  }
  /**
   * Release a station and make it available for other tasks
   * Also process any pending station requests for this station
   */
  async releaseStation(stationId: string): Promise<void> {
    
    // Mark station as available
    await this.stationRepository.update(
      { station_id: stationId },
      { 
        status: LocationStatus.AVAILABLE,
        holded_by: null
      }
    );
  }

  private async loadProductRequirementsFromDatabase(): Promise<ProductRequirement[]> {
    this.logger.log('Loading product requirements from database...');
    
    // Load all product requirements from database
    const dbRequirements = await this.productRequirementRepository.find({
      where: { isPaused: false , isCancelled: false},
      order: { product_id: 'ASC', station_id: 'ASC' }
    });
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
      where: { task_id: taskId }, 
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

    // Mark completed inventory/station/waiting to station tasks as cancelled
    await this.taskRepository.update(
      { 
        status: TaskStatus.COMPLETED,
        move_type: In([MOVE_TYPE.INVENTORY_TO_STATION, MOVE_TYPE.STATION_TO_STATION, MOVE_TYPE.WAITING_LOCATION_TO_STATION, MOVE_TYPE.STATION_TO_WAITING_LOCATION, MOVE_TYPE.INVENTORY_TO_WAITING_LOCATION])
      },
      { status: TaskStatus.CANCELLED }
    );
    await this.orderItemRepository.update(
      { status: In([OrderItemStatus.PENDING, OrderItemStatus.ASSIGNED, OrderItemStatus.IN_PROGRESS]) },
      { status: OrderItemStatus.CANCELLED }
    );
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

  async getPredictedRobots(){
    const orderItems = await this.orderItemRepository.find({
      where: { status: In([OrderItemStatus.PENDING, OrderItemStatus.ASSIGNED, OrderItemStatus.IN_PROGRESS]) },
    });
    const uniqueProducts = new Set(orderItems.map(item => item.product_id)); // unique product IDS
    const setOfUniqueGTP = new Set(orderItems.map(item => item.assigned_gtp_location));
    const inventory_to_waiting_locations = await this.waitingLocationRepository.find({
        where: { type: WaitingLocationType.INVENTORY_TO_STATION }
    });
    const uniqueStations = new Set();
    for (const gtpLocationId of setOfUniqueGTP) {
      if (!gtpLocationId) continue;
      const gtpLocation = await this.gtpLocationRepository.findOne({
        where: { gtp_location_id: gtpLocationId }
      });
      if (gtpLocation && gtpLocation.station_id) {
        uniqueStations.add(gtpLocation.station_id);
      }
    }
    const numberOfUniqueStations = uniqueStations.size;
    let x = uniqueProducts.size;
    let y = numberOfUniqueStations;
    let z = inventory_to_waiting_locations.length;
    let l = Math.min(x, y+z);
    let h = 2*y;
    let predicted = Math.ceil((l + h) / 2);

    console.log(`Predicted Robots: ${predicted} (Unique Products: ${x}, Unique Stations: ${y}, Inventory to Waiting Locations: ${z})`);

    return {
      "predicted": predicted,
    }

  }

  async performErrorCheck(){
    const currentTime = new Date();

    const longOccupiedWaitingLocations = await this.waitingLocationRepository.find({
      where: {
        status: In([LocationStatus.RESERVED, LocationStatus.OCCUPIED]),
      }
    });

    const messages: string[] = [];
    for (const waitingLocation of longOccupiedWaitingLocations) {
      const timeDiff = Math.floor((currentTime.getTime() - waitingLocation.updated_at.getTime()) / (1000 * 60));
      if (timeDiff >= 5) {
        messages.push(`Waiting location ${waitingLocation.location_id} has been ${waitingLocation.status.toLowerCase()} for ${timeDiff} minutes (since last status update)`);
      }
    }

    const longOccupiedStations = await this.stationRepository.find({
      where: {
        status: In([LocationStatus.RESERVED, LocationStatus.OCCUPIED]),
      }
    });

    const stationMessages: string[] = [];
    for (const station of longOccupiedStations) {
      const timeDiff = Math.floor((currentTime.getTime() - station.updated_at.getTime()) / (1000 * 60));
      if (timeDiff >= 5) {
        stationMessages.push(`Station ${station.station_id} has been ${station.status.toLowerCase()} for ${timeDiff} minutes (since last status update)`);
      }
    }

    messages.push(...stationMessages);

    const longPendingTasks = await this.taskRepository.find({
      where: {
        status: TaskStatus.PENDING,
      }
    });

    const taskMessages: string[] = [];
    for (const task of longPendingTasks) {
      const timeDiff = Math.floor((currentTime.getTime() - task.created_at.getTime()) / (1000 * 60));
      if (timeDiff >= 3) {
        taskMessages.push(`Task ${task.task_id} has been PENDING for ${timeDiff} minutes (since creation)`);
      }
    }

    messages.push(...taskMessages);

    const longIncompleteOrderItems = await this.orderItemRepository.find({
      where: {
      status: In([OrderItemStatus.PENDING, OrderItemStatus.ASSIGNED, OrderItemStatus.IN_PROGRESS]),
      },
    });

    // Group by order_id to get unique orders
    const orderGroups = new Map<string, any[]>();
    for (const orderItem of longIncompleteOrderItems) {
      if (!orderGroups.has(orderItem.order_id)) {
      orderGroups.set(orderItem.order_id, []);
      }
      orderGroups.get(orderItem.order_id)!.push(orderItem);
    }

    const longIncompleteOrders = Array.from(orderGroups.entries()).map(([orderId, items]) => ({
      order_id: orderId,
      oldest_item: items[0], // First item (oldest due to ASC sort)
      product_ids: [...new Set(items.map(item => item.product_id))], // Unique product IDs
      item_count: items.length
    }));

    const orderMessages: string[] = [];
    for (const order of longIncompleteOrders) {
      const oldestOrderItem = await this.orderItemRepository.findOne({
        where: { 
          order_id: order.order_id,
          status: In([OrderItemStatus.PENDING, OrderItemStatus.ASSIGNED, OrderItemStatus.IN_PROGRESS])
        },
        order: { created_at: 'ASC' }
      });
      
      if (oldestOrderItem) {
        const timeDiff = Math.floor((currentTime.getTime() - oldestOrderItem.created_at.getTime()) / (1000 * 60));
        if (timeDiff >= 15) {
          orderMessages.push(`Order ${order.order_id} has been incomplete for ${timeDiff} minutes (since creation)`);
        }
      }
    }

    messages.push(...orderMessages);

    const longProcessingTasks = await this.taskRepository.find({
      where: {
        status: TaskStatus.PROCESSING,
      }
    });

    const processingTaskMessages: string[] = [];
    for (const task of longProcessingTasks) {
      const timeDiff = Math.floor((currentTime.getTime() - task.updated_at.getTime()) / (1000 * 60));
      if (timeDiff >= 10) {
        processingTaskMessages.push(`Robot ${task.robot_id} has been PROCESSING for ${timeDiff} minutes (since last status update)`);
      }
    }

    messages.push(...processingTaskMessages);

    return {
      messages: messages,
      count: messages.length
    };
  }

  async getTasksByRobotId(robotId: string){
    return await this.taskRepository.find({
      where: { robot_id: robotId },
      order: { created_at: 'ASC' },
      select: ['start_location','end_location','batch_id','inqueue', 'processing','triggered','completed','created_at']
    });
  }

  async getAllRobots(){
    const moving_tasks = await this.taskRepository.find({
      where: { status: TaskStatus.PROCESSING }
    });
    const res : any[] = [];
    const robots = moving_tasks.map(task => task.robot_id);
    for(const robot of robots){
      res.push({
        'id': robot,
        'status': 'working'
      })
    }
    const station_robots = await this.taskRepository.find({
      where: {status: TaskStatus.COMPLETED, move_type: In([
        MOVE_TYPE.STATION_TO_WAITING_LOCATION,
        MOVE_TYPE.INVENTORY_TO_STATION,
        MOVE_TYPE.INVENTORY_TO_WAITING_LOCATION,
        MOVE_TYPE.STATION_TO_STATION,
        MOVE_TYPE.WAITING_LOCATION_TO_STATION,
      ])
    }
    })
    for (const task of station_robots){
      res.push({
        'id': task.robot_id,
        'status': 'working'
      });
    }
    return res;
  }

  async getRobotReport(startDate: Date | undefined, endDate: Date | undefined) {
    console.log(`Generating robot report from ${startDate} to ${endDate}`);
    const whereCondition: any = {};
    if (startDate && endDate) {
      whereCondition.created_at = Between(startDate, endDate);
    }
    else if (startDate){
      whereCondition.created_at = MoreThanOrEqual(startDate);
    }
    else if (endDate){
      whereCondition.created_at = LessThanOrEqual(endDate);
    }
    console.log(whereCondition);
    const allTasks = await this.taskRepository.find({
      where: whereCondition,
    });
    // keep a set of all the robot IDs used in allTasks
    const robotIds = new Set<string>();
    allTasks.forEach(task => {
      if (task.robot_id) {
        robotIds.add(task.robot_id);
      }
    });
    const allRobotIds = Array.from(robotIds);
    const res = {};
    for (const robotId of allRobotIds){
      const filteredTasks = allTasks.filter(task => task.robot_id === robotId);
      if (filteredTasks.length == 0) continue;
      if (!res[robotId]) {
        res[robotId] = {
          totalTasks: filteredTasks.length,
          travel_time: [],
          wait_time: [],
          unloading_time: []
        };
      }
      // get travel_time
      for (const task of filteredTasks){
        if (task.processing && task.completed){
          const travelTime = Math.floor((Number(task.completed) - Number(task.processing)) / 1000);
          res[robotId].travel_time.push(travelTime);
        }
      }

      // get unloading time
      for (const task of filteredTasks){
        if (task.end_location.location_attribute?.attribute_value === 'station' && task.completed && task.triggered){
          const unloadingTime = Math.floor((Number(task.triggered) - Number(task.completed)) / 1000);
          res[robotId].unloading_time.push(unloadingTime);
        }
      }

      // get waiting time
      for (const task of filteredTasks){
        if (task.end_location.location_attribute?.attribute_value === 'waiting_location' && task.completed && task.status !== TaskStatus.CANCELLED){
          // Find the next task in the same batch with sequence order + 1
          const nextTask = await this.taskRepository.findOne({
            where: {
              batch_id: task.batch_id,
              sequence_order: task.sequence_order + 1
            }
          });

          if (nextTask && nextTask.processing && task.completed) {
            const waitTime = Math.floor((Number(nextTask.processing) - Number(task.completed)) / 1000);
            res[robotId].wait_time.push(waitTime);
          }
        }
      }
    }
    return res;

  }

  async getMovementReport(startDate: Date | undefined, endDate: Date | undefined){
    const whereCondition: any = {};
    if (startDate && endDate) {
      whereCondition.created_at = Between(startDate, endDate);
    }
    else if (startDate){
      whereCondition.created_at = MoreThanOrEqual(startDate);
    }
    else if (endDate){
      whereCondition.created_at = LessThanOrEqual(endDate);
    }
    const allTasks = await this.taskRepository.find({
      where: whereCondition,
    });
    const res: Record<string, number[]> = {
      "InventoryToStation": [],
      "InventoryToWaitingLocation": [],
      "StationToWaitingLocation": [],
      "WaitingLocationToStation": [],
      "StationToStation": [],
      "StationToInventory": [],
      "WaitingLocationToInventory": [],
    };
    for (const task of allTasks){
      if (task.move_type === MOVE_TYPE.INVENTORY_TO_STATION){
        if (task.processing && task.completed) {
          const travelTime = Math.floor((Number(task.completed) - Number(task.processing)) / 1000);
          res.InventoryToStation.push(travelTime);
        }
      }else if (task.move_type === MOVE_TYPE.INVENTORY_TO_WAITING_LOCATION){
        if (task.processing && task.completed) {
          const travelTime = Math.floor((Number(task.completed) - Number(task.processing)) / 1000);
          res.InventoryToWaitingLocation.push(travelTime);
        }
      }else if (task.move_type === MOVE_TYPE.STATION_TO_WAITING_LOCATION){
        if (task.processing && task.completed) {
          const travelTime = Math.floor((Number(task.completed) - Number(task.processing)) / 1000);
          res.StationToWaitingLocation.push(travelTime);
        }
      }else if (task.move_type === MOVE_TYPE.WAITING_LOCATION_TO_STATION){
        if (task.processing && task.completed) {
          const travelTime = Math.floor((Number(task.completed) - Number(task.processing)) / 1000);
          res.WaitingLocationToStation.push(travelTime);
        }
      }else if (task.move_type === MOVE_TYPE.STATION_TO_STATION){
        if (task.processing && task.completed) {
          const travelTime = Math.floor((Number(task.completed) - Number(task.processing)) / 1000);
          res.StationToStation.push(travelTime);
        }
      }else if (task.move_type === MOVE_TYPE.STATION_TO_INVENTORY){
        if (task.processing && task.completed) {
          const travelTime = Math.floor((Number(task.completed) - Number(task.processing)) / 1000);
          res.StationToInventory.push(travelTime);
        }
      }else if (task.move_type === MOVE_TYPE.WAITING_LOCATION_TO_INVENTORY){
        if (task.processing && task.completed) {
          const travelTime = Math.floor((Number(task.completed) - Number(task.processing)) / 1000);
          res.WaitingLocationToInventory.push(travelTime);
        }
      }
    }
    return res;
  }

  async getTasksByStatus(statusList: string[], start_time: Date | undefined, end_time: Date | undefined) {
    const whereCondition: any = {};

    if (!statusList || statusList.length === 0) {
      throw new BadRequestException('Status is required');
    }
    const results: TaskDetails[] = [];
    const TaskItems: Task[] = [];
    if (start_time && end_time) {
      whereCondition.created_at = Between(start_time, end_time);
    }
    else if (start_time){
      whereCondition.created_at = MoreThanOrEqual(start_time);
    }
    else if (end_time){
      whereCondition.created_at = LessThan(end_time);
    }
    if (statusList.includes('all')) {
      TaskItems.push(...await this.taskRepository.find({
        where: whereCondition,
        order: { created_at: 'DESC' }
      }));
    }
    if (statusList.includes('pending')) {
      TaskItems.push(...await this.taskRepository.find({
        where: { ...whereCondition, status: TaskStatus.PENDING },
        order: { created_at: 'DESC' }
      }));
    }
    if (statusList.includes('processing')) {
      TaskItems.push(...await this.taskRepository.find({
        where: { ...whereCondition, status: TaskStatus.PROCESSING },
        order: { created_at: 'DESC' }
      }));
    }
    if (statusList.includes('completed')) {
      TaskItems.push(...await this.taskRepository.find({
        where: { ...whereCondition, status: TaskStatus.COMPLETED },
        order: { created_at: 'DESC' }
      }));
    }
    if (statusList.includes('cancelled')) {
      TaskItems.push(...await this.taskRepository.find({
        where: { ...whereCondition, status: TaskStatus.CANCELLED },
        order: { created_at: 'DESC' }
      }));
    }
    for (const task of TaskItems) {
      const taskDetails: TaskDetails = {
        task_id: task.task_id,
        batch_id: task.fms_batch_id,
        product_id: task.product_id,
        quantity: task.quantity,
        move_type: task.move_type,
        status: task.status,
        robot_id: task.robot_id,
        start_location_id: task.start_location.location_id,
        end_location_id: task.end_location.location_id,
        created_at: task.created_at,
        updated_at: task.updated_at,
      }
      results.push(taskDetails);
    }
    return results;
  }

  async getTravelAnalysisMovements(
    sourceType: string,
    sourceLocations: string[],
    destinationType: string,
    startDate?: Date,
    endDate?: Date
  ) {
    if (!sourceType || !sourceLocations || !destinationType) {
      throw new BadRequestException('sourceType, sourceLocation, and destinationType are required');
    }
    const res: any = {};
    for (const loc of sourceLocations){
      res[loc] = {};
      let source_location: any;
      if (sourceType === 'station'){
        source_location = await this.stationRepository.findOne({
          where: { station_id: loc }
        });
      }else if (sourceType === 'waiting_location'){
        source_location = await this.waitingLocationRepository.findOne({
          where: { location_id: loc }
        });
      }else if (sourceType === 'inventory'){
        source_location = await this.inventoryRepository.findOne({
          where: { id: loc },
        });
      }

      const whereCondition: any = {
        status: In([TaskStatus.COMPLETED])
      };
      if (startDate && endDate) {
        whereCondition.created_at = Between(startDate, endDate);
      }
      else if (startDate){
        whereCondition.created_at = MoreThanOrEqual(startDate);
      }
      else if (endDate){
        whereCondition.created_at = LessThanOrEqual(endDate);
      }
      whereCondition.status = TaskStatus.COMPLETED;
      const allTasks = await this.taskRepository.find({
        where: whereCondition,
      });
      console.log(`where condition: ${JSON.stringify(whereCondition)}`);
      console.log(`all tasks: ${allTasks.length}`);
      console.log(`source location: ${JSON.stringify(source_location)}`);
      console.log(`destination type: ${JSON.stringify(destinationType)}`);
      
      for (const task of allTasks){
        if ((task.start_location.location_id === source_location.location_id ||
            task.start_location.location_id === source_location.id ||
            task.start_location.location_id === source_location.station_id) &&
            task.end_location.location_attribute?.attribute_value === destinationType){
          if(!res[loc][task.end_location.location_id]){
            res[loc][task.end_location.location_id] = [];
          }
          if (task.processing && task.completed) {
            const travelTime = Math.floor((Number(task.completed) - Number(task.processing)) / 1000);
            res[loc][task.end_location.location_id].push(travelTime);
          }
        }
      }
    }
    
    return res;
  }

  async updateTotalRobots(totalRobots: number) {
    const result = await this.robotRepository
      .createQueryBuilder()
      .select('COUNT(*)', 'count')
      .getRawOne();

    if (result.count === 0) {
      await this.robotRepository.save({
        id: crypto.randomUUID(),
        is_waiting: false,
        total_robots: totalRobots,
        robot_in_use: 0
      });
      return;
    }

    // Check if any order is in progress state
    const inProgressOrders = await this.orderItemRepository.findOne({
      where: { status: OrderItemStatus.IN_PROGRESS }
    });

    if (inProgressOrders) {
      throw new BadRequestException('Cannot update total robots while orders are in progress');
    }
    const robotRecord = (await this.robotRepository.find())[0];

    await this.robotRepository.update({ id: robotRecord.id }, { total_robots: totalRobots });
  }

  async getTotalRobots() {
    const result = await this.robotRepository.find();
    if (result.length === 0) {
      return 0;
    }
    return result[0].total_robots;
  }
}