import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Batch, BatchStatus } from 'src/entities/batch.entity';
import { Task, TaskStatus } from 'src/entities/task.entity';
import { Inventory } from 'src/entities/inventory.entity';
import { Station, LocationStatus } from 'src/entities/station.entity';
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
    // if (mappedStatus === TaskStatus.COMPLETED) {
    //   await this.handleTaskCompletion(task);
    // }
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
    } catch (error) {
      this.logger.error(`Error handling station updates for task ${task.task_id}:`, error.message);
    }
  }

  private async handleTaskCompletion(completedTask: Task): Promise<void> {
    try {
      // Safety check: Only process completion for tasks that are actually COMPLETED
      if (completedTask.status !== TaskStatus.COMPLETED) {
        this.logger.warn(`Task ${completedTask.task_id} completion handler called but task status is ${completedTask.status} - skipping`);
        return;
      }

      this.logger.log(`Handling completion of task ${completedTask.task_id} in batch ${completedTask.batch_id}`);
      
      // Find the next sequence task in the same batch
      const nextTask = await this.taskRepository.findOne({
        where: { 
          batch_id: completedTask.batch_id,
          sequence_order: completedTask.sequence_order + 1
        }
      });

      if (nextTask) {
        this.logger.log(`Found next task ${nextTask.task_id} (sequence ${nextTask.sequence_order}) in batch ${completedTask.batch_id}`);
        await this.processNextTask(nextTask);
      } else {
        // No next task - batch is completed
        this.logger.log(`No next task found. Marking batch ${completedTask.batch_id} as completed`);
        await this.markBatchAsCompleted(completedTask.batch_id);
      }
    } catch (error) {
      this.logger.error(`Error handling task completion for task ${completedTask.task_id}:`, error.message);
    }
  }

  private async processNextTask(nextTask: Task): Promise<void> {
    // Safety check: Only process tasks that are in PENDING status
    if (nextTask.status !== TaskStatus.PENDING) {
      this.logger.warn(`Next task ${nextTask.task_id} is not in PENDING status (current: ${nextTask.status}) - skipping processing`);
      return;
    }

    const destinationLocation = nextTask.end_location;
    
    if (destinationLocation?.location_attribute?.attribute_value === 'inventory') {
      // Destination is inventory - send directly to WMS
      this.logger.log(`Next task ${nextTask.task_id} destination is inventory - sending directly to WMS`);
      await this.orchestratorService.sendSingleTaskToWms(nextTask);
    } else if (destinationLocation?.location_attribute?.attribute_value === 'station') {
      // Destination is station - check availability
      const stationId = destinationLocation.location_id;
      await this.handleNextTaskStationRequest(nextTask, stationId);
    } else {
      this.logger.warn(`Next task ${nextTask.task_id} has unknown destination location type`);
    }
  }

  private async handleNextTaskStationRequest(nextTask: Task, stationId: string): Promise<void> {
    const station = await this.stationRepository.findOne({
      where: { station_id: stationId }
    });

    if (!station) {
      this.logger.warn(`Station ${stationId} not found for next task ${nextTask.task_id}`);
      return;
    }

    if (station.status === LocationStatus.AVAILABLE) {
      // Station is available - reserve it and send task to WMS
      this.logger.log(`Station ${stationId} is available for next task ${nextTask.task_id} - reserving and sending to WMS`);
      
      await this.stationRepository.update(
        { station_id: stationId },
        { 
          status: LocationStatus.RESERVED,
          holded_by: nextTask.task_id
        }
      );

      await this.orchestratorService.sendSingleTaskToWms(nextTask);
    } else {
      // Station is not available - add to request queue
      this.logger.log(`Station ${stationId} is not available for next task ${nextTask.task_id} - adding to request queue`);
      await this.addTaskToStationQueue(nextTask, stationId);
    }
  }

  private async addTaskToStationQueue(task: Task, stationId: string): Promise<void> {
    // Use orchestrator service to add station request
    await this.orchestratorService.addStationRequest(task, stationId);
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
