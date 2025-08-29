import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { Batch, BatchStatus } from 'src/entities/batch.entity';
import { Task, TaskStatus } from 'src/entities/task.entity';
import { Inventory } from 'src/entities/inventory.entity';
import { Station, LocationStatus } from 'src/entities/station.entity';
import { WaitingLocation} from 'src/entities/waiting-location.entity';
import { WebhookRequestDto } from './dto/webhook-request.dto';
import { OrchestratorService } from '../orchestrator/orchestrator.service';
import { LoggingService } from '../../services/logging.service';
import { WaitingLocationService } from '../waiting_location/waiting_location.service';
import { MOVE_TYPE, Robot } from 'src/entities';

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    @InjectRepository(Batch)
    private readonly batchRepository: Repository<Batch>,
    @InjectRepository(Task)
    private readonly taskRepository: Repository<Task>,
    @InjectRepository(Inventory)
    private readonly inventoryRepository: Repository<Inventory>,
    @InjectRepository(Station)
    private readonly stationRepository: Repository<Station>,
    @InjectRepository(WaitingLocation)
    private readonly waitingLocationRepository: Repository<WaitingLocation>,
    @InjectRepository(Robot)
    private readonly robotRepository: Repository<Robot>,
    private readonly orchestratorService: OrchestratorService,
    private readonly loggingService: LoggingService,
    private readonly httpService: HttpService,
    private readonly waitingLocationService: WaitingLocationService
  ) {}

  async processWebhook(webhookData: any): Promise<{ message: string }> {
    this.logger.log(`Processing webhook for batch ${webhookData.batch_job_id} with status ${webhookData.batch_job_status}`);
    this.logger.log(`Received ${webhookData.tasks.length} task status updates`);
    
    try {
      for (const taskStatus of webhookData.tasks) {
        await this.updateTaskStatus(webhookData.batch_job_id, taskStatus);
      }
      return { message: 'Webhook processed successfully' };
    } catch (error) {
      this.logger.error(`Error processing webhook: ${error.message}`);
      throw error;
    }
  }

  private async updateTaskStatus(fms_batch_id: string, taskStatusData: any): Promise<void> {
    // Find task by task_id only (ignore batch_id as instructed)
    const task = await this.taskRepository.findOne({
      where: { task_id: taskStatusData.task_id }
    });
    if (!task) {return;}
    if (task.status === TaskStatus.TRIGERRED) {
      this.logger.log(`Task ${taskStatusData.task_id} is already triggered - skipping update`);
      return;
    }
    // define priority for TaskStatus such that TRIGERRED = CANCELLED  > COMPLETED > PROCESSING > INQUEUE > ASSIGNED > PENDING
    const statusPriority = {
      [TaskStatus.TRIGERRED]: 7,
      [TaskStatus.CANCELLED]: 7,
      [TaskStatus.COMPLETED]: 6,
      [TaskStatus.PROCESSING]: 5,
      [TaskStatus.INQUEUE]: 4,
      [TaskStatus.ASSIGNED]: 3,
      [TaskStatus.PENDING]: 2
    };

    const oldStatus = task.status;
    const mappedStatus = this.mapTaskStatus(taskStatusData.status);

    if (statusPriority[mappedStatus] < statusPriority[oldStatus]) {
      this.logger.log(`Skipping status update for task ${taskStatusData.task_id}: new status ${mappedStatus} (priority ${statusPriority[mappedStatus]}) has lower priority than current status ${oldStatus} (priority ${statusPriority[oldStatus]})`);
      return;
    }

    if (oldStatus === mappedStatus) {
      this.logger.log(`No status change for task ${taskStatusData.task_id} - current status is already ${mappedStatus}`);
      return; // No change needed
    }
    
    // Log webhook received after duplicate check
    await this.loggingService.log(`Task ${taskStatusData.task_id}: Webhook Received - status from ${oldStatus} to ${mappedStatus} (robot: ${taskStatusData.robot_id || 'none'})`);
  
    task.status = mappedStatus;
    task.robot_id = taskStatusData.robot_id || null;
    task.fms_batch_id = fms_batch_id;
    const currentTime = new Date();
    if (mappedStatus === TaskStatus.INQUEUE) {
      task.inqueue = currentTime;
    } else if (mappedStatus === TaskStatus.PROCESSING) {
      task.processing = currentTime;
    } else if (mappedStatus === TaskStatus.COMPLETED) {
      task.completed = currentTime;
    } else if (mappedStatus === TaskStatus.TRIGERRED) {
      task.triggered = currentTime;
    }
    await this.taskRepository.save(task);

    // Handle inventory updates based on task status changes
    await this.handleInventoryUpdates(task, oldStatus, mappedStatus, task.batch_id);
    
    await this.handleStationStatusUpdates(task,mappedStatus);

    // Handle waiting location updates
    await this.handleWaitingLocationStatusUpdates(task, mappedStatus);

    if (mappedStatus === TaskStatus.CANCELLED){
      if (task.move_type === MOVE_TYPE.STATION_TO_WAITING_LOCATION){
        console.log(`releasing destination waiting location for cancelled task ${task.task_id}`);
        const destinationWaitingLocation = await this.waitingLocationRepository.findOne({ where: { location_id: task.end_location.location_id } });
        if (destinationWaitingLocation){
          await this.waitingLocationRepository.update({ location_id: destinationWaitingLocation.location_id }, { status: LocationStatus.AVAILABLE, holded_by: null });

        }
      }
      else if (task.move_type === MOVE_TYPE.WAITING_LOCATION_TO_INVENTORY){
        const destinationInventoryLocation = await this.inventoryRepository.findOne({ where: { id: task.end_location.location_id, product_id: task.product_id } });
        if (destinationInventoryLocation){
          await this.inventoryRepository.update({ id: destinationInventoryLocation.id }, { status: LocationStatus.AVAILABLE });
        }
      }
      else if (task.move_type === MOVE_TYPE.STATION_TO_INVENTORY){
        const destinationInventoryLocation = await this.inventoryRepository.findOne({ where: { id: task.end_location.location_id, product_id: task.product_id } });
        if (destinationInventoryLocation){
         await this.inventoryRepository.update({ id: destinationInventoryLocation.id }, { status: LocationStatus.AVAILABLE });
        }
      }
    }

    // Handle task completion based on destination type
    if (mappedStatus === TaskStatus.COMPLETED) {
      if (task && task.status === TaskStatus.COMPLETED) {
        const sourceType = task.start_location?.location_attribute.attribute_value;
        if (sourceType === 'station' && task.start_location.location_id !== task.end_location.location_id){
          // free the source station
          await this.stationRepository.update(
            { station_id: task.start_location.location_id, holded_by: task.task_id },
            { status: LocationStatus.AVAILABLE, holded_by: null }
          );
        } else if (sourceType === 'waiting_location' && task.start_location.location_id !== task.end_location.location_id){
          // free the source waiting location
          await this.waitingLocationRepository.update(
            { location_id: task.start_location.location_id, holded_by: task.task_id },
            { status: LocationStatus.AVAILABLE, holded_by: null }
          );
        }
      }
    }
  }

  

  private mapTaskStatus(webhookStatus: string): TaskStatus {
    console.log(webhookStatus);
    const statusMap: { [key: string]: TaskStatus } = {
      'pending': TaskStatus.PENDING,
      'assigned': TaskStatus.ASSIGNED,
      'inqueue': TaskStatus.INQUEUE,
      'task_acknowledged': TaskStatus.INQUEUE,
      'robot_assigned': TaskStatus.INQUEUE,
      'in-queue': TaskStatus.PROCESSING,
      'processing': TaskStatus.PROCESSING,
      'in-progress': TaskStatus.PROCESSING,
      'in progress': TaskStatus.PROCESSING,
      'pickup_successful': TaskStatus.PROCESSING,
      'robot_movement_started': TaskStatus.PROCESSING,
      'completed': TaskStatus.COMPLETED,
      'cancelled': TaskStatus.CANCELLED,
      'canceled': TaskStatus.CANCELLED,
      'drop_successful': TaskStatus.COMPLETED,
      'task_cancelled': TaskStatus.CANCELLED,
      'task_canceled': TaskStatus.CANCELLED,
      'drop_rejected': TaskStatus.CANCELLED,
      'pick_rejected': TaskStatus.CANCELLED,
      'pick_failed': TaskStatus.CANCELLED,
      'drop_failed': TaskStatus.CANCELLED
    };

    const mapped = statusMap[webhookStatus.toLowerCase()];
    if (!mapped) {
      this.logger.warn(`Unknown task status: ${webhookStatus}, defaulting to PENDING`);
      return TaskStatus.PENDING;
    }
    console.log(`Mapping webhook status ${webhookStatus} to TaskStatus: ${mapped}`);
    return mapped;
  }

  private async releaseProcessingInventory(inventoryLocationId: any, productId: any): Promise<void> {

    this.logger.log(`Releasing inventory for product ${productId} at location ${inventoryLocationId}`);

    await this.inventoryRepository.update(
      { 
        id: inventoryLocationId,
        product_id: productId 
      },
      {
        isProcessing: true,
        status: LocationStatus.AVAILABLE,
      }
    );
  }

  private async releaseCompleteInventory(inventoryLocationId: any, productId: any, task_qty: any): Promise<void> {
    this.logger.log(`Releasing inventory for product ${productId} at location ${inventoryLocationId}`);
    const inventory = await this.inventoryRepository.findOne({
      where: { 
        id: inventoryLocationId,
        product_id: productId 
      }
    });
    if (!inventory) {
      this.logger.warn(`Inventory location ${inventoryLocationId} for product ${productId} not found`);
      return;
    }
    await this.inventoryRepository.update(
      { 
        id: inventoryLocationId,
        product_id: productId 
      },
      {
        status: LocationStatus.AVAILABLE,
        isProcessing: false,
        quantity_in_system: inventory?.quantity_in_system - task_qty
      }
    );
  }

  private async handleInventoryUpdates(task: Task, oldStatus: TaskStatus, newStatus: TaskStatus, batchId: string): Promise<void> {
    try {
      // Case 1: FIRST task from inventory goes to PROCESSING - set inventory to 
      if ((newStatus === TaskStatus.PROCESSING || newStatus === TaskStatus.COMPLETED) && this.isTaskFromInventory(task)) {
        await this.releaseProcessingInventory(task.start_location.location_id, task.product_id);
      }
      if (newStatus === TaskStatus.COMPLETED && this.isTaskToInventory(task)) {
          await this.updateInventoryWithTaskQuantity(task);
      }
    } catch (error) {
      this.logger.error(`Error handling inventory updates for task ${task.task_id}:`, error.message);
    }
  }

  private isTaskFromInventory(task: Task): boolean {
    // Check if start_location has inventory attribute
    return task.start_location?.location_attribute?.attribute_value === 'inventory';
  }

  private isTaskToInventory(task: Task): boolean {
    // Check if end_location has inventory attribute
    return task.end_location?.location_attribute?.attribute_value === 'inventory';
  }

  private async isLastTaskInBatch(task: Task, batchId: string): Promise<boolean> {
    // Find the task with highest sequence_order that has inventory as end_location in this batch
    const lastTask = await this.taskRepository.findOne({
      where: { batch_id: batchId },
      order: { sequence_order: 'DESC' }
    });

    return !!(lastTask && 
           lastTask.task_id === task.task_id && 
           this.isTaskToInventory(lastTask));
  }

  private async updateInventoryWithTaskQuantity(task: Task): Promise<void> {
    const inventoryLocationId = task.end_location.location_id;
    const productId = task.product_id;
    const quantity = task.quantity;
    const inventory = await this.inventoryRepository.findOne({
      where: {
        id: inventoryLocationId,
        product_id: productId 
      }
    });
    if (!inventory) {return;}

    this.logger.log(`Updating inventory for product ${productId} at location ${inventoryLocationId} with quantity ${quantity}`);
    console.log(`Current inventory quantity: ${inventory.quantity}, quantity in system: ${inventory.quantity_in_system}`);
    await this.inventoryRepository.update(
      { 
        id: inventoryLocationId,
        product_id: productId 
      },
      {
        status: LocationStatus.AVAILABLE,
        isProcessing: false,
      }
    );
  }

  private async handleStationStatusUpdates(task: Task, newStatus: TaskStatus): Promise<void> {

    if (newStatus === TaskStatus.PROCESSING && task.start_location.location_attribute?.attribute_value === 'station'
      && task.start_location.location_id !== task.end_location.location_id
    ) {
      // When task status becomes PROCESSING and source is station - mark station as OCCUPIED
      const stationId = task.start_location.location_id;
      await this.orchestratorService.releaseStation(stationId, task.task_id);
    }

    // When task status becomes COMPLETED and destination is station - mark station as OCCUPIED
    if (newStatus === TaskStatus.COMPLETED && 
        task.end_location?.location_attribute?.attribute_value === 'station') {

      const stationId = task.end_location.location_id;
      this.logger.log(`Marking station ${stationId} as OCCUPIED (task ${task.task_id} completed)`);
      
      await this.stationRepository.update(
        { station_id: stationId },
        { 
          status: LocationStatus.OCCUPIED,
          holded_by: task.task_id
        }
      );
    }
  }

  private async handleWaitingLocationStatusUpdates(task: Task, newStatus: TaskStatus): Promise<void> {
    // When task status becomes PROCESSING and source location is waiting_location - mark waiting location as AVAILABLE
    if (newStatus === TaskStatus.PROCESSING && 
        task.start_location?.location_attribute?.attribute_value === 'waiting_location'
        && task.start_location.location_id !== task.end_location.location_id
      ) {
      
      const waitingLocationId = task.start_location.location_id;
      this.logger.log(`Marking waiting location ${waitingLocationId} as AVAILABLE and clearing holded_by (task ${task.task_id} processing)`);
      
      await this.waitingLocationRepository.update(
        { location_id: waitingLocationId },
        { 
          status: LocationStatus.AVAILABLE,
          holded_by: null
        }
      )
    }

    // When task status becomes COMPLETED and destination is waiting_location - mark waiting location as OCCUPIED
    if (newStatus === TaskStatus.COMPLETED && 
        task.end_location?.location_attribute?.attribute_value === 'waiting_location') {
      
      const waitingLocationId = task.end_location.location_id;
      this.logger.log(`Marking waiting location ${waitingLocationId} as OCCUPIED (task ${task.task_id} completed)`);
      
      await this.waitingLocationRepository.update(
        { location_id: waitingLocationId },
        { 
          status: LocationStatus.OCCUPIED,
          holded_by: task.task_id
        }
      );
    }
  }

  private async handleWaitingLocationCompletion(completedTask: Task): Promise<void> {
    try {
      // Safety check: Only process completion for tasks that are actually COMPLETED
      if (completedTask.status !== TaskStatus.COMPLETED) {
        this.logger.warn(`Waiting location task ${completedTask.task_id} completion handler called but task status is ${completedTask.status} - skipping`);
        return;
      }

      this.logger.log(`Handling completion of task ${completedTask.task_id} at waiting location`);
      
      // Call orchestrator to handle waiting location task completion according to requirement 2
      await this.orchestratorService.handleWaitingLocationTaskCompletion(completedTask);
    } catch (error) {
      this.logger.error(`Error handling waiting location task completion for task ${completedTask.task_id}:`, error.message);
    }
  }

  private async handleInventoryReturnCompletion(completedTask: Task): Promise<void> {
    try {
      this.logger.log(`Handling completion of return task ${completedTask.task_id} at inventory`);
      
      // Call orchestrator to handle inventory return task completion
      await this.orchestratorService.handleInventoryReturnTaskCompletion(completedTask);
    } catch (error) {
      this.logger.error(`Error handling inventory return completion for task ${completedTask.task_id}:`, error.message);
    }
  }

  private async markBatchAsCompleted(batchId: string): Promise<void> {
    try {
      await this.batchRepository.update(
        { batch_id: batchId },
        { status: BatchStatus.COMPLETED }
      );
      
      this.logger.log(`✅ Batch ${batchId} marked as COMPLETED - all tasks finished!`);
    } catch (error) {
      this.logger.error(`Error marking batch ${batchId} as completed:`, error.message);
    }
  }

  // Method to free robot by calling the external endpoint
  // private async freeRobot(robotId: string): Promise<void> {
  //   if (!robotId) {
  //     // await this.loggingService.log('Cannot free robot: robot_id is null or empty');
  //     return;
  //   }

  //   try {
  //     const response = await this.httpService.post(`${process.env.WMS_BASE_URL}/orchestrator/robot/set-available`, {
  //       robot_id: robotId
  //     }).toPromise();

  //     if (response && response.data) {
  //       // await this.loggingService.log(`Robot ${robotId} freed successfully: ${response.data.message || 'Robot set to available'}`);
  //     } else {
  //       // await this.loggingService.log(`Robot ${robotId} freed successfully`);
  //     }
  //   } catch (error) {
  //     // await this.loggingService.log(`Failed to free robot ${robotId}: ${error.message}`);
  //     // Don't throw error to avoid breaking the main process
  //   }
  // }
}
