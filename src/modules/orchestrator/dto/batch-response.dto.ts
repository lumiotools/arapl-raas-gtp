import { ApiProperty } from '@nestjs/swagger';
import { BatchStatus } from 'src/entities/batch.entity';
import { TaskResponseDto } from './task-response.dto';

export class BatchResponseDto {
  @ApiProperty({
    description: 'Unique identifier for the batch',
    example: 'BATCH12345678',
  })
  batch_id: string;

  @ApiProperty({
    description: 'Description of the batch content',
    example: 'Batch for 3 products: PRD001, PRD002, PRD003',
    nullable: true,
  })
  description?: string;

  @ApiProperty({
    description: 'Current status of the batch',
    enum: BatchStatus,
    example: BatchStatus.PENDING,
  })
  status: BatchStatus;

  @ApiProperty({
    description: 'Total number of tasks in this batch',
    example: 15,
  })
  total_tasks: number;

  @ApiProperty({
    description: 'Number of completed tasks in this batch',
    example: 0,
  })
  completed_tasks: number;

  @ApiProperty({
    description: 'Timestamp when the batch was created',
    example: '2024-01-15T10:30:00.000Z',
  })
  created_at: Date;

  @ApiProperty({
    description: 'Timestamp when the batch was last updated',
    example: '2024-01-15T10:30:00.000Z',
  })
  updated_at: Date;

  @ApiProperty({
    description: 'List of tasks in this batch (included when fetching batch details)',
    type: [TaskResponseDto],
    required: false,
  })
  tasks?: TaskResponseDto[];
}
