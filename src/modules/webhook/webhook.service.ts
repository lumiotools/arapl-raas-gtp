import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Batch, BatchStatus } from 'src/entities/batch.entity';
import { Task, TaskStatus } from 'src/entities/task.entity';
import { Inventory } from 'src/entities/inventory.entity';
import { Station, LocationStatus } from 'src/entities/station.entity';
import { WaitingLocation, WaitingLocationStatus } from 'src/entities/waiting-location.entity';
import { WebhookRequestDto } from './dto/webhook-request.dto';
import { OrchestratorService } from '../orchestrator/orchestrator.service';

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
    private readonly orchestratorService: OrchestratorService,
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
    
    this.logger.log(`Updating task ${taskStatusData.task_id} status from ${oldStatus} to ${mappedStatus}`);
    
    await this.taskRepository.update(
      { task_id: parseInt(taskStatusData.task_id) },
      { status: mappedStatus }
    );

    // Handle inventory updates based on task status changes
    await this.handleInventoryUpdates(task, oldStatus, mappedStatus, batchId);
    
    // Handle station status updates
    await this.handleStationUpdates(task, oldStatus, mappedStatus);
    
    // Note: Next task scheduling is now handled by trigger API, not webhook completion
    if (task.end_location?.location_attribute.attribute_value === 'waiting_location' && mappedStatus === TaskStatus.COMPLETED) {
      // Only call waiting location completion handler if it wasn't already called
      const currentTask = await this.taskRepository.findOne({
        where: { task_id: task.task_id }
      });
      
      if (currentTask && currentTask.status === TaskStatus.COMPLETED) {
        await this.handleTaskCompletion(task);
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

  private async handleInventoryUpdates(task: Task, oldStatus: TaskStatus, newStatus: TaskStatus, batchId: string): Promise<void> {
    try {
      // Case 1: FIRST task from inventory goes to INPROGRESS or PROCESSING - set inventory to 0
      if ((newStatus === TaskStatus.INPROGRESS || newStatus === TaskStatus.PROCESSING) && 
          this.isTaskFromInventory(task) && 
          await this.isFirstTaskInBatch(task, batchId)) {
        await this.setInventoryToZero(task);
      }

      // Case 2: Last task returning to inventory goes to COMPLETED - update inventory with task quantity
      if (newStatus === TaskStatus.COMPLETED && this.isTaskToInventory(task)) {
        const isLastTask = await this.isLastTaskInBatch(task, batchId);
        if (isLastTask) {
          await this.updateInventoryWithTaskQuantity(task);
        }
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

    this.logger.log(`Updating inventory for product ${productId} at location ${inventoryLocationId} with quantity ${quantity}`);

    await this.inventoryRepository.update(
      { 
        id: inventoryLocationId,
        product_id: productId 
      },
      { quantity: quantity }
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
    // When task status becomes PROCESSING and source location is station - mark station as AVAILABLE
    if (newStatus === TaskStatus.PROCESSING && 
        task.start_location?.location_attribute?.attribute_value === 'station') {
      
      const stationId = task.start_location.location_id;
      this.logger.log(`Marking station ${stationId} as AVAILABLE and clearing holded_by (task ${task.task_id} processing)`);
      
      await this.stationRepository.update(
        { station_id: stationId },
        { 
          status: LocationStatus.AVAILABLE,
          holded_by: null
        }
      );

      // Process any pending requests for this station
      await this.orchestratorService.processStationRequests(stationId);
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
        task.start_location?.location_attribute?.attribute_value === 'waiting_location') {
      
      const waitingLocationId = task.start_location.location_id;
      this.logger.log(`Marking waiting location ${waitingLocationId} as AVAILABLE and clearing holded_by (task ${task.task_id} processing)`);
      
      await this.waitingLocationRepository.update(
        { location_id: waitingLocationId },
        { 
          status: WaitingLocationStatus.AVAILABLE,
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
          status: WaitingLocationStatus.OCCUPIED,
          holded_by: task.task_id
        }
      );
    }
  }

  private async handleTaskCompletion(completedTask: Task): Promise<void> {
    try {
      // Safety check: Only process completion for tasks that are actually COMPLETED
      if (completedTask.status !== TaskStatus.COMPLETED) {
        this.logger.warn(`Task ${completedTask.task_id} completion handler called but task status is ${completedTask.status} - skipping`);
        return;
      }

      this.logger.log(`Handling completion of task ${completedTask.task_id} at waiting location`);
      
      // Call orchestrator to handle waiting location task completion according to requirement 2
      await this.orchestratorService.handleWaitingLocationTaskCompletion(completedTask);
    } catch (error) {
      this.logger.error(`Error handling task completion for task ${completedTask.task_id}:`, error.message);
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
}
