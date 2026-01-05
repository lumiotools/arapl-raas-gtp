import { ApiProperty } from '@nestjs/swagger';
import { WMSBatchJobStatus } from '../entities/batch_job';
import { WMSBatchJobTaskDto } from './batch-job-task.dto';

export class WMSBatchJobDto {
  @ApiProperty({
    example: 'BATCH-12345',
    required: false,
    description: 'Unique identifier for the batch job',
  })
  batch_job_id?: string;

  @ApiProperty({
    enum: WMSBatchJobStatus,
    example: WMSBatchJobStatus.TASK_ACKNOWLEDGED,
    required: false,
    description: 'Current status of the batch job',
  })
  batch_job_status?: WMSBatchJobStatus;

  @ApiProperty({
    example: 1,
    required: false,
    description: 'Priority of the batch (1 = HIGH, 2 = MEDIUM, 3 = LOW)',
    minimum: 1,
    maximum: 3,
  })
  batch_priority?: number;

  @ApiProperty({
    example: 'CROSSDOCK',
    required: false,
    description: 'Type of batch',
  })
  batch_type?: string;

  @ApiProperty({
    type: [WMSBatchJobTaskDto],
    description: 'Array of tasks in this batch',
  })
  tasks: WMSBatchJobTaskDto[];
}

