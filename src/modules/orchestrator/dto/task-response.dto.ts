import { ApiProperty } from '@nestjs/swagger';
import { TaskType, TaskStatus } from 'src/entities/task.entity';

export class TaskResponseDto {
  @ApiProperty({
    description: 'Unique identifier for the task',
    example: 1,
  })
  task_id: number;

  @ApiProperty({
    description: 'Batch identifier this task belongs to',
    example: 'BATCH12345678',
  })
  batch_id: string;

  @ApiProperty({
    description: 'Product identifier for this task',
    example: 'PRD001',
  })
  product_id: string;

  @ApiProperty({
    description: 'Source inventory ID (if applicable)',
    example: 'INV001',
    nullable: true,
  })
  source_inventory_id?: string;

  @ApiProperty({
    description: 'Source station ID (if applicable)',
    example: 'ST001',
    nullable: true,
  })
  source_station_id?: string;

  @ApiProperty({
    description: 'Destination station ID (if applicable)',
    example: 'ST002',
    nullable: true,
  })
  destination_station_id?: string;

  @ApiProperty({
    description: 'Destination inventory ID (if applicable)',
    example: 'INV002',
    nullable: true,
  })
  destination_inventory_id?: string;

  @ApiProperty({
    description: 'Quantity to be moved in this task',
    example: 10,
  })
  quantity: number;

  @ApiProperty({
    description: 'Type of task',
    enum: TaskType,
    example: TaskType.INVENTORY_TO_STATION,
  })
  task_type: TaskType;

  @ApiProperty({
    description: 'Current status of the task',
    enum: TaskStatus,
    example: TaskStatus.PENDING,
  })
  status: TaskStatus;

  @ApiProperty({
    description: 'Order of execution within the batch',
    example: 1,
  })
  sequence_order: number;

  @ApiProperty({
    description: 'Timestamp when the task was created',
    example: '2024-01-15T10:30:00.000Z',
  })
  created_at: Date;

  @ApiProperty({
    description: 'Timestamp when the task was last updated',
    example: '2024-01-15T10:30:00.000Z',
  })
  updated_at: Date;
}
