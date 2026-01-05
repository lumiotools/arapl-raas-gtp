import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsNumber, IsString, IsEnum, IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export enum PriorityEnum {
  HIGH = 'HIGH',
  MEDIUM = 'MEDIUM',
  LOW = 'LOW',
}

export enum LocationTypeEnum {
  PALLET = 'PALLET',
  ZONE = 'ZONE',
}

export class TaskItemDto {
  @ApiProperty({
    description: 'Start location ID (must be a PALLET location)',
    example: 'R10X02',
  })
  @IsString()
  start_location_location_id: string;

  @ApiProperty({
    description: 'Start location type (must be PALLET)',
    enum: LocationTypeEnum,
    example: LocationTypeEnum.PALLET,
  })
  @IsEnum(LocationTypeEnum)
  start_location_location_type: LocationTypeEnum;

  @ApiProperty({
    description: 'End location ID',
    example: 'R20X01',
  })
  @IsString()
  end_location_location_id: string;

  @ApiProperty({
    description: 'End location type (must be PALLET or ZONE)',
    enum: LocationTypeEnum,
    example: LocationTypeEnum.PALLET,
  })
  @IsEnum(LocationTypeEnum)
  end_location_location_type: LocationTypeEnum;

  @ApiProperty({
    description: 'Task priority (HIGH, MEDIUM, or LOW)',
    enum: PriorityEnum,
    example: PriorityEnum.HIGH,
  })
  @IsEnum(PriorityEnum)
  priority: PriorityEnum;

  @ApiProperty({
    description: 'WMS task ID (optional)',
    example: 'WMS-TASK-12345',
    required: false,
  })
  @IsOptional()
  @IsString()
  wms_task_id?: string;
}

export class UploadTasksDto {
  @ApiProperty({
    description: 'Array of tasks to be processed',
    type: [TaskItemDto],
    example: [
      {
        start_location_location_id: 'R10X02',
        start_location_location_type: 'PALLET',
        end_location_location_id: 'R20X01',
        end_location_location_type: 'PALLET',
        priority: 'HIGH',
        wms_task_id: 'WMS-TASK-12345',
      },
    ],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TaskItemDto)
  tasks: TaskItemDto[];

  @ApiProperty({
    description: 'Batch priority (1 = HIGH, 2 = MEDIUM, 3 = LOW)',
    example: 1,
    minimum: 1,
    maximum: 3,
  })
  @IsNumber()
  priority: number;
}

