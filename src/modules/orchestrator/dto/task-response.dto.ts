import { ApiProperty } from '@nestjs/swagger';
import { TaskType, TaskStatus } from 'src/entities/task.entity';
import { LocationResponseDto } from './location-response.dto';
import { WaitResponseDto } from './wait-response.dto';
import { CargoResponseDto } from './cargo-response.dto';

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
    description: 'Starting location for this task',
    type: LocationResponseDto,
  })
  start_location: LocationResponseDto;

  @ApiProperty({
    description: 'Ending location for this task',
    type: LocationResponseDto,
  })
  end_location: LocationResponseDto;

  @ApiProperty({
    description: 'Wait configuration for this task',
    type: WaitResponseDto,
  })
  wait: WaitResponseDto;

  @ApiProperty({
    description: 'Quantity to be moved in this task',
    example: 10,
  })
  quantity: number;

  @ApiProperty({
    description: 'Type of task',
    enum: TaskType,
    example: TaskType.GOODS_TO_PERSON,
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
    description: 'Array of cargo objects for this task',
    type: [CargoResponseDto],
  })
  cargos: CargoResponseDto[];

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
