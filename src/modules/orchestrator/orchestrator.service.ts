import { BadRequestException, Inject, Injectable, Logger, Move, NotFoundException } from '@nestjs/common';
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
import { RobotCount } from 'src/entities/robot-count.entity';
import { OperationType } from 'src/entities/robot-count.entity';
import { BaseopsTaskService } from '../baseops_task/baseops_task.service';
import { EmptyLocation } from 'src/entities/empty-location.entity';
import { EmptyLocationsService } from '../empty_locations/empty_locations.service';
import { truncate } from 'fs';
import { Settings } from 'src/entities/settings.entity';
import { SettingsService } from '../settings/settings.service';
import { Robot, RobotStatus } from 'src/entities/robots.entity';

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
  originLocation: string;
  stationId: string;
}

export interface TaskDetails{
  task_id: string;
  display_task_id: number;
  batch_id: string;
  fms_batch_id?: string | null;
  origin_location: string;
  robot_id: string;
  move_type: MOVE_TYPE;
  status: TaskStatus;
  start_location_id: string;
  end_location_id: string;
  created_at: Date;
  updated_at: Date;
  pallet_id: string | null;
  priority: number;
  batch_priority: number;
  orderItems: OrderItem[];
  sequence_order?: number;
  inqueue?: Date;
  processing?: Date;
  completed?: Date;
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
    @InjectRepository(RobotCount)
    private readonly robotCountRepository: Repository<RobotCount>,
    @InjectRepository(EmptyLocation)
    private readonly emptyLocationRepository: Repository<EmptyLocation>,
    @InjectRepository(Settings)
    private readonly settingsRepository: Repository<Settings>,
    @InjectRepository(Robot)
    private readonly robotRepository: Repository<Robot>,
    private readonly emptyLocationsService: EmptyLocationsService,
    private readonly inventoryService: InventoryService,
    private readonly httpService: HttpService,
    private readonly loggingService: LoggingService,
    private readonly stationService: StationsService,
    private readonly waitingLocationService: WaitingLocationService,
    private readonly baseOpsService: BaseopsTaskService,
    private readonly settingsService: SettingsService,
  ) {}

  async processAssignedOrderItems() {
    try {
      // Calculate product requirements and sort by descending order
      let productRequirements = new Set<String>();
      const dbRequirements = await this.productRequirementRepository.find({
        where: { isPaused: false , isCancelled: false},
        order: { source_location_id: 'ASC', station_id: 'ASC' }
      });
      for (const dbReq of dbRequirements) {
        productRequirements.add(dbReq.source_location_id);
      }
      console.log(`Current Product Requirement: ${JSON.stringify(productRequirements)}`);
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

          const nextTaskOfSequence = await this.taskRepository.findOne({where: { batch_id: task.batch_id, task_dependency: task.task_id }});
          if (nextTaskOfSequence) {
            // there is already a next task created for this batch - skip
            console.log(`There is already a next task created for this batch - skipping`);
            continue;
          }

          // Check if this task's product is in the current requirements
          const hasRequirement = productRequirements.has(task.origin_location);

          // the product at waiting location has no requirement and it is not paused as well - return to inventory.
          if (!hasRequirement) {
            await this.createSendToEmptyLocationTask(task, true);
          }
          else{
            const inventoryID = task.origin_location;
            const inventory = await this.inventoryRepository.findOne({
              where: { id: inventoryID }
            });
            if (inventory?.is_empty){continue;}
            // find all product requirements for this product that is not paused
            const databaseRequirement = await this.productRequirementRepository.find({
              where : { source_location_id: task.origin_location, isPaused: false},
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
                  originLocation: task.origin_location,
                  sourceWaitingLocationId: waitingLocation.location_id,
                  destinationStationId: station.station_id,
                  robotId: task.robot_id,
                  taskType: TaskType.GOODS_TO_PERSON,
                  move_type: MOVE_TYPE.WAITING_LOCATION_TO_STATION,
                  sequenceOrder: task.sequence_order + 1, // Next sequence order
                  taskDependency: task.task_id, // Use last task of batch as dependency
                  cargos: task.cargos
                });
                if (!returnTask) {
                  await this.stationRepository.update(station.station_id, { status: LocationStatus.AVAILABLE });
                  continue;
                }
                await this.reserveStationAndSendTask(returnTask, station); // Reserve the station and send task to WMS
                await this.loggingService.log(`Station ${station.station_id}: Marked as Occupied`, returnTask.task_type, returnTask.task_id, null); 
                this.logger.log(`New Task: ${returnTaskId}, Origin Location: ${task.origin_location}, start location: ${waitingLocation.location_id} (waiting location), destination location: ${station.station_id} (station)`);
                await this.loggingService.log(`New Task: ${returnTaskId}, Origin Location: ${task.origin_location}, start location: ${waitingLocation.location_id} (waiting location), destination location: ${station.station_id} (station)`
                  , returnTask.task_type, returnTask.task_id, null
                );
                break; // Exit loop after processing first available station
              }
            }
          }
        }
      }
      if (productRequirements.size === 0){
        return;
      }
      this.logger.log(`Current product requirement length: ${productRequirements.size}`);
      for (const requirement of productRequirements) {
        // check if the system is in waiting state
        const isWaiting = await this.checkIfSystemIsInWaitingState();
        if (isWaiting){break;}
        await this.processInventoryRequirement(requirement.toString());
      }
      return { message: 'Orchestrator process completed successfully' };
      
    } catch (error) {
      return { message: 'Orchestrator process completed', error: error.message };
    }
  }

  async isRobotAvailable(): Promise<boolean> {
    const robots = await this.robotCountRepository.find({where:{operation_type: OperationType.FLOWOPS}});
    if (robots.length === 0){
      return false;
    }
    const robot = robots[0];
    return robot.total_robots - robot.robot_in_use > 0
  }
  async incrementRobotInUse(): Promise<void> {
    console.log('increment robot in use count');
    const queryRunner = this.robotCountRepository.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
        // Atomic increment - no race condition possible
        const result = await queryRunner.manager
            .createQueryBuilder()
            .update(RobotCount)
            .set({ 
                robot_in_use: () => "robot_in_use + 1" 
            })
            .where("operation_type = :opType", { opType: OperationType.FLOWOPS })
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
    const queryRunner = this.robotCountRepository.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
        // Atomic decrement with safety check to prevent negative values
        const result = await queryRunner.manager
            .createQueryBuilder()
            .update(RobotCount)
            .set({ 
                robot_in_use: () => "GREATEST(robot_in_use - 1, 0)" 
            })
            .where("operation_type = :opType", { opType: OperationType.FLOWOPS })
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
    const robots = await this.robotCountRepository.find({where: {operation_type: OperationType.FLOWOPS}});
    if (robots.length === 0){
      return false;
    }
    const isWaiting = robots[0].is_waiting;
    return isWaiting;
  }

  async markSystemAsWaiting(): Promise<void> {
    const queryRunner = this.robotCountRepository.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    
    try {
      const robots = await queryRunner.manager.find(RobotCount, {
        where: { operation_type: OperationType.FLOWOPS }
      });
      if (robots.length === 0) {
      throw new Error('No Robot Entry Found');
      }
      await queryRunner.manager.update(
        RobotCount,
        { id: robots[0].id, operation_type: OperationType.FLOWOPS },
        { is_waiting: true }
      );
      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  public async unmarkSystemAsWaiting(): Promise<void> {
    const queryRunner = this.robotCountRepository.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const robots = await queryRunner.manager.find(RobotCount, {
        where: { operation_type: OperationType.FLOWOPS }
      });
      if (robots.length === 0) {
        throw new Error('No Robot Entry Found');
      }
      await queryRunner.manager.update(RobotCount, 
        { id: robots[0].id, operation_type: OperationType.FLOWOPS }, 
        { is_waiting: false }
      );
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

  private async processInventoryRequirement(inventoryID: string): Promise<void> {

    // read the requirement of the product from the database
    const databaseRequirement = await this.productRequirementRepository.find({
      where : { source_location_id: inventoryID , isPaused: false, isCancelled: false },
      order: { station_id: 'ASC' }
    });

    // Get stations sorted by priority (ascending order) 
    const stationIds = databaseRequirement.map(pr => pr.station_id);
    let sortedStations = await this.getStationsSortedByPriority(stationIds);
    if (databaseRequirement.length > 0) {
      const taskComingToInventory = await this.taskRepository.findOne({
        where:{origin_location: inventoryID, status:TaskStatus.PROCESSING , move_type: In([MOVE_TYPE.WAITING_LOCATION_TO_INVENTORY, MOVE_TYPE.STATION_TO_INVENTORY])}
      })
      if (taskComingToInventory && taskComingToInventory.robot_id) {
        try{
          const inventory_id = taskComingToInventory.end_location.location_id;
          const inventory = await this.inventoryRepository.findOne({ where: { id: inventory_id } });
          if (inventory){
            let is_station_task_created = false;
            const robotIdToUse = taskComingToInventory.robot_id;
            for (const station of sortedStations) {
              const reserved = await this.stationService.reserveStation(station.station_id);
              if (!reserved) {
                continue;
              }
              try{
                await this.CancelTask(taskComingToInventory);
              }
              catch(error){
                this.logger.error(`Error cancelling task ${taskComingToInventory.task_id} before creating new task to station ${station.station_id}: ${error.message}`);
                await this.stationRepository.update(station.station_id, { status: LocationStatus.AVAILABLE });
                continue;
              }
              
              if (!robotIdToUse) {
                await this.stationRepository.update(station.station_id, { status: LocationStatus.AVAILABLE });
                return;
              }
              const batchId = taskComingToInventory.batch_id;
              const [returnTaskId, returnTask] = await this.createTask({
                batchId,
                originLocation: taskComingToInventory.origin_location,
                sourceStationId: station.station_id,
                destinationStationId: station.station_id,
                robotId: robotIdToUse,
                taskType: TaskType.GOODS_TO_PERSON,
                move_type: MOVE_TYPE.STATION_TO_STATION,
                sequenceOrder: taskComingToInventory.sequence_order + 1, // Next sequence order
                taskDependency: taskComingToInventory.task_id, // Use last task of batch as dependency
                cargos: taskComingToInventory.cargos,
              });
              if (!returnTask) {
                await this.stationRepository.update(station.station_id, { status: LocationStatus.AVAILABLE });
                continue;
              }
              await this.inventoryRepository.update(inventory.id, { status: LocationStatus.AVAILABLE });
              await this.taskRepository.update({task_id: taskComingToInventory.task_id},{status: TaskStatus.CANCELLED});
              await this.reserveStationAndSendTask(returnTask, station); // Reserve the station and send task to WMS
              // remove the robotIdToUse from idleRobot list
              // Remove this station from sortedStations to prevent creating another task for the same station
              sortedStations = sortedStations.filter(st => st.station_id !== station.station_id);
              await this.loggingService.log(`Cancel Task: ${taskComingToInventory.task_id} and create new Task: ${returnTaskId}, start location: ${taskComingToInventory.end_location.location_id} (inventory), destination location: ${station.station_id} (station)`, TaskType.GOODS_TO_PERSON, returnTaskId,null);

              await this.loggingService.log(`Reroute Task: ${taskComingToInventory.task_id}, Initial destination: ${taskComingToInventory.end_location.location_id}, New Destination: ${station.station_id}, new requirement found at destination`, TaskType.GOODS_TO_PERSON, taskComingToInventory.task_id,null);
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
              if (!robotIdToUse) {
                await this.waitingLocationRepository.update(waitLocation.location_id, { status: LocationStatus.AVAILABLE });
                break;
              }
              const batchId = taskComingToInventory.batch_id;
              try{
                await this.CancelTask(taskComingToInventory);
              }
              catch(error){
                this.logger.error(`Error cancelling task ${taskComingToInventory.task_id} before creating new task to waiting location ${waitLocation.location_id}: ${error.message}`);
                await this.waitingLocationRepository.update(waitLocation.location_id, { status: LocationStatus.AVAILABLE });
                continue;
              }
              
              console.log(`cancelling at db_req > 0 - waiting location`)
              const [returnTaskId, returnTask] = await this.createTask({
                batchId: batchId,
                originLocation: taskComingToInventory.origin_location,
                sourceWaitingLocationId: waitLocation.location_id,
                destinationWaitingLocationId: waitLocation.location_id,
                robotId: robotIdToUse,
                taskType: TaskType.GOODS_TO_PERSON,
                move_type: MOVE_TYPE.WAITING_TO_WAITING_LOCATION,
                sequenceOrder: taskComingToInventory.sequence_order + 1, // Next sequence order
                taskDependency: taskComingToInventory.task_id ,// Use last task of batch as dependency
                cargos: taskComingToInventory.cargos
              });
              if (returnTask) {
                await this.waitingLocationRepository.update({location_id: waitLocation.location_id},{status:LocationStatus.RESERVED, holded_by: returnTask.task_id});
                await this.inventoryRepository.update(inventory.id, { status: LocationStatus.AVAILABLE });
                await this.sendSingleTaskToWms(returnTask);
                await this.taskRepository.update({task_id: taskComingToInventory.task_id},{status: TaskStatus.CANCELLED});
                this.logger.log(`New Task: ${returnTaskId}, Origin Location: ${returnTask.origin_location}, Start Location: ${returnTask.start_location.location_id} (inventory), Destination Location: ${waitLocation.location_id} (waiting location)`);
                await this.loggingService.log(`Cancel Task: ${taskComingToInventory.task_id} and create new Task: ${returnTaskId}, start location: ${taskComingToInventory.end_location.location_id} (inventory), destination location: ${waitLocation.location_id} (station)`, TaskType.GOODS_TO_PERSON, returnTaskId,null);

                await this.loggingService.log(`Reroute Task: ${taskComingToInventory.task_id}, Initial destination: ${taskComingToInventory.end_location.location_id}, New Destination: ${waitLocation.location_id}, there is requirement in system but station is not available`, TaskType.GOODS_TO_PERSON, taskComingToInventory.task_id,null);
                is_station_task_created = true;
                break;
                }
              if (!returnTask){
                await this.waitingLocationRepository.update({location_id: waitLocation.location_id},{status:LocationStatus.AVAILABLE, holded_by: null});
                // await this.stationRepository.update(taskComingToInventory.start_location.location_id, { status: LocationStatus.AVAILABLE, holded_by: null });
              }
            }
          }
        }
        catch (error) {
          this.logger.error(`Error cancelling task ${taskComingToInventory.task_id}: ${error.message}`);
        }
      }
      
    }

    if (databaseRequirement.length > 0){
      const taskToWaitingLocation = await this.taskRepository.findOne({
        where: { origin_location: inventoryID, status: In([TaskStatus.PROCESSING]), move_type: In([MOVE_TYPE.INVENTORY_TO_WAITING_LOCATION]) }
      });
      if (taskToWaitingLocation && taskToWaitingLocation.robot_id) {
        // If a task is found, we can use it
        this.logger.log(`Found existing task for product ${inventoryID}: ${taskToWaitingLocation.task_id}`);
        for (const station of sortedStations){
          if (station.status === LocationStatus.AVAILABLE) {
            const reserved = await this.stationService.reserveStation(station.station_id);
            if (!reserved) {  
              continue;
            }
            try{
              await this.CancelTask(taskToWaitingLocation);
            }
            catch(error){
              this.logger.error(`Error cancelling task ${taskToWaitingLocation.task_id} before creating new task to station ${station.station_id}: ${error.message}`);
              await this.stationRepository.update(station.station_id, { status: LocationStatus.AVAILABLE });
              continue;
            }
            
            const [returnTaskId, returnTask] = await this.createTask({
              batchId: taskToWaitingLocation.batch_id,
              originLocation: inventoryID,
              sourceStationId: station.station_id,
              destinationStationId: station.station_id,
              robotId: taskToWaitingLocation.robot_id,
              taskType: TaskType.GOODS_TO_PERSON,
              move_type: MOVE_TYPE.STATION_TO_STATION,
              sequenceOrder: taskToWaitingLocation.sequence_order + 1, // Next sequence order
              taskDependency: taskToWaitingLocation.task_id, // Use last task of batch as dependency
              cargos: taskToWaitingLocation.cargos,
            });
            if (!returnTask) {
              await this.stationRepository.update(station.station_id, { status: LocationStatus.AVAILABLE });
              continue;
            }
            await this.waitingLocationRepository.update({ location_id: taskToWaitingLocation.end_location.location_id }, { status: LocationStatus.AVAILABLE, holded_by: null });
            await this.taskRepository.update({task_id: taskToWaitingLocation.task_id},{status: TaskStatus.CANCELLED});
            await this.reserveStationAndSendTask(returnTask, station); // Reserve the station and send task to WMS
            // remove the robotIdToUse from idleRobot list
            this.logger.log(`New Task: ${returnTaskId}, Origin Location: ${taskToWaitingLocation.origin_location}, start location: ${taskToWaitingLocation.end_location.location_id} (waiting location), destination location: ${station.station_id} (station)`);
            await this.loggingService.log(`Cancel Task: ${taskToWaitingLocation.task_id} and create new Task: ${returnTaskId}, start location: ${taskToWaitingLocation.end_location.location_id} (inventory), destination location: ${station.station_id} (station)`, TaskType.GOODS_TO_PERSON, returnTaskId,null);

            await this.loggingService.log(`Reroute Task: ${taskToWaitingLocation.task_id}, Initial destination: ${taskToWaitingLocation.end_location.location_id}, New Destination: ${station.station_id}, new requirement found at destination`, TaskType.GOODS_TO_PERSON, taskToWaitingLocation.task_id,null);
            sortedStations = sortedStations.filter(s => s.station_id !== station.station_id);
            break;
          }
        }
      }
    }

    console.log(`sorted Stations: ${JSON.stringify(sortedStations)}`);

    const isWaiting = await this.checkIfSystemIsInWaitingState();
    if (isWaiting){return;}
    const isRobotAvailable = await this.isRobotAvailable();
    if (!isRobotAvailable){return;}

    const inventory = await this.inventoryRepository.findOne({ where: { id: inventoryID, isProcessing: false, status: LocationStatus.AVAILABLE, is_active: true } });
    if (!inventory) {return;}

    const taskID = await this.createSingleTaskToFirstAvailableStation(
      inventory,
      sortedStations,
    );
    if (!taskID){
      this.logger.log(`No task created for inventory ${inventoryID}, all stations may be busy.`);
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
        await this.createBatch(batchId, inventory);
        const [returnTaskId, returnTask] = await this.createTask({
          batchId,
          originLocation: inventory.id,
          sourceInventoryId: inventory.id,
          destinationWaitingLocationId: waitingLocation.location_id,
          robotId: robotIdToUse,
          taskType: TaskType.GOODS_TO_PERSON,
          move_type: MOVE_TYPE.INVENTORY_TO_WAITING_LOCATION,
          sequenceOrder: 1, // First task in this batch
          taskDependency: null, // No dependency for first task
          cargos: null,
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

        await this.loggingService.log(`System marked as waiting state.`, TaskType.GOODS_TO_PERSON, returnTaskId, null);
        await this.incrementRobotInUse();
        await this.loggingService.log(`Robot in use incremented. Current robot in use: ${await this.getRobotInUse()}`, TaskType.GOODS_TO_PERSON, returnTaskId, null);
        // Send task to WMS
        await this.sendSingleTaskToWms(returnTask);
        // remove the robotIdToUse from idleRobot list
        this.logger.log(`New Task: ${returnTaskId}, start location: ${inventory.id} (inventory), destination location: ${waitingLocation.location_id} (waiting location)`);
        await this.loggingService.log(`New Task: ${returnTaskId}, start location: ${inventory.id} (inventory), destination location: ${waitingLocation.location_id} (waiting location)`,
          returnTask.task_type, returnTask.task_id, null
        );
        break;
      }
    }
  }

  async getRobotInUse(): Promise<number> {
    const robots = await this.robotCountRepository.find({where:{operation_type: OperationType.FLOWOPS}});
    if (robots.length === 0){
      return 0;
    }
    return robots[0].robot_in_use;
  }

  async CancelTask(parking_task: Task): Promise<any> {
    try {
      console.log(`Cancelling task ${parking_task.task_id}`);
      const warehouse_name = process.env.WMS_WAREHOUSE_NAME || 'warehouse';
      const warehouse_key = process.env.WMS_WAREHOUSE_AUTH_KEY || 'test'; // Fixed typo
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
    await this.emptyLocationsService.findAll();
    const settings = await this.settingsRepository.find({where:{operation_type: OperationType.FLOWOPS}});
    if (settings.length === 0){
      await this.settingsRepository.save({
        id: "c96423b3-c468-48be-9062-9e3c713803ed",
        operation_type: OperationType.FLOWOPS,
        value: {
          "EMPTY_LOCATION": "ROUND_ROBIN",
        }
      })
    }
    const robots = await this.robotCountRepository.find({
      where:{operation_type: OperationType.FLOWOPS}
    });
    if (robots.length === 0){
      await this.robotCountRepository.save({id: "71043f1c-9759-497e-a35c-5a991793fd53", operation_type: OperationType.FLOWOPS, is_waiting: false, total_robots: 1, robot_in_use: 0 });
    }
    // else{
    //   await this.robotCountRepository.updateAll({ is_waiting: false, total_robots: 4, robot_in_use: 0 });
    // }
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
      await this.createBatch(batchId, inventory);
      console.log(`checking robot id to use`);
      const robotIdToUse = null;
      const [taskId,task] = await this.createTask({
        batchId,
        originLocation: inventory.id,
        sourceInventoryId: inventory.id,
        destinationStationId: targetStation.station_id,
        robotId: robotIdToUse,
        taskType: TaskType.GOODS_TO_PERSON,
        move_type: MOVE_TYPE.INVENTORY_TO_STATION,
        sequenceOrder: 1, // First (and only) task in this batch
        taskDependency: null, // May depend on previous batch
        cargos: null,
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
      await this.loggingService.log(`System marked as waiting state.`, TaskType.GOODS_TO_PERSON, taskId, null);
      await this.incrementRobotInUse();
      await this.loggingService.log(`Robot in use incremented. Current robot in use: ${await this.getRobotInUse()}`, TaskType.GOODS_TO_PERSON, taskId, null);
      await this.reserveStationAndSendTask(task, targetStation);
      await this.loggingService.log(`Station ${targetStation.station_id}: Marked as Occupied`, task.task_type, task.task_id, null);
      this.logger.log(`New Task: ${taskId}, start location: ${inventory.id} (inventory), destination location: ${targetStation.station_id} (station)`);
      await this.loggingService.log(`New Task: ${taskId}, start location: ${inventory.id} (inventory), destination location: ${targetStation.station_id} (station)`,
        task.task_type, task.task_id, null
      );
      return taskId;
    } else {
      // No station is available - create task without station and add station request for first required station only
      // this.logger.warn(`No available stations found for (inventory ${inventory.id}) - skipping task creation`);
      return null;
    }
  }

  async findOrderItemDetails(task: Task): Promise<void> {
    if (!task.orderItems){
      task.orderItems = [];
    }
    if (task.move_type === MOVE_TYPE.INVENTORY_TO_STATION ||
      task.move_type === MOVE_TYPE.STATION_TO_STATION 
    ){
      const stationId = task.end_location.location_id;
      const gtpLocations = await this.gtpLocationRepository.find({
        where: { station_id: stationId },
      });
      for (const gtpLocation of gtpLocations) {
        const orderItems = await this.orderItemRepository.find({ where: { destination_pallet_slot_id: gtpLocation.gtp_location_id, 
          status: OrderItemStatus.IN_PROGRESS 
        } });
        task.orderItems.push(...orderItems);
      }
      await this.taskRepository.save(task);
    }
    else if (task.move_type === MOVE_TYPE.STATION_TO_INVENTORY
      || task.move_type === MOVE_TYPE.INVENTORY_TO_INVENTORY || task.move_type === MOVE_TYPE.STATION_TO_EMPTY_LOCATION || task.move_type === MOVE_TYPE.WAITING_LOCATION_TO_EMPTY_LOCATION ||
      task.move_type === MOVE_TYPE.EMPTY_TO_EMPTY_LOCATION || task.move_type === MOVE_TYPE.STATION_TO_WAITING_LOCATION
    ){
      const completedTask = await this.taskRepository.findOne({ where: { task_id: task.task_id }, relations: ['orderItems'] });
      if (!completedTask) { return; }
      const batch_tasks = await this.taskRepository.find({ where: { batch_id: completedTask.batch_id }, relations: ['orderItems'] });
      if (!completedTask.orderItems){ completedTask.orderItems = []; }
      for (const task of batch_tasks) {
        if (task.task_id == completedTask.task_id){ continue; }
        if (task.orderItems && task.orderItems.length > 0){
          for (const orderItem of task.orderItems) {
            if (completedTask.orderItems.find(oi => oi.order_item_id === orderItem.order_item_id)) {
              continue;
            }
            completedTask.orderItems.push(orderItem);
          }
        }
      }
      await this.taskRepository.save(completedTask);
    }
  }

  private async createTask(taskData: {
    batchId: string;
    originLocation?: string;
    sourceInventoryId?: string;
    sourceStationId?: string;
    sourceWaitingLocationId?: string;
    sourceEmptyLocationId?: string;
    destinationStationId?: string;
    destinationInventoryId?: string;
    destinationWaitingLocationId?: string;
    destinationEmptyLocationId?: string;
    taskType: TaskType;
    robotId?: string | null;
    move_type: MOVE_TYPE;
    sequenceOrder: number;
    taskDependency?: string | null;
    cargos?: Cargo[] | null;
    orderItems?: OrderItem[] | null;
  }): Promise<[string, Task | null]> {
    // Create start location
    const startLocation = this.createLocation(
      taskData.sourceInventoryId || taskData.sourceStationId || taskData.sourceWaitingLocationId || taskData.sourceEmptyLocationId!,
      taskData.sourceInventoryId ? 'inventory' : taskData.sourceStationId ? 'station' : taskData.sourceWaitingLocationId ? 'waiting_location' : 'empty_location',
      this.getLocationAction(taskData, 'start')
    );

    // Create end location
    const endLocation = this.createLocation(
      taskData.destinationInventoryId || taskData.destinationStationId || taskData.destinationWaitingLocationId || taskData.destinationEmptyLocationId!,
      taskData.destinationInventoryId ? 'inventory' : taskData.destinationStationId ? 'station' : taskData.destinationWaitingLocationId ? 'waiting_location' : 'empty_location',
      this.getLocationAction(taskData, 'end')
    );
    console.log(`startLocation: ${JSON.stringify(startLocation)}`);
    console.log(`endLocation: ${JSON.stringify(endLocation)}`);

    if (!taskData.cargos && startLocation.location_attribute.attribute_value === 'inventory') {
      const inventory = await this.inventoryRepository.findOne({ where: { id: startLocation.location_id } });
      taskData.cargos = [
        {
          cargo_code: inventory?.barcode_number || '',
          cargo_type: "PALLET",
          cargo_dimension: {length: 1, width: 1, height: 1},
          cargo_weight: 0,
          cargo_attributes: null,
        }
      ]
    }

    const task: Task = this.taskRepository.create({
      batch_id: taskData.batchId,
      origin_location: taskData.originLocation,
      task_type: taskData.taskType,
      sequence_order: taskData.sequenceOrder,
      task_dependency: taskData.taskDependency || undefined,
      status: TaskStatus.PENDING,
      start_location: startLocation,
      end_location: endLocation,
      move_type: taskData.move_type,
      robot_id: taskData.robotId || undefined,
      cargos: taskData.cargos || [],
      orderItems: taskData.orderItems || [],
    });

    const savedTask = await this.taskRepository.save(task);
    // fill the orderItem
    if (!taskData.orderItems){
      this.logger.log(`Finding order item details for task ${task.task_id}`);
      await this.findOrderItemDetails(savedTask);
    }
    
    

    
    this.logger.log(`Created task ${savedTask.task_id}: ${taskData.taskType} - ${taskData.originLocation}`);

    await this.batchRepository.increment(
      { batch_id: taskData.batchId },
      'total_tasks',
      1
    );
    
    return [savedTask.task_id, savedTask];
  }

  private createLocation(
    locationId: string,
    locationType: 'inventory' | 'station' | 'waiting_location' | 'empty_location',
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

  private getLocationAction(taskData: any, position: 'start' | 'end'): LocationAction {
    const isInventoryToStation = taskData.sourceInventoryId && taskData.destinationStationId;
    const isInventoryToWaitLocation = taskData.sourceInventoryId && taskData.destinationWaitingLocationId;
    const isStationToStation = taskData.sourceStationId && taskData.destinationStationId;
    const isStationToInventory = taskData.sourceStationId && taskData.destinationInventoryId;
    const isStationToWaiting = taskData.sourceStationId && taskData.destinationWaitingLocationId;
    const isWaitingToStation = taskData.sourceWaitingLocationId && taskData.destinationStationId;
    const isWaitingToInventory = taskData.sourceWaitingLocationId && taskData.destinationInventoryId;
    const isToEmptyLocation = taskData.destinationEmptyLocationId;
    const isInventoryToInventory = taskData.sourceInventoryId && taskData.destinationInventoryId;
    const isEmptyToEmpty = taskData.sourceEmptyLocationId && taskData.destinationEmptyLocationId;
    const isWaitingToWaiting = taskData.sourceWaitingLocationId && taskData.destinationWaitingLocationId;

    if (isEmptyToEmpty) return position === 'start' ? LocationAction.NOP_RESUME : LocationAction.DROP;
    if (isInventoryToStation) return position === 'start' ? LocationAction.PICK : LocationAction.NOP_PAUSE;
    if (isInventoryToWaitLocation) return position === 'start' ? LocationAction.PICK : LocationAction.NOP_PAUSE;
    if (isStationToStation) return position === 'start' ? LocationAction.NOP_RESUME : LocationAction.NOP_PAUSE;
    if (isStationToWaiting) return position === 'start' ? LocationAction.NOP_RESUME : LocationAction.NOP_PAUSE;
    if (isWaitingToStation) return position === 'start' ? LocationAction.NOP_RESUME : LocationAction.NOP_PAUSE;
    if (isStationToInventory) return position === 'start' ? LocationAction.NOP_RESUME : LocationAction.DROP;
    if (isWaitingToInventory) return position === 'start' ? LocationAction.NOP_RESUME : LocationAction.DROP;
    if (isToEmptyLocation) return position === 'start' ? LocationAction.NOP_RESUME : LocationAction.DROP;
    if (isInventoryToInventory) return position === 'start' ? LocationAction.NOP_RESUME : LocationAction.DROP;
    if (isWaitingToWaiting) return position === 'start' ? LocationAction.NOP_RESUME : LocationAction.NOP_PAUSE;

    // Default fallback
    return LocationAction.NOP_PAUSE;
  }

  async generateBatchId(): Promise<string> {
    const timestamp = Date.now();
    return `B${timestamp.toString().slice(-10)}`;
  }

  async createBatch(batchId: string, inventory: Inventory | null) {
    const description = `Batch for inventory ${inventory?.id}`;

    const batch = this.batchRepository.create({
      batch_id: batchId,
      task_type: TaskType.GOODS_TO_PERSON,
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
      const warehosue_key = process.env.WMS_WAREHOUSE_AUTH_KEY || 'test';
      const wms_base_url = process.env.WMS_BASE_URL || 'http://localhost:3030/robot-job';  

      const response = await firstValueFrom(
        this.httpService.post(`${wms_base_url}/robot-job/${warehouse_name}/tasks`, requestBody, {
          headers: {
            'authorization': `${warehosue_key}`,
            'Content-Type': 'application/json'
          }
        })
      );

      await this.loggingService.log(`Task ${task.task_id} sent to WMS API layer`, task.task_type, task.task_id, null);

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
  async handleTaskCompletion(completedTask: Task, message_code: MessageCode): Promise<void> {
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
      let send_to_empty : boolean = false;
      if (message_code === MessageCode.SEND_TO_EMPTY_LOCATION){
        send_to_empty = true;
      }

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
      if (send_to_empty){inventory.is_empty = true;}
      await this.inventoryRepository.save(inventory);

      // Remove the fulfilled product requirement from database (quantity has been dropped at this station)
      const currentStationId = completedTask.end_location.location_id;
      // await this.removeProductRequirement(completedTask, completedTask.product_id, currentStationId, droppedQuantity, message_code);
      const req = await this.productRequirementRepository.findOne({
        where: {
          source_location_id: completedTask.origin_location,
          station_id: currentStationId,
      }});
      const gtpLocations = await this.gtpLocationRepository.find({
        where: { station_id: currentStationId }
      });
      if (req){
        for (const gtpLocation of gtpLocations){
          const orderItems = await this.orderItemRepository.find({where: 
            {
              source_location_id: completedTask.origin_location,
              destination_pallet_slot_id: gtpLocation.gtp_location_id,
              status: OrderItemStatus.IN_PROGRESS
            }
          });
          for (const orderItem of orderItems){
            if (orderItem){
              if (!orderItem.completedTasks){
                orderItem.completedTasks = [];
              }
              // if (!completedTask.orderItems) {completedTask.orderItems = [];}
              // completedTask.orderItems.push(orderItem);
              // await this.taskRepository.save(completedTask);
              await this.loggingService.log(`Order Item ${orderItem.order_item_id}: ${orderItem.source_location_id} (source) - ${orderItem.destination_pallet_slot_id} (destination), marked as COMPLETED`, TaskType.GOODS_TO_PERSON, completedTask.task_id, orderItem.order_batch_id);
              orderItem.status = OrderItemStatus.COMPLETED;
              orderItem.completedTasks.push(completedTask);
              await this.orderItemRepository.save(orderItem);
            }
          }
        }
        await this.productRequirementRepository.remove(req);
      }

      if (!send_to_empty) {
        const remainingRequirements = await this.getRemainingProductRequirements(
          completedTask.origin_location
        );
        if (remainingRequirements.length > 0) {
          await this.createNextStationTask(completedTask, remainingRequirements);
        } else {
          await this.createReturnToInventoryTask(completedTask);
        }
      } else {
        const orderItems = await this.orderItemRepository.find({
          where: {
            source_location_id: completedTask.origin_location,
            status: In([OrderItemStatus.ASSIGNED, OrderItemStatus.IN_PROGRESS, OrderItemStatus.PENDING])
          }
        });
        for (const orderItem of orderItems){
          const gtpLocation = await this.gtpLocationRepository.findOne({where: {gtp_location_id: orderItem.destination_pallet_slot_id}});
          await this.productRequirementRepository.delete({
            source_location_id: orderItem.source_location_id,
            station_id: gtpLocation?.station_id
          });
          await this.loggingService.log(`Order Item ${orderItem.order_item_id} at location ${orderItem.source_location_id} marked as CANCELLED due to pallet being empty`, TaskType.GOODS_TO_PERSON, completedTask.task_id, orderItem.order_batch_id);
          await this.orderItemRepository.update({order_item_id: orderItem.order_item_id}, {status: OrderItemStatus.CANCELLED});
        }

        await this.createSendToEmptyLocationTask(completedTask);
      }

      this.logger.log(`Task ${completedTask.task_id} processing completed - TRIGGERED remains as final state`);

      // Check if batch is completed (TRIGERRED tasks count as completed for batch purposes)
      await this.checkAndUpdateBatchCompletion(completedTask.batch_id);
    } catch (error) {
      this.logger.error(`Error processing next task for ${completedTask.task_id}:`, error.message);
      throw error;
    }
  }

  private async getRemainingProductRequirements(source_location_id: string): Promise<ProductRequirementEntity[]> {
    // Get all product requirements for this product
    const allRequirements = await this.productRequirementRepository.find({
      where: { source_location_id: source_location_id , isPaused: false}
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

  private async createNextStationTask(completedTask: Task, remainingRequirements: ProductRequirementEntity[]): Promise<void> {
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
        originLocation: completedTask.origin_location,
        sourceStationId: completedTask.end_location.location_id,
        destinationStationId: nextAvailableStation.station_id,
        robotId: completedTask.robot_id,
        move_type: MOVE_TYPE.STATION_TO_STATION,    
        taskType: TaskType.GOODS_TO_PERSON,
        sequenceOrder: nextSequenceOrder,
        taskDependency: completedTask.task_id,
        cargos: completedTask.cargos
      });
      if (newTask) {
        // Update station to be held by this task
        await this.stationRepository.update(
          { station_id: nextAvailableStation.station_id },
          { holded_by: newTask.task_id , status: LocationStatus.RESERVED }
        );

        await this.loggingService.log(`Station ${nextAvailableStation.station_id}: Marked as Occupied`, newTask.task_type, newTask.task_id, null);
        this.loggingService.log(`New Task: ${taskId}, start location: ${completedTask.end_location.location_id} (station), destination location: ${nextAvailableStation.station_id} (station)`, TaskType.GOODS_TO_PERSON, taskId, null);

        // Send task to WMS
        await this.sendSingleTaskToWms(newTask);
      }
    } else {
      await this.createWaitingLocationTask(completedTask, remainingRequirements, nextSequenceOrder);
    }
  }

  private async createWaitingLocationTask(
    completedTask: Task, 
    remainingRequirements: ProductRequirementEntity[], 
    sequenceOrder: number,
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
        originLocation: completedTask.origin_location,
        sourceStationId: completedTask.end_location.location_id,
        destinationWaitingLocationId: availableWaitingLocation.location_id,
        move_type: MOVE_TYPE.STATION_TO_WAITING_LOCATION,
        robotId: completedTask.robot_id,
        taskType: TaskType.GOODS_TO_PERSON,
        sequenceOrder: sequenceOrder,
        taskDependency: completedTask.task_id,
        cargos: completedTask.cargos
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

  private async createSendToEmptyLocationTask(completedTask: Task, is_from_wait: boolean = false): Promise<boolean> {
    const findEmptyLocation = await this.emptyLocationRepository.find(
      {
        where: { status: LocationStatus.AVAILABLE },
        order: {priority: 'ASC'}
      }
    )
    if (findEmptyLocation.length === 0){
      if (is_from_wait) return false;
      await this.createWaitingLocationTask(completedTask, [], completedTask.sequence_order + 1);
      return true;
    }
    for (const emptyLocation of findEmptyLocation) {
      if (await this.emptyLocationsService.reserveEmptyLocation(emptyLocation.location_id)) {
        const task_obj ={
          batchId: completedTask.batch_id,
          originLocation: completedTask.origin_location,
          destinationEmptyLocationId: emptyLocation.location_id,
          move_type: MOVE_TYPE.STATION_TO_EMPTY_LOCATION,
          taskType: TaskType.GOODS_TO_PERSON,
          sequenceOrder: completedTask.sequence_order + 1,
          taskDependency: completedTask.task_id,
          robotId: completedTask.robot_id,
          cargos: completedTask.cargos
        };
        if( is_from_wait ){
          task_obj['sourceWaitingLocationId'] = completedTask.end_location.location_id;
          task_obj['move_type'] = MOVE_TYPE.WAITING_LOCATION_TO_EMPTY_LOCATION;
        }
        else{
          task_obj['sourceStationId'] = completedTask.end_location.location_id;
          task_obj['move_type'] = MOVE_TYPE.STATION_TO_EMPTY_LOCATION;
        }
        const [emtpyTaskId, emptyTask] = await this.createTask(task_obj);
        if (emptyTask) {
          
          await this.loggingService.log(`Empty Location ${emptyLocation.location_id}: Marked as Occupied`, emptyTask.task_type, emptyTask.task_id, null);
          await this.loggingService.log(`New Task: ${emptyTask.task_id}, start location: ${completedTask.end_location.location_id} (station), destination location: ${emptyLocation.location_id} (empty location)`,
            emptyTask.task_type, emptyTask.task_id, null
          );
          const settings = await this.settingsRepository.findOne({where:{operation_type: OperationType.FLOWOPS}});
          if (settings?.value['EMPTY_LOCATION'] === 'ROUND_ROBIN'){
            const nextEmptyLocation = await this.emptyLocationRepository.findOne({where: {priority: MoreThanOrEqual((emptyLocation.priority + 1)%10!==0 ? (emptyLocation.priority + 1)%10 : 10), status: LocationStatus.OCCUPIED}, order: {priority: 'ASC'}});
            if (nextEmptyLocation) {
              nextEmptyLocation.status = LocationStatus.AVAILABLE;
              await this.emptyLocationRepository.save(nextEmptyLocation);
            }
          }
          await this.sendSingleTaskToWms(emptyTask);
          return true;
        }
      }
    }
    await this.createWaitingLocationTask(completedTask, [], completedTask.sequence_order + 1);
    return true;
  }

  private async createReturnToInventoryTask(completedTask: Task): Promise<void> {

    const originalInventoryId = completedTask.origin_location;
    const nextSequenceOrder = completedTask.sequence_order + 1;

    const reserved = await this.inventoryService.reserveInventory(originalInventoryId);
    if (!reserved) {
      this.logger.error(`Failed to reserve inventory ${originalInventoryId} for task ${completedTask.task_id}`);
      return;
    }

    // Create return task only if there's quantity to return or to complete the batch workflow
    const [returnTaskId, returnTask] = await this.createTask({
      batchId: completedTask.batch_id,
      originLocation: completedTask.origin_location,
      sourceStationId: completedTask.end_location.location_id,
      destinationInventoryId: originalInventoryId,
      move_type: MOVE_TYPE.STATION_TO_INVENTORY,
      taskType: TaskType.GOODS_TO_PERSON, // Always GOODS_TO_PERSON as you specified
      sequenceOrder: nextSequenceOrder,
      taskDependency: completedTask.task_id,
      robotId: completedTask.robot_id,
      cargos: completedTask.cargos
    });
    if (returnTask) {
      await this.loggingService.log(`New Task: ${returnTaskId}, start location: ${completedTask.end_location.location_id} (station), destination location: ${originalInventoryId} (inventory)`,
        returnTask.task_type, returnTask.task_id, null
      );
      await this.sendSingleTaskToWms(returnTask);
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
  @Cron('*/5 * * * * *')
  async orchestratorCronJob() {
    await this.baseOpsService.baseOpsOrchestrator();
    await this.triggerOrchestrator();
  }

  public async writeInDatabase(){
    const assignedItems = await this.getAndUpdateAssignedItems(); // get order items that are in assigned state.
        
    if (assignedItems.length === 0) {
      return { message: 'No assigned order items found' };
    }
    // await this.calculateProductRequirements(assignedItems);
    return { message: 'Assigned order items processed successfully'};
  }

  public async triggerOrderService(order_id: string, sourceLocation: string, gtpLocationId:string){
    const assignedOrderItem = await this.orderItemRepository.findOne({
      where:{
        order_item_id: Number(order_id),
        status: OrderItemStatus.ASSIGNED,
      }});
    if (!assignedOrderItem) {
      console.log(`No assigned order items found for order ${order_id}`);
      return { message: 'No assigned order items found' };
    }
    console.log(`Assigned order items for order ${order_id}: ${JSON.stringify(assignedOrderItem)}`);
    // for (const orderItem of assignedOrderItem ? [assignedOrderItem] : []) {
    //   orderItem.status = OrderItemStatus.IN_PROGRESS;
    //   await this.orderItemRepository.save(orderItem);
    // }
    assignedOrderItem.status = OrderItemStatus.IN_PROGRESS;
    await this.orderItemRepository.save(assignedOrderItem);
    const existingOrderItems = await this.orderItemRepository.find({
      where: {
        source_location_id: assignedOrderItem.source_location_id,
        destination_pallet_slot_id: assignedOrderItem.destination_pallet_slot_id,
        status: OrderItemStatus.ASSIGNED,
        merged_order_item_id: assignedOrderItem.merged_order_item_id === null ? assignedOrderItem.order_item_id : assignedOrderItem.merged_order_item_id,
      }
    });
    for (const existingOrderItem of existingOrderItems) {
      existingOrderItem.status = OrderItemStatus.IN_PROGRESS;
      this.loggingService.log(`Orders started for OrderID: ${existingOrderItem.order_item_id}, source location ${existingOrderItem.source_location_id}, GTP location ${existingOrderItem.destination_pallet_slot_id}`, TaskType.GOODS_TO_PERSON, null, existingOrderItem.order_batch_id);
      await this.orderItemRepository.save(existingOrderItem);
    }
    const gtpLocation = await this.gtpLocationRepository.findOne({
      where: { gtp_location_id: gtpLocationId }
    });
    if (!await this.productRequirementRepository.findOne({
      where: {
        source_location_id: sourceLocation,
        station_id: gtpLocation?.station_id || '',
      }})){
        await this.productRequirementRepository.save({
          source_location_id: sourceLocation,
          station_id: gtpLocation?.station_id || '',
        });
      }
    console.log(`Order ${order_id} started successfully`);
    return { message: 'Order started successfully' };
  }
  async checkForErrorTasks(){
    const errorTasks = await this.taskRepository.find({
      where: { status: TaskStatus.CANCELLED,
        updated_at: Between(new Date(Date.now() - 5 * 60 * 1000), new Date(Date.now() - 1 * 60 * 1000)),
        task_type: TaskType.GOODS_TO_PERSON
      },
    });
    
    if (errorTasks.length === 0){ return ; }
    for (const task of errorTasks){
      const nextSequenceTask = await this.taskRepository.findOne({
        where: { task_dependency: task.task_id }
      });
      if (nextSequenceTask){
        console.log(`deleting ${task.task_id} error logs`);
        await this.loggingService.deleteErrorLogsForTask(task.task_id);
        continue;
      }
      await this.loggingService.createErrorLog(`Task ${task.task_id} is in CANCELLED state for more than 1 minute`, task.task_type, task.task_id, null, true);
    }
  }

  private async handleTriggerStations(){
    const now = new Date();
    const twoMinutesAgo = new Date(now.getTime() - 2 * 60 * 1000);
    const oneMinuteAgo = new Date(now.getTime() - 1 * 60 * 1000);
    const triggeredTasks = await this.taskRepository.find({
      where: {
        status: TaskStatus.TRIGERRED,
        triggered: Between(twoMinutesAgo, oneMinuteAgo),
      }
    });
    for (const triggeredTask of triggeredTasks){
      const existingNextTask = await this.taskRepository.findOne({
        where: { 
          task_dependency: triggeredTask.task_id,
          batch_id: triggeredTask.batch_id
        }
      });
      if (existingNextTask) {continue;}
      const remainingRequirements = await this.getRemainingProductRequirements(
        triggeredTask.origin_location
      );
      const currentStationId = triggeredTask.end_location.location_id;
      const isCurrentStationInReequirements = remainingRequirements.some(req => req.station_id === currentStationId);
      if (isCurrentStationInReequirements){
        // If the current station still has requirements, skip processing
        continue;
      }
      if (remainingRequirements.length > 0) {
        await this.createNextStationTask(triggeredTask, remainingRequirements);
      } else {
        await this.createReturnToInventoryTask(triggeredTask);
      }
    }
    
  }
  
  public async triggerOrchestrator() {
      if (this.orchestratorWorking) {
        this.logger.warn('Orchestrator is already running - skipping manual trigger');
        return {"message": "Service is already running, Try again in few seconds."};
      }
      try{
        console.log('--------------------running gtp --------------------------')
        this.orchestratorWorking  = true;

        // add a function that sends a task again
        await this.resendPendingTasks();

        // check for error tasks cases
        await this.checkForErrorTasks();

        await this.handleTriggerStations();

        // check if a there is lp plate waiting for a pick location

        const stations = await this.stationRepository.find();
        for (const station of stations) {
          if (station.status === LocationStatus.AVAILABLE){
            await this.handleStationToWaitCancel(station.station_id);
          }
        }

        await this.handleStationToWaitToEmptyCancel();

        const cancelledStationIds = await this.stationService.getCancelledStations(); // get all the cancelled stations.

        // create tasks from all the cancelled stations to their respective inventories
        for (const stationId of cancelledStationIds) {
          await this.stationService.removeProductRequirment(stationId);
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
              if (firstTask && lastTask && inventory && inventory.status === LocationStatus.AVAILABLE) {
                const reserved = await this.inventoryService.reserveInventory(inventory.id);
                if (!reserved) {
                  this.logger.warn(`Inventory ${inventory.id} couldn't be reserved.`);
                  continue;
                }
                const [newTaskID, newTask] = await this.createTask({
                  batchId: lastTask.batch_id,
                  originLocation: lastTask.origin_location,
                  sourceStationId: station.station_id,
                  destinationInventoryId: firstTask.start_location.location_id,
                  taskType: TaskType.GOODS_TO_PERSON,
                  move_type: MOVE_TYPE.STATION_TO_INVENTORY,
                  sequenceOrder: lastTask.sequence_order + 1,
                  taskDependency: lastTask.task_id,
                  robotId: lastTask.robot_id,
                  cargos: lastTask.cargos
                });
                if (!newTask){console.error(`New task ${newTaskID} not found after creation`); break;}
                await this.sendSingleTaskToWms(newTask);
                this.loggingService.log(`New Task: ${newTaskID} created for cancelled station ${stationId} - returning to inventory`,
                  newTask.task_type,
                  newTask.task_id,
                  null
                );
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

  async resendPendingTasks() {
    try {
      const twoMinutesAgo = new Date(Date.now() - 1 * 60 * 1000);
      const pendingTasks = await this.taskRepository.find({
        where: { 
          status: TaskStatus.PENDING,
          created_at: LessThan(twoMinutesAgo),
          task_type: Not(TaskType.BASEOPS),
        },
        order: { created_at: 'ASC' } // FIFO order
      });
      if (pendingTasks.length === 0) {return;}
      for (const task of pendingTasks) {
        this.sendSingleTaskToWms(task);
        await this.loggingService.log(`Task ${task.task_id}: Resent to WMS`, task.task_type,task.task_id,null);
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
      order: { source_location_id: 'ASC', station_id: 'ASC' }
    });
  }

  // Get product requirements by station ID  
  public async getProductRequirementsByStationId(stationId: string) {
    return await this.productRequirementRepository.find({
      where: { station_id: stationId },
      order: { source_location_id: 'ASC' }
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
        completedTask.origin_location
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

      // Create task from waiting location to station
      const [taskId,newTask] = await this.createTask({
        batchId: completedTask.batch_id,
        originLocation: completedTask.origin_location,
        sourceWaitingLocationId: completedTask.end_location.location_id,
        destinationStationId: availableStation.station_id,
        move_type: MOVE_TYPE.WAITING_LOCATION_TO_STATION, 
        taskType: TaskType.GOODS_TO_PERSON,
        sequenceOrder: nextSequenceOrder,
        taskDependency: completedTask.task_id,
        robotId: completedTask.robot_id,
        cargos: completedTask.cargos
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

  async handleStationToWaitToEmptyCancel(){
    const stationToWaitTasks = await this.taskRepository.find({
      where: { status: In([TaskStatus.PROCESSING]), move_type: MOVE_TYPE.STATION_TO_WAITING_LOCATION }
    });
    for (const task of stationToWaitTasks) {
      const inventoryId = task.origin_location;
      const inventory = await this.inventoryRepository.findOne({where: { id: inventoryId }});
      if (!inventory?.is_empty){continue;}
      const emptyLocations = await this.emptyLocationRepository.find({where: { status: LocationStatus.AVAILABLE }});
      if (emptyLocations.length === 0){return;}
      for (const emptyLocation of emptyLocations) {
        try{
          const response = await this.emptyLocationsService.reserveEmptyLocation(emptyLocation.location_id);
          if (!response) {continue;}
          console.log(`cancel at release station to wait location.`)
          try{
            await this.CancelTask(task);
          }
          catch(error){
            this.logger.error(`Error cancelling task ${task.task_id} before creating new task to waiting location ${emptyLocation.location_id}: ${error.message}`);
            await this.emptyLocationRepository.update(emptyLocation.location_id, { status: LocationStatus.AVAILABLE });
            continue;
          }
          const [task_id, newTask] = await this.createTask({
            batchId: task.batch_id,
            originLocation: task.origin_location,
            sourceEmptyLocationId: emptyLocation.location_id,
            destinationEmptyLocationId: emptyLocation.location_id,
            taskType: TaskType.GOODS_TO_PERSON,
            move_type: MOVE_TYPE.EMPTY_TO_EMPTY_LOCATION,
            sequenceOrder: task.sequence_order+1,
            taskDependency: task.task_id,
            robotId: task.robot_id,
            cargos: task.cargos
          });
          if (newTask){
            await this.waitingLocationRepository.update({ location_id: task.end_location.location_id }, { status: LocationStatus.AVAILABLE, holded_by: null });
            await this.taskRepository.update({ task_id: task.task_id }, { status: TaskStatus.CANCELLED });
            await this.loggingService.log(`Cancel Task: ${task.task_id} and create new Task: ${task_id}, start location: ${task.end_location.location_id} (waiting location), destination location: ${emptyLocation.location_id} (empty location)`, TaskType.GOODS_TO_PERSON,task_id,null);
            await this.loggingService.log(`Empty Location ${emptyLocation.location_id}: Marked as Occupied`, TaskType.GOODS_TO_PERSON,task_id,null);
            const settings = await this.settingsRepository.findOne({where:{operation_type: OperationType.FLOWOPS}});
            if (settings?.value['EMPTY_LOCATION'] === 'ROUND_ROBIN'){
              const nextEmptyLocation = await this.emptyLocationRepository.findOne({where: {priority: MoreThanOrEqual((emptyLocation.priority + 1)%10!==0 ? (emptyLocation.priority + 1)%10 : 10), status: LocationStatus.OCCUPIED}, order: {priority: 'ASC'}});
              if (nextEmptyLocation) {
                nextEmptyLocation.status = LocationStatus.AVAILABLE;
                await this.emptyLocationRepository.save(nextEmptyLocation);
              }
            }
            await this.sendSingleTaskToWms(newTask);
            break;
          }
        }
        catch{
          await this.emptyLocationRepository.update({ location_id: emptyLocation.location_id }, { status: LocationStatus.AVAILABLE });
          continue;
        }
      }
    }
  }

  async handleStationToWaitCancel(stationId:string){
    const prdReqForStation = await this.getProductRequirementsByStationId(stationId);
    if (prdReqForStation.length > 0){
      const reservationStatus = await this.stationService.reserveStation(stationId);
      if (!reservationStatus) return;
    }
    for (const requirement of prdReqForStation) {
      const origin_location = requirement.source_location_id;
      const carrying_task = await this.taskRepository.findOne({
        where: { origin_location: origin_location, status: In([TaskStatus.PROCESSING]), move_type: In([MOVE_TYPE.STATION_TO_WAITING_LOCATION, MOVE_TYPE.INVENTORY_TO_WAITING_LOCATION, MOVE_TYPE.WAITING_TO_WAITING_LOCATION]) }
      });
      try{
        if (carrying_task && carrying_task.robot_id) {
          const firstTask = await this.taskRepository.findOne({where: { batch_id: carrying_task.batch_id, sequence_order: 1 }});
          const inventoryId = firstTask?.start_location?.location_id;
          const inventory = await this.inventoryRepository.findOne({where: { id: inventoryId }});
          if (!inventory){continue;}
          console.log(`cancel at release station.`)
          // reserve the current station
          await this.CancelTask(carrying_task);
          // await this.taskRepository.update({ task_id: carrying_task.task_id }, { status: TaskStatus.CANCELLED });
          await this.waitingLocationRepository.update({ location_id: carrying_task.end_location.location_id }, { status: LocationStatus.AVAILABLE, holded_by: null });
          const [task_id, task] = await this.createTask({
            batchId: carrying_task.batch_id,
            originLocation: carrying_task.origin_location,
            sourceStationId: stationId,
            destinationStationId: stationId,
            taskType: TaskType.GOODS_TO_PERSON,
            robotId: carrying_task.robot_id,
            move_type: MOVE_TYPE.STATION_TO_STATION,
            sequenceOrder: carrying_task.sequence_order+1,
            taskDependency: carrying_task.task_id,
            cargos: carrying_task.cargos
          });
          if (task && task_id){
            await this.waitingLocationRepository.update({ location_id: carrying_task.end_location.location_id }, { status: LocationStatus.AVAILABLE, holded_by: null });
            await this.taskRepository.update({ task_id: carrying_task.task_id }, { status: TaskStatus.CANCELLED });
            await this.loggingService.log(`Cancel Task: ${carrying_task.task_id} and create new Task: ${task_id}, start location: ${carrying_task.end_location.location_id} (inventory), destination location: ${stationId} (station)`, TaskType.GOODS_TO_PERSON,task_id,null);
            await this.loggingService.log(`Station ${stationId}: Marked as Occupied`, TaskType.GOODS_TO_PERSON,task_id,null);
            await this.loggingService.log(`Reroute Task: ${carrying_task.task_id}, Initial destination: ${carrying_task.end_location.location_id}, New Destination: ${stationId}, new requirement found at destination`, TaskType.GOODS_TO_PERSON,task_id,null);
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
    await this.loggingService.log('Pausing all product requirements - new tasks will not be created', TaskType.GOODS_TO_PERSON, null, null);
    const result = await this.productRequirementRepository
      .createQueryBuilder()
      .update()
      .set({ isPaused: true })
      .execute();
    return result;
  }

  async cancelAllProductRequirements(){
    await this.loggingService.log('Cancelling all product requirements - all tasks will be cancelled', TaskType.GOODS_TO_PERSON, null, null);
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
    await this.loggingService.log('Resuming all product requirements - new tasks can be created', TaskType.GOODS_TO_PERSON, null, null);
    const result = await this.productRequirementRepository
      .createQueryBuilder()
      .update()
      .set({ isPaused: false })
      .execute();
    return result;
  }

  async getPredictedRobots(){
    // return {
    //   "predicted": 1
    // }
    const orderItems = await this.orderItemRepository.find({
      where: { status: In([OrderItemStatus.PENDING, OrderItemStatus.ASSIGNED, OrderItemStatus.IN_PROGRESS]) },
    });
    const uniqueProducts = new Set(orderItems.map(item => item.source_location_id)); // unique product IDS
    const setOfUniqueGTP = new Set(orderItems.map(item => item.destination_pallet_slot_id));
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
  async getTasksByRobotId(robotId: string){
    return await this.taskRepository.find({
      where: { robot_id: robotId },
      order: { created_at: 'ASC' },
      select: ['start_location','end_location','batch_id','inqueue', 'processing','triggered','completed','created_at']
    });
  }

  async getRobotReport(startDate: Date | undefined, endDate: Date | undefined, module: "FlowOps" | "BaseOps") {
    console.log(`Generating robot report from ${startDate} to ${endDate} for module ${module}`);
    const whereCondition: any = {
      task_type: module === "FlowOps" ? TaskType.GOODS_TO_PERSON : TaskType.BASEOPS
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
    console.log(whereCondition);
    const allTasks = await this.taskRepository.find({
      where: whereCondition,
    });

    const allRobots = await this.robotRepository.find();
    // keep a set of all the robot IDs used in allTasks
    const robotIds = new Set<string>();
    allRobots.forEach(robot => {
      if (robot.robot_id) {
        robotIds.add(robot.robot_id);
      }
    });
    const allRobotIds = Array.from(robotIds);
    const res = {};
    for (const robotId of allRobotIds){
      const repoRobot = await this.robotRepository.findOne({where: { robot_id: robotId }});
      if (!repoRobot) continue;
      const filteredTasks = allTasks.filter(task => task.robot_id === robotId);
      // if (filteredTasks.length == 0) continue;
      if (!res[robotId]) {
        res[robotId] = {
          totalTasks: filteredTasks.length,
          travel_time: [],
          wait_time: [],
          unloading_time: {},
          completedTasks: 0,
          canceledTasks: 0,
          move_types: {
            [MOVE_TYPE.INVENTORY_TO_STATION]: {'total_tasks': 0, 'picking_times': [], 'travel_times': []},
            [MOVE_TYPE.STATION_TO_STATION]: {'total_tasks': 0, 'picking_times': [], 'travel_times': []},
            [MOVE_TYPE.STATION_TO_INVENTORY]: {'total_tasks': 0, 'travel_times': []},
            [MOVE_TYPE.STATION_TO_WAITING_LOCATION]: {'total_tasks': 0, 'travel_times': [] },
            [MOVE_TYPE.WAITING_LOCATION_TO_STATION]: {'total_tasks': 0, 'travel_times': [] },
            [MOVE_TYPE.WAITING_LOCATION_TO_EMPTY_LOCATION]: {'total_tasks': 0, 'travel_times': [] },
          }
        };
      }
      // get travel_time
      for (const task of filteredTasks){
        if (task.processing && task.completed){
          const travelTime = Math.floor((Number(task.completed) - Number(task.processing)) / 1000);
          res[robotId].travel_time.push(travelTime);
        }

        if (task.end_location.location_attribute?.attribute_value === 'station' && task.completed && task.triggered){
          const unloadingTime = Math.floor((Number(task.triggered) - Number(task.completed)) / 1000);
          // res[robotId].unloading_time.push(unloadingTime);
          if (task.end_location.location_id in res[robotId].unloading_time){
            res[robotId].unloading_time[task.end_location.location_id].push(unloadingTime);
          } else {
            res[robotId].unloading_time[task.end_location.location_id] = [unloadingTime];
          }
        }

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
        if (task.status === TaskStatus.COMPLETED || task.status===TaskStatus.TRIGERRED){
          res[robotId].completedTasks += 1;
        }
        if (task.status === TaskStatus.CANCELLED){
          res[robotId].canceledTasks += 1;
        }
        if (task.move_type in res[robotId].move_types){
          res[robotId].move_types[task.move_type].total_tasks += 1;
          if (task.move_type === MOVE_TYPE.INVENTORY_TO_STATION || task.move_type === MOVE_TYPE.STATION_TO_STATION){
            if (task.completed && task.triggered){
              const pickingTime = Math.floor((Number(task.triggered) - Number(task.completed)) / 1000);
              res[robotId].move_types[task.move_type].picking_times.push(pickingTime);
            }
          }
          if (task.processing && task.completed){
            const travelTime = Math.floor((Number(task.completed) - Number(task.processing)) / 1000);
            res[robotId].move_types[task.move_type].travel_times.push(travelTime);
          }
        }
      }
      if (!repoRobot.logs) continue;
      const requiredLogs = repoRobot.logs.filter(log => {
        const logDate = new Date(log.timestamp);
        if (startDate && endDate) {
          return logDate >= startDate && logDate <= endDate;
        }
        else if (startDate){
          return logDate >= startDate;
        }
        else if (endDate){
          return logDate <= endDate;
        }
        return true;
      });
      res[robotId].maintenance_time = 0;
      res[robotId].charging_time = 0;
      res[robotId].online_time = 0;
      res[robotId].error_time = 0;
      res[robotId].inUse_time = 0;
      if (requiredLogs.length === 0){
        // find the log just before the start date
        if (startDate){
          const previousLog = repoRobot.logs
            .filter(log => new Date(log.timestamp) < startDate)
            .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];
          if (previousLog){
            const timeDiff = (Date.now() - startDate.getTime()) / 1000;
            if (previousLog.new_status === RobotStatus.INUSE) {
              res[robotId].inUse_time += timeDiff;
            }
            else if (previousLog.new_status === RobotStatus.CHARGING) {
              res[robotId].charging_time += timeDiff;
            }
            else if (previousLog.new_status === RobotStatus.MAINTENANCE) {
              res[robotId].maintenance_time += timeDiff;
            }
            else if (previousLog.new_status === RobotStatus.ONLINE) {
              res[robotId].online_time += timeDiff;
            }
            else if (previousLog.new_status === RobotStatus.ERROR) {
              res[robotId].error_time += timeDiff;
            }
          }
        }
        continue;
      }
      requiredLogs.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      let previousTime = 0;
      const firstLogIndex = repoRobot.logs.findIndex(log => log.timestamp === requiredLogs[0].timestamp);
      if (firstLogIndex > 0) {
        previousTime = startDate ? startDate.getTime() : new Date(repoRobot.logs[firstLogIndex - 1].timestamp).getTime();
      } else {
        previousTime = new Date(requiredLogs[0].timestamp).getTime();
      }
      console.log(`Robot ${robotId} - First log time: ${new Date(requiredLogs[0].timestamp)} Previous log time: ${new Date(previousTime)}`);
      // Handle the time before the first required log
      if (requiredLogs[0].previous_status === RobotStatus.INUSE) {
        res[robotId].inUse_time += (new Date(requiredLogs[0].timestamp).getTime() - previousTime) / 1000;
      }
      else if (requiredLogs[0].previous_status === RobotStatus.CHARGING) {
        res[robotId].charging_time += (new Date(requiredLogs[0].timestamp).getTime() - previousTime) / 1000;
      }
      else if (requiredLogs[0].previous_status === RobotStatus.MAINTENANCE) {
        res[robotId].maintenance_time += (new Date(requiredLogs[0].timestamp).getTime() - previousTime) / 1000;
      }
      else if (requiredLogs[0].previous_status === RobotStatus.ONLINE) {
        res[robotId].online_time += (new Date(requiredLogs[0].timestamp).getTime() - previousTime) / 1000;
      }
      else if (requiredLogs[0].previous_status === RobotStatus.ERROR) {
        res[robotId].error_time += (new Date(requiredLogs[0].timestamp).getTime() - previousTime) / 1000;
      }
      // iterate through the logs and calculate the time spent in each status
      let currentStatus: RobotStatus = requiredLogs[0].new_status;
      let currentTime = new Date(requiredLogs[0].timestamp).getTime();
      for (let i = 1; i < requiredLogs.length; i++) {
        const log = requiredLogs[i];
        if (currentStatus === RobotStatus.INUSE) {
          res[robotId].inUse_time += (new Date(log.timestamp).getTime() - currentTime) / 1000;
        }
        else if (currentStatus === RobotStatus.CHARGING) {
          res[robotId].charging_time += (new Date(log.timestamp).getTime() - currentTime) / 1000;
        }
        else if (currentStatus === RobotStatus.MAINTENANCE) {
          res[robotId].maintenance_time += (new Date(log.timestamp).getTime() - currentTime) / 1000;
        }
        else if (currentStatus === RobotStatus.ONLINE) {
          res[robotId].online_time += (new Date(log.timestamp).getTime() - currentTime) / 1000;
        }
        else if (currentStatus === RobotStatus.ERROR) {
          res[robotId].error_time += (new Date(log.timestamp).getTime() - currentTime) / 1000;
        }
        currentStatus = log.new_status;
        currentTime = new Date(log.timestamp).getTime();
      }
      // last log, calculate time till now
      if (currentStatus === RobotStatus.INUSE) {
        res[robotId].inUse_time += (Date.now() - currentTime) / 1000;
      }
      else if (currentStatus === RobotStatus.CHARGING) {
        res[robotId].charging_time += (Date.now() - currentTime) / 1000;
      }
      else if (currentStatus === RobotStatus.MAINTENANCE) {
        res[robotId].maintenance_time += (Date.now() - currentTime) / 1000;
      }
      else if (currentStatus === RobotStatus.ONLINE) {
        res[robotId].online_time += (Date.now() - currentTime) / 1000;
      }
      else if (currentStatus === RobotStatus.ERROR) {
        res[robotId].error_time += (Date.now() - currentTime) / 1000;
      }
    }
    return res;

  }

  async getMovementReport(startDate: Date | undefined, endDate: Date | undefined, module: "FlowOps" | "BaseOps") {
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
    const res: Record<string, number[]> = module === "FlowOps" ? {
      "InventoryToStation": [],
      "InventoryToWaitingLocation": [],
      "StationToWaitingLocation": [],
      "WaitingLocationToStation": [],
      "StationToStation": [],
      "StationToInventory": [],
      "WaitingLocationToInventory": [],
      "StationToEmpty": [],
      "EmptyToEmptyLocation": []
    }: module === "BaseOps" ? {
      "ZoneToZone": [],
    }:{};

    if(module === "FlowOps"){
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
      }else if (task.move_type === MOVE_TYPE.STATION_TO_EMPTY_LOCATION){
        if (task.processing && task.completed) {
          const travelTime = Math.floor((Number(task.completed) - Number(task.processing)) / 1000);
          res.StationToEmpty.push(travelTime);
        }
      }
      else if (task.move_type === MOVE_TYPE.EMPTY_TO_EMPTY_LOCATION){
        if (task.processing && task.completed) {
          const travelTime = Math.floor((Number(task.completed) - Number(task.processing)) / 1000);
          res.EmptyToEmptyLocation.push(travelTime);
        }
      }
    }
  }  else if (module === "BaseOps"){
    for (const task of allTasks){
      if (task.task_type === TaskType.BASEOPS){
        if (task.processing && task.completed) {
          const travelTime = Math.floor((Number(task.completed) - Number(task.processing)) / 1000);
          res.ZoneToZone.push(travelTime);
        }
      }
    } 
  }
    return res;
  }

  async getTasksByStatus(statusList: string[], start_time: Date | undefined, end_time: Date | undefined, module: "FlowOps" | "BaseOps") {
    const whereCondition: any = {
      task_type: module === "FlowOps" ? TaskType.GOODS_TO_PERSON : TaskType.BASEOPS
    };

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
        order: { created_at: 'DESC', updated_at: 'DESC' },
        relations: ['batch', 'orderItems'],
      }));
    }
    if (statusList.includes('pending')) {
      TaskItems.push(...await this.taskRepository.find({
        where: { ...whereCondition, status: TaskStatus.PENDING },
        order: { created_at: 'DESC', updated_at: 'DESC' },
        relations: ['batch', 'orderItems']
      }));
    }
    if (statusList.includes('processing')) {
      TaskItems.push(...await this.taskRepository.find({
        where: { ...whereCondition, status: TaskStatus.PROCESSING },
        order: { created_at: 'DESC', updated_at: 'DESC' },
        relations: ['batch', 'orderItems']
      }));
    }
    if (statusList.includes('completed')) {
      TaskItems.push(...await this.taskRepository.find({
        where: { ...whereCondition, status: In([TaskStatus.COMPLETED, TaskStatus.TRIGERRED]) },
        order: { created_at: 'DESC', updated_at: 'DESC' },
        relations: ['batch', 'orderItems']
      }));
    }
    if (statusList.includes('cancelled')) {
      TaskItems.push(...await this.taskRepository.find({
        where: { ...whereCondition, status: TaskStatus.CANCELLED },
        order: { created_at: 'DESC', updated_at: 'DESC' },
        relations: ['batch', 'orderItems']
      }));
    }
    console.log(`first task: ${JSON.stringify(TaskItems[0])}`);
    for (const task of TaskItems) {
      const taskDetails: TaskDetails = {
        task_id: task.task_id,
        display_task_id: task.display_task_id,
        batch_id: task.batch_id,
        fms_batch_id: task.fms_batch_id,
        origin_location: task.origin_location,
        move_type: task.move_type,
        status: task.status,
        robot_id: task.robot_id,
        start_location_id: task.start_location.location_id,
        end_location_id: task.end_location.location_id,
        created_at: task.created_at,
        updated_at: task.updated_at,
        pallet_id: task.cargos ? task.cargos[0].cargo_code : '',
        priority: task.priority || 3,
        batch_priority: task.batch.priority || 3,
        orderItems: task.orderItems || [],
        sequence_order: task.sequence_order,
        inqueue: task.inqueue,
        processing: task.processing,
        completed: task.completed,
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
    endDate?: Date,
    module?: "FlowOps" | "BaseOps"
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
      else if (sourceType === 'empty_location'){
        source_location = await this.emptyLocationRepository.findOne({
          where: { location_id: loc },
        });
      }

      const whereCondition: any = {
        status: In([TaskStatus.COMPLETED, TaskStatus.TRIGERRED]),
        task_type: module === "FlowOps" ? TaskType.GOODS_TO_PERSON : TaskType.BASEOPS
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
      // whereCondition.status = TaskStatus.COMPLETED;
      const allTasks = await this.taskRepository.find({
        where: whereCondition,
      });
      console.log(`start time: ${startDate}, end time: ${endDate}`);
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

  async updateTotalRobots(totalRobots: number, module: "FlowOps" | "BaseOps") {
    const result = await this.robotCountRepository
      .createQueryBuilder()
      .select('COUNT(*)', 'count')
      .where({ operation_type: module === "FlowOps" ? OperationType.FLOWOPS : OperationType.BASEOPS })
      .getRawOne();

    if (result.count === 0) {
      await this.robotCountRepository.save({
        id: crypto.randomUUID(),
        is_waiting: false,
        operation_type: module === "FlowOps" ? OperationType.FLOWOPS : OperationType.BASEOPS,
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
    const robotRecord = (await this.robotCountRepository.find({where: {operation_type: module === "FlowOps" ? OperationType.FLOWOPS : OperationType.BASEOPS}}))[0];

    await this.robotCountRepository.update({ id: robotRecord.id, operation_type: module === "FlowOps" ? OperationType.FLOWOPS : OperationType.BASEOPS }, { total_robots: totalRobots });
  }

  async getTotalRobots(module: "FlowOps" | "BaseOps") {
    const result = await this.robotCountRepository.find({where: {operation_type: module === "FlowOps" ? OperationType.FLOWOPS : OperationType.BASEOPS}});
    if (result.length === 0) {
      return 0;
    }
    return result[0].total_robots;
  }

  async getRobotStatus(robotId: string, task_type: TaskType) {
    const task = await this.taskRepository.findOne({
      where: { robot_id: robotId, task_type: task_type },
      order: { updated_at: 'DESC' },
    });

    if (!task) {
      return {
        "success": false,
        "message": `No tasks found for robot with ID ${robotId}`,
        "data": { }
      }
    }

    const status = task.status.toUpperCase()
    const attributeValue = task.end_location.location_attribute.attribute_value

    let currentTask: Task | null = null;
    if ((status === TaskStatus.COMPLETED) && attributeValue === "inventory") {
      // Don't show task
    }
    // Exclusion Rule 2: Status is PENDING, ASSIGNED, or TRIGGERED
    else if (status === TaskStatus.PENDING || status === TaskStatus.ASSIGNED || status === TaskStatus.TRIGERRED) {
      // Don't show task
    }
    else {
      currentTask = task;
    }

    let inventory_info: Inventory | null = null;
    if (currentTask) {
      const inventory = await this.inventoryRepository.findOne({
        where: { id: currentTask.origin_location }
      });
      if (inventory) { inventory_info = inventory;}
    }
    let station_info: Station | WaitingLocation | EmptyLocation | null = null;
    let station_id : string | null = null;
    let isStation = false;
    if (currentTask && currentTask.end_location.location_attribute.attribute_value === 'station') {
      const station = await this.stationRepository.findOne({
        where: { station_id: currentTask.end_location.location_id }
      });
      if (station) { station_info = station;
        station_id = station.station_id;
        isStation = true;
      }
    }
    if (currentTask && currentTask.end_location.location_attribute.attribute_value === 'waiting_location') {
      const waiting_location = await this.waitingLocationRepository.findOne({
        where: { location_id: currentTask.end_location.location_id }
      });
      if (waiting_location) { station_info = waiting_location;
        station_id = waiting_location.location_id;
      }
    }
    if (currentTask && currentTask.end_location.location_attribute.attribute_value === 'empty_location') {
      const empty_location = await this.emptyLocationRepository.findOne({
        where: { location_id: currentTask.end_location.location_id }
      });
      if (empty_location) { station_info = empty_location;
        station_id = empty_location.location_id;
      }
    }

    let gtp_location_mapping : any[] = [];
    let destination_order_items: any[] = [];
    let gtpLocations: GtpLocation[] = [];
    if (isStation && station_id){
      gtpLocations = await this.gtpLocationRepository.find({ where: { station_id: station_id } });
    }
    const orderItems = await this.orderItemRepository.find({
      where: { source_location_id: currentTask ? currentTask.origin_location : '' ,
        status: OrderItemStatus.IN_PROGRESS,
        destination_pallet_slot_id: In(gtpLocations.map(loc => loc.gtp_location_id))
      }
    })
    for (const item of orderItems){
      gtp_location_mapping.push({
        "order_item_id": item.order_item_id,
        "gtp_location_id": item.destination_pallet_slot_id,
        "station_id": station_id
      });
      if (isStation){
          destination_order_items.push({
          "order_item_id": item.order_item_id,
          "order_batch_id": item.order_batch_id,
          "destination_pallet_slot_id": item.destination_pallet_slot_id,
          "status": item.status,
        });
      }
      
    }

    return {
      "success": true,
      "message": "Robot status retrieved successfully",
      "data": {
        "current_task": currentTask,
        "inventory": inventory_info,
        "station_info": station_info,
        "gtp_location_mappings": gtp_location_mapping,
        "destination_order_items": destination_order_items,
      }
    }
  }

  async handleErroneousTask(taskID: string){
    const task = await this.taskRepository.findOne({where: {task_id: taskID}});
    if (!task){ throw new NotFoundException(`Task with ID ${taskID} not found`); }
    if (task.status !== TaskStatus.CANCELLED) { throw new BadRequestException(`Task with ID ${taskID} is not in CANCELLED status`); }
    if (task.move_type === MOVE_TYPE.INVENTORY_TO_STATION || task.move_type === MOVE_TYPE.WAITING_LOCATION_TO_STATION || task.move_type === MOVE_TYPE.STATION_TO_STATION){
      const destinationLocation = task.end_location.location_id;
      if (task.start_location.location_id != task.end_location.location_id && !await this.stationService.reserveStation(destinationLocation)){
        throw new BadRequestException(`Destination location for this task is not available right now.`);
      }
      const task_obj = {
        batchId: task.batch_id,
        originLocation: task.origin_location,
        destinationStationId: destinationLocation,
        taskType: TaskType.GOODS_TO_PERSON,
        move_type: MOVE_TYPE.STATION_TO_STATION,
        sequenceOrder: task.sequence_order+1,
        taskDependency: task.task_id,
        robotId: task.robot_id,
        cargos: task.cargos,
      };
      let sourceLocationId : string | null = null;
      if (task.processing) {
        sourceLocationId = task.end_location.location_id;
        task_obj['sourceStationId'] = task.end_location.location_id;
        task_obj['move_type'] = MOVE_TYPE.STATION_TO_STATION;
      }
      if  (!sourceLocationId){
        if (task.move_type === MOVE_TYPE.INVENTORY_TO_STATION){
          task_obj['sourceInventoryId'] = task.start_location.location_id;
          task_obj['move_type'] = MOVE_TYPE.INVENTORY_TO_STATION;
        }
        else if (task.move_type === MOVE_TYPE.WAITING_LOCATION_TO_STATION){
          task_obj['sourceWaitingLocationId'] = task.start_location.location_id;
          task_obj['move_type'] = MOVE_TYPE.WAITING_LOCATION_TO_STATION;
        }
        else {
          task_obj['sourceStationId'] = task.start_location.location_id;
          task_obj['move_type'] = MOVE_TYPE.STATION_TO_STATION;
        }
      }
      console.log(`Creating new task with obj: ${JSON.stringify(task_obj)}`);
      const [newTaskId,newTask] = await this.createTask(task_obj)
      if (newTask && newTaskId) {
        await this.sendSingleTaskToWms(newTask);
        await this.loggingService.log(`Retry Task: ${taskID}, New Task: ${newTaskId}, start location: ${newTask.start_location.location_id}, destination location: ${newTask.end_location.location_id}`, TaskType.GOODS_TO_PERSON,newTaskId,null);
        await this.loggingService.deleteErrorLogsForTask(taskID);
      }
    }
    else if (task.move_type === MOVE_TYPE.STATION_TO_INVENTORY){
      const destinationLocation = task.end_location.location_id;
      if (!await this.inventoryService.reserveInventory(destinationLocation)){
        throw new BadRequestException(`Destination location for this task is not available right now.`);
      }
      const task_obj = {
        batchId: task.batch_id,
        originLocation: task.origin_location,
        destinationInventoryId: destinationLocation,
        taskType: TaskType.GOODS_TO_PERSON,
        move_type: MOVE_TYPE.STATION_TO_INVENTORY,
        sequenceOrder: task.sequence_order+1,
        taskDependency: task.task_id,
        robotId: task.robot_id,
        cargos: task.cargos,
      };
      let sourceLocationId : string | null = null;
      if (task.processing) {
        sourceLocationId = task.start_location.location_id;
        task_obj['sourceInventoryId'] = task.end_location.location_id;
        task_obj['move_type'] = MOVE_TYPE.INVENTORY_TO_INVENTORY;
      }
      if  (!sourceLocationId){
        if (task.move_type === MOVE_TYPE.STATION_TO_INVENTORY){
          task_obj['sourceStationId'] = task.start_location.location_id;
          task_obj['move_type'] = MOVE_TYPE.STATION_TO_INVENTORY;
        }
      }
      console.log(`Creating new task with obj: ${JSON.stringify(task_obj)}`);
      const [newTaskId,newTask] = await this.createTask(task_obj)
      if (newTask && newTaskId) {
        await this.sendSingleTaskToWms(newTask);
        await this.loggingService.deleteErrorLogsForTask(taskID);
        await this.loggingService.log(`Retry Task: ${taskID}, New Task: ${newTaskId}, start location: ${newTask.start_location.location_id}, destination location: ${newTask.end_location.location_id}`, TaskType.GOODS_TO_PERSON,newTaskId,null);
      }
    }
    else if (task.move_type === MOVE_TYPE.STATION_TO_WAITING_LOCATION){
      const destinationLocation = task.end_location.location_id;
      if (!await this.waitingLocationService.reserveWaitingLocation(destinationLocation)){
        throw new BadRequestException(`Destination location for this task is not available right now.`);
      }
      const task_obj = {
        batchId: task.batch_id,
        originLocation: task.origin_location,
        destinationWaitingLocationId: destinationLocation,
        taskType: TaskType.GOODS_TO_PERSON,
        move_type: MOVE_TYPE.STATION_TO_WAITING_LOCATION,
        sequenceOrder: task.sequence_order+1,
        taskDependency: task.task_id,
        robotId: task.robot_id,
        cargos: task.cargos,
      };
      let sourceLocationId : string | null = null;
      if (task.processing) {
        sourceLocationId = task.start_location.location_id;
        task_obj['sourceWaitingLocationId'] = task.end_location.location_id;
        task_obj['move_type'] = MOVE_TYPE.WAITING_TO_WAITING_LOCATION;
      }
      if  (!sourceLocationId){
        if (task.move_type === MOVE_TYPE.STATION_TO_WAITING_LOCATION){
          task_obj['sourceStationId'] = task.start_location.location_id;
          task_obj['move_type'] = MOVE_TYPE.STATION_TO_WAITING_LOCATION;
        }
      }
      console.log(`Creating new task with obj: ${JSON.stringify(task_obj)}`);
      const [newTaskId,newTask] = await this.createTask(task_obj)
      if (newTask && newTaskId) {
        await this.sendSingleTaskToWms(newTask);
        await this.loggingService.deleteErrorLogsForTask(taskID);
        await this.loggingService.log(`Retry Task: ${taskID}, New Task: ${newTaskId}, start location: ${newTask.start_location.location_id}, destination location: ${newTask.end_location.location_id}`, TaskType.GOODS_TO_PERSON,newTaskId,null);
      }
    }
    else if (task.move_type === MOVE_TYPE.INVENTORY_TO_INVENTORY){
      const [newTaskId,newTask] = await this.createTask({
        batchId: task.batch_id,
        originLocation: task.origin_location,
        sourceInventoryId: task.start_location.location_id,
        destinationStationId: task.end_location.location_id,
        taskType: TaskType.GOODS_TO_PERSON,
        move_type: MOVE_TYPE.INVENTORY_TO_INVENTORY,
        sequenceOrder: task.sequence_order+1,
        taskDependency: task.task_id,
        robotId: task.robot_id,
        cargos: task.cargos,
      });
      if (newTask && newTaskId) {
        await this.sendSingleTaskToWms(newTask);
        await this.loggingService.log(`Retry Task: ${taskID}, New Task: ${newTaskId}, start location: ${newTask.start_location.location_id}, destination location: ${newTask.end_location.location_id}`, TaskType.GOODS_TO_PERSON,newTaskId,null);
        await this.loggingService.deleteErrorLogsForTask(taskID);
      }
    }
    else if (task.move_type === MOVE_TYPE.WAITING_TO_WAITING_LOCATION){
      const [newTaskId,newTask] = await this.createTask({
        batchId: task.batch_id,
        originLocation: task.origin_location,
        sourceWaitingLocationId: task.start_location.location_id,
        destinationWaitingLocationId: task.end_location.location_id,
        taskType: TaskType.GOODS_TO_PERSON,
        move_type: MOVE_TYPE.WAITING_TO_WAITING_LOCATION,
        sequenceOrder: task.sequence_order+1,
        taskDependency: task.task_id,
        robotId: task.robot_id,
        cargos: task.cargos,
      });
      if (newTask && newTaskId) {
        await this.sendSingleTaskToWms(newTask);
        await this.loggingService.log(`Retry Task: ${taskID}, New Task: ${newTaskId}, start location: ${newTask.start_location.location_id}, destination location: ${newTask.end_location.location_id}`, TaskType.GOODS_TO_PERSON,newTaskId,null);
        await this.loggingService.deleteErrorLogsForTask(taskID);
      }
    }
    else if (task.move_type === MOVE_TYPE.EMPTY_TO_EMPTY_LOCATION){
      const [newTaskId,newTask] = await this.createTask({
        batchId: task.batch_id,
        originLocation: task.origin_location,
        sourceEmptyLocationId: task.start_location.location_id,
        destinationEmptyLocationId: task.end_location.location_id,
        taskType: TaskType.GOODS_TO_PERSON,
        move_type: MOVE_TYPE.EMPTY_TO_EMPTY_LOCATION,
        sequenceOrder: task.sequence_order+1,
        taskDependency: task.task_id,
        robotId: task.robot_id,
        cargos: task.cargos,
      });
      if (newTask && newTaskId) {
        await this.sendSingleTaskToWms(newTask);
        await this.loggingService.log(`Retry Task: ${taskID}, New Task: ${newTaskId}, start location: ${newTask.start_location.location_id}, destination location: ${newTask.end_location.location_id}`, TaskType.GOODS_TO_PERSON,newTaskId,null);
        await this.loggingService.deleteErrorLogsForTask(taskID);
      }
    }
    else if (task.move_type === MOVE_TYPE.STATION_TO_EMPTY_LOCATION){
      const destinationLocation = task.end_location.location_id;
      if (!await this.emptyLocationsService.reserveEmptyLocation(destinationLocation)){
        throw new BadRequestException(`Destination location for this task is not available right now.`);
      }
      const task_obj = {
        batchId: task.batch_id,
        originLocation: task.origin_location,
        destinationEmptyLocationId: destinationLocation,
        taskType: TaskType.GOODS_TO_PERSON,
        move_type: MOVE_TYPE.STATION_TO_EMPTY_LOCATION,
        sequenceOrder: task.sequence_order+1,
        taskDependency: task.task_id,
        robotId: task.robot_id,
        cargos: task.cargos,
      };
      let sourceLocationId : string | null = null;
      if (task.processing) {
        sourceLocationId = task.start_location.location_id;
        task_obj['sourceEmptyLocationId'] = task.end_location.location_id;
        task_obj['move_type'] = MOVE_TYPE.EMPTY_TO_EMPTY_LOCATION;
      }
      if  (!sourceLocationId){
        if (task.move_type === MOVE_TYPE.STATION_TO_EMPTY_LOCATION){
          task_obj['sourceStationId'] = task.start_location.location_id;
          task_obj['move_type'] = MOVE_TYPE.STATION_TO_EMPTY_LOCATION;
        }
      }
      console.log(`Creating new task with obj: ${JSON.stringify(task_obj)}`);
      const [newTaskId,newTask] = await this.createTask(task_obj)
      if (newTask && newTaskId) {
        await this.sendSingleTaskToWms(newTask);
        await this.loggingService.deleteErrorLogsForTask(taskID);
        await this.loggingService.log(`Retry Task: ${taskID}, New Task: ${newTaskId}, start location: ${newTask.start_location.location_id}, destination location: ${newTask.end_location.location_id}`, TaskType.GOODS_TO_PERSON,newTaskId,null);
      }
    }
    else if (task.move_type === MOVE_TYPE.WAITING_LOCATION_TO_EMPTY_LOCATION){
      const destinationLocation = task.end_location.location_id;
      if (!await this.emptyLocationsService.reserveEmptyLocation(destinationLocation)){
        throw new BadRequestException(`Destination location for this task is not available right now.`);
      }
      const task_obj = {
        batchId: task.batch_id,
        originLocation: task.origin_location,
        destinationEmptyLocationId: destinationLocation,
        taskType: TaskType.GOODS_TO_PERSON,
        move_type: MOVE_TYPE.WAITING_LOCATION_TO_EMPTY_LOCATION,
        sequenceOrder: task.sequence_order+1,
        taskDependency: task.task_id,
        robotId: task.robot_id,
        cargos: task.cargos,
      };
      let sourceLocationId : string | null = null;
      if (task.processing) {
        sourceLocationId = task.start_location.location_id;
        task_obj['sourceEmptyLocationId'] = task.end_location.location_id;
        task_obj['move_type'] = MOVE_TYPE.EMPTY_TO_EMPTY_LOCATION;
      }
      if  (!sourceLocationId){
        if (task.move_type === MOVE_TYPE.WAITING_LOCATION_TO_EMPTY_LOCATION){
          task_obj['sourceWaitingLocationId'] = task.start_location.location_id;
          task_obj['move_type'] = MOVE_TYPE.WAITING_LOCATION_TO_EMPTY_LOCATION;
        }
      }
      console.log(`Creating new task with obj: ${JSON.stringify(task_obj)}`);
      const [newTaskId,newTask] = await this.createTask(task_obj)
      if (newTask && newTaskId) {
        await this.sendSingleTaskToWms(newTask);
        await this.loggingService.deleteErrorLogsForTask(taskID);
        await this.loggingService.log(`Retry Task: ${taskID}, New Task: ${newTaskId}, start location: ${newTask.start_location.location_id}, destination location: ${newTask.end_location.location_id}`, TaskType.GOODS_TO_PERSON,newTaskId,null);
      }
    }
  }
  
}