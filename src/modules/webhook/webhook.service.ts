import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Batch, BatchStatus } from 'src/entities/batch.entity';
import { Task, TaskStatus } from 'src/entities/task.entity';
import { WebhookRequestDto } from './dto/webhook-request.dto';

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    @InjectRepository(Batch)
    private readonly batchRepository: Repository<Batch>,
    @InjectRepository(Task)
    private readonly taskRepository: Repository<Task>,
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

    const mappedStatus = this.mapTaskStatus(taskStatusData.status);
    
    this.logger.log(`Updating task ${taskStatusData.task_id} status from ${task.status} to ${mappedStatus}`);
    
    await this.taskRepository.update(
      { task_id: parseInt(taskStatusData.task_id) },
      { status: mappedStatus }
    );
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
      'inqueue': TaskStatus.ASSIGNED, // Map inqueue to assigned for tasks
      'inprogress': TaskStatus.INPROGRESS,
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
}
