import { ApiProperty } from '@nestjs/swagger';
import { WMSBatchJobTaskType, WMSBatchJobTaskStatus } from '../entities/batch_job_task';
import { WMSBatchJobTaskLocationDto } from './batch-job-task-location.dto';
import { WMSBatchJobTaskCargoDto } from './batch-job-task-cargo.dto';

export class WMSBatchJobTaskDto {
  @ApiProperty({
    example: 'TASK-12345',
    description: 'Unique identifier for the task',
  })
  task_id: string;

  @ApiProperty({
    enum: WMSBatchJobTaskType,
    example: WMSBatchJobTaskType.CROSSDOCK,
    description: 'Type of task',
  })
  task_type: WMSBatchJobTaskType;

  @ApiProperty({
    enum: WMSBatchJobTaskStatus,
    example: WMSBatchJobTaskStatus.TASK_ACKNOWLEDGED,
    required: false,
    description: 'Current status of the task',
  })
  status?: WMSBatchJobTaskStatus;

  @ApiProperty({
    type: WMSBatchJobTaskLocationDto,
    description: 'Start location for the task',
  })
  start_location: WMSBatchJobTaskLocationDto;

  @ApiProperty({
    type: WMSBatchJobTaskLocationDto,
    description: 'End location for the task',
  })
  end_location: WMSBatchJobTaskLocationDto;

  @ApiProperty({
    type: [WMSBatchJobTaskCargoDto],
    description: 'Array of cargo items associated with this task',
    example: [{ cargo_code: 'PRD001' }],
  })
  cargos: WMSBatchJobTaskCargoDto[];
}

