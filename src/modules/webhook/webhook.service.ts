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
import { dashboard } from 'src/entities/dashboard.entity';

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
    @InjectRepository(dashboard)
    private readonly dashRepository: Repository<dashboard>,
    private readonly orchestratorService: OrchestratorService,
    private readonly loggingService: LoggingService,
    private readonly httpService: HttpService,
  ) {}

  async processWebhook(webhookData: WebhookRequestDto): Promise<{ message: string }> {
    this.logger.log(`Processing webhook for batch ${webhookData.batch_job_id} with status ${webhookData.batch_job_status}`);
    this.logger.log(`Received ${webhookData.tasks_status.length} task status updates`);
    
    try {
      // Update batch status
      // await this.updateBatchStatus(webhookData.batch_job_id, webhookData.batch_job_status);

      // Update individual task statuses
      for (const taskStatus of webhookData.tasks_status) {
        await this.updateTaskStatus(webhookData.batch_job_id, taskStatus);
      }

      this.logger.log(`Successfully processed webhook for batch ${webhookData.batch_job_id}`);
      return { message: 'Webhook processed successfully' };
    } catch (error) {
      this.logger.error(`Error processing webhook: ${error.message}`);
      throw error;
    }
  }

  private async updateBatchStatus(batchId: string, status: string): Promise<void> {
    const batch = await this.batchRepository.findOne({
      where: { batch_id: batchId }
    });

    if (!batch) {
      this.logger.warn(`Batch with ID ${batchId} not found, skipping batch status update`);
      return;
    }

    const mappedStatus = this.mapBatchStatus(status);
    
    this.logger.log(`Updating batch ${batchId} status from ${batch.status} to ${mappedStatus}`);
    
    await this.batchRepository.update(
      { batch_id: batchId },
      { status: mappedStatus }
    );
  }

  private async updateTaskStatus(batchId: string, taskStatusData: any): Promise<void> {
    // Find task by task_id only (ignore batch_id as instructed)
    const task = await this.taskRepository.findOne({
      where: { 
        task_id: parseInt(taskStatusData.task_id)
      }
    });

    if (!task) {
      this.logger.warn(`Task with ID ${taskStatusData.task_id} not found, skipping task status update`);
      return;
    }

    const oldStatus = task.status;
    const mappedStatus = this.mapTaskStatus(taskStatusData.status);

    if (oldStatus === mappedStatus) {
      this.logger.log(`No status change for task ${taskStatusData.task_id} - current status is already ${mappedStatus}`);
      return; // No change needed
    }
    // update dashboard time
    let dashboardTask = await this.dashRepository.findOne({
      where: { task_id: parseInt(taskStatusData.task_id) }
    });
    if (!dashboardTask) {
      dashboardTask = await this.dashRepository.save({
        task_id: parseInt(taskStatusData.task_id),
      })
    }
    const currentTime = new Date();
    if (mappedStatus === TaskStatus.INQUEUE) {
      dashboardTask.inqueue = currentTime;
    } else if (mappedStatus === TaskStatus.PROCESSING) {
      dashboardTask.processing = currentTime;
    } else if (mappedStatus === TaskStatus.COMPLETED) {
      dashboardTask.completed = currentTime;
    } else if (mappedStatus === TaskStatus.TRIGERRED) {
      dashboardTask.triggered = currentTime;
    }
    await this.dashRepository.save(dashboardTask);
    
    this.logger.log(`🔄 Updating task ${taskStatusData.task_id} status from ${oldStatus} to ${mappedStatus} (webhook status: "${taskStatusData.status}")`);
    
    // Log webhook received after duplicate check
    await this.loggingService.log(`Task ${taskStatusData.task_id}: Webhook Received - status from ${oldStatus} to ${mappedStatus} (robot: ${taskStatusData.robot_id || 'none'})`);
    
    await this.taskRepository.update(
      { task_id: parseInt(taskStatusData.task_id) },
      { status: mappedStatus,
        robot_id: taskStatusData.robot_id || null,
      }
    );

    task.status = mappedStatus;
    task.robot_id = taskStatusData.robot_id || null; 

    // Handle inventory updates based on task status changes
    await this.handleInventoryUpdates(task, oldStatus, mappedStatus, batchId);
    
    // Handle station status updates
    await this.handleStationUpdates(task, oldStatus, mappedStatus);
    
    // Handle task completion based on destination type
    if (mappedStatus === TaskStatus.COMPLETED) {
      this.logger.log(`🎯 Task ${task.task_id} COMPLETED - checking destination type`);
      const currentTask = await this.taskRepository.findOne({
        where: { task_id: task.task_id }
      });
      
      if (currentTask && currentTask.status === TaskStatus.COMPLETED) {
        const destinationType = task.end_location?.location_attribute.attribute_value;
        this.logger.log(`📍 Task ${task.task_id} destination type: ${destinationType}`);
        
        if (destinationType === 'waiting_location') {
          // Task completed at waiting location - handle waiting location completion
          this.logger.log(`🏁 Calling waiting location completion handler for task ${task.task_id}`);
          await this.handleWaitingLocationCompletion(task);
          
          // Free robot when task is completed at waiting location
          // if (currentTask.robot_id) {
          //   await this.freeRobot(currentTask.robot_id);
          // }
        } else if (destinationType === 'inventory') {
          // Task completed at inventory (return task) - free robot
          this.logger.log(`🏁 Task ${task.task_id} completed at inventory - freeing robot`);
          
          // Free robot when task is completed at inventory
          if (currentTask.robot_id) {
            await this.freeRobot(currentTask.robot_id);
          }
        }
        // Note: Station completions are handled by trigger API when task is TRIGGERED
      }
    }
    
    // Handle task processing - release source station when task goes to PROCESSING
    if (mappedStatus === TaskStatus.PROCESSING) {
      this.logger.log(`⚙️  Task ${task.task_id} PROCESSING - calling processing handler`);
      const currentTask = await this.taskRepository.findOne({
        where: { task_id: task.task_id }
      });
      
      if (currentTask && currentTask.status === TaskStatus.PROCESSING) {
        this.logger.log(`🔧 Calling task processing handler for task ${task.task_id}`);
        await this.handleTaskProcessing(task);
      }
    }
  }

  private mapBatchStatus(webhookStatus: string): BatchStatus {
    const statusMap: { [key: string]: BatchStatus } = {
      'pending': BatchStatus.PENDING,
      'inqueue': BatchStatus.INQUEUE,
      'processing': BatchStatus.PROCESSING,
      'completed': BatchStatus.COMPLETED,
      'cancelled': BatchStatus.CANCELLED,
      'failed': BatchStatus.FAILED
    };

    const mapped = statusMap[webhookStatus.toLowerCase()];
    if (!mapped) {
      this.logger.warn(`Unknown batch status: ${webhookStatus}, defaulting to PENDING`);
      return BatchStatus.PENDING;
    }
    
    return mapped;
  }

  private mapTaskStatus(webhookStatus: string): TaskStatus {
    const statusMap: { [key: string]: TaskStatus } = {
      'pending': TaskStatus.PENDING,
      'assigned': TaskStatus.ASSIGNED,
      'inqueue': TaskStatus.INQUEUE,
      'inprogress': TaskStatus.INPROGRESS,
      'processing': TaskStatus.PROCESSING,
      'completed': TaskStatus.COMPLETED,
      'cancelled': TaskStatus.CANCELLED,
      'failed': TaskStatus.FAILED
    };

    const mapped = statusMap[webhookStatus.toLowerCase()];
    if (!mapped) {
      this.logger.warn(`Unknown task status: ${webhookStatus}, defaulting to PENDING`);
      return TaskStatus.PENDING;
    }
    
    return mapped;
  }

  private async releaseProcessingInventory(inventoryLocationId: any, productId: any): Promise<void> {

    this.logger.log(`Releasing inventory for product ${productId} at location ${inventoryLocationId}`);

    await this.inventoryRepository.update(
      { 
        id: inventoryLocationId,
        product_id: productId 
      },
      { quantity: 0 ,
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
      // Case 1: FIRST task from inventory goes to INPROGRESS or PROCESSING - set inventory to 
      if ((newStatus === TaskStatus.INPROGRESS || newStatus === TaskStatus.PROCESSING) && 
          this.isTaskFromInventory(task) && 
          await this.isFirstTaskInBatch(task, batchId)) {
        await this.setInventoryToZero(task);
        await this.releaseProcessingInventory(task.start_location.location_id, task.product_id);
      }

      // Case 2: Last task returning to inventory goes to COMPLETED - update inventory with task quantity
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

  private async setInventoryToZero(task: Task): Promise<void> {
    const inventoryLocationId = task.start_location.location_id;
    const productId = task.product_id;

    this.logger.log(`Setting inventory to 0 for product ${productId} at location ${inventoryLocationId}`);

    await this.inventoryRepository.update(
      { 
        id: inventoryLocationId,
        product_id: productId 
      },
      { quantity: 0 }
    );
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
    if (!inventory) {
      this.logger.warn(`Inventory location ${inventoryLocationId} for product ${productId} not found`);
      return;
    }

    this.logger.log(`Updating inventory for product ${productId} at location ${inventoryLocationId} with quantity ${quantity}`);
    console.log(`Current inventory quantity: ${inventory.quantity}, quantity in system: ${inventory.quantity_in_system}`);
    await this.inventoryRepository.update(
      { 
        id: inventoryLocationId,
        product_id: productId 
      },
      { quantity: quantity + (inventory?.quantity || 0) ,
        quantity_in_system: inventory?.quantity_in_system - quantity,
        status: LocationStatus.AVAILABLE,
        isProcessing: inventory?.quantity_in_system - quantity > 0 ? true : false
      }
    );
  }

  private async isFirstTaskInBatch(task: Task, batchId: string): Promise<boolean> {
    // Check if this task has sequence_order = 1 (first task in batch)
    return task.sequence_order === 1;
  }

  private async handleStationUpdates(task: Task, oldStatus: TaskStatus, newStatus: TaskStatus): Promise<void> {
    try {
      // Handle station updates
      await this.handleStationStatusUpdates(task, newStatus);
      
      // Handle waiting location updates
      await this.handleWaitingLocationStatusUpdates(task, newStatus);
    } catch (error) {
      this.logger.error(`Error handling location updates for task ${task.task_id}:`, error.message);
    }
  }

  private async handleStationStatusUpdates(task: Task, newStatus: TaskStatus): Promise<void> {
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
    
    // Note: Station release when task goes to PROCESSING is now handled by orchestrator service
  }

  private async handleWaitingLocationStatusUpdates(task: Task, newStatus: TaskStatus): Promise<void> {
    // When task status becomes PROCESSING and source location is waiting_location - mark waiting location as AVAILABLE
    if (newStatus === TaskStatus.PROCESSING && 
        task.start_location?.location_attribute?.attribute_value === 'waiting_location') {
      
      const waitingLocationId = task.start_location.location_id;
      this.logger.log(`Marking waiting location ${waitingLocationId} as AVAILABLE and clearing holded_by (task ${task.task_id} processing)`);
      
      await this.waitingLocationRepository.update(
        { location_id: waitingLocationId },
        { 
          status: LocationStatus.AVAILABLE,
          holded_by: null
        }
      );
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

  private async handleTaskProcessing(processingTask: Task): Promise<void> {
    try {
      this.logger.log(`Handling task ${processingTask.task_id} going to PROCESSING state`);
      
      // Call orchestrator to handle task processing (release source station)
      await this.orchestratorService.handleTaskProcessing(processingTask);
    } catch (error) {
      this.logger.error(`Error handling task processing for task ${processingTask.task_id}:`, error.message);
    }
  }

  // Method to free robot by calling the external endpoint
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
}
