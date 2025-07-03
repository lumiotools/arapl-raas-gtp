import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Batch, BatchStatus } from 'src/entities/batch.entity';
import { Task, TaskStatus } from 'src/entities/task.entity';
import { Inventory } from 'src/entities/inventory.entity';
import { WebhookRequestDto } from './dto/webhook-request.dto';

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
  ) {}

  async processWebhook(webhookData: WebhookRequestDto): Promise<{ message: string }> {
    this.logger.log(`Processing webhook for batch ${webhookData.batch_job_id} with status ${webhookData.batch_job_status}`);
    this.logger.log(`Received ${webhookData.tasks_status.length} task status updates`);
    
    try {
      // Update batch status
      await this.updateBatchStatus(webhookData.batch_job_id, webhookData.batch_job_status);

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
    const task = await this.taskRepository.findOne({
      where: { 
        task_id: parseInt(taskStatusData.task_id),
        batch_id: batchId 
      }
    });

    if (!task) {
      this.logger.warn(`Task with ID ${taskStatusData.task_id} in batch ${batchId} not found, skipping task status update`);
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
}
