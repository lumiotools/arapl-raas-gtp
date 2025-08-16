import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsDateString, IsIn, IsArray, ValidateNested, IsNumber, IsObject } from 'class-validator';
import { Type } from 'class-transformer';

export class PaginationDto {
  @ApiProperty({ description: 'Current page', example: 1 })
  @IsNumber()
  current_page: number;

  @ApiProperty({ description: 'Total pages', example: 3 })
  @IsNumber()
  total_pages: number;

  @ApiProperty({ description: 'Total records', example: 12 })
  @IsNumber()
  total_records: number;
}

export class LocationDto {
  @ApiProperty({ description: 'Location ID', example: 'INV015' })
  @IsString()
  location_id: string;

  @ApiProperty({ description: 'Location type', example: 'Zone' })
  @IsString()
  location_type: string;

  @ApiProperty({ description: 'Location action', example: 'Pick' })
  @IsString()
  location_action: string;

  @ApiProperty({ 
    description: 'Location dimensions', 
    example: { length: 0, height: 0, width: 0 }
  })
  @IsObject()
  location_dimension: { length: number; height: number; width: number };

  @ApiProperty({ 
    description: 'Location attributes', 
    example: { attribute_name: 'location_type', attribute_value: 'inventory' }
  })
  @IsObject()
  location_attribute: { attribute_name: string; attribute_value: string };
}

export class CargoDto {
  @ApiProperty({ description: 'Cargo code', example: 'PRD015' })
  @IsString()
  cargo_code: string;

  @ApiProperty({ description: 'Cargo type', example: 'Pallet' })
  @IsString()
  cargo_type: string;

  @ApiProperty({ 
    description: 'Cargo dimensions', 
    example: { length: 0, width: 0, height: 0 }
  })
  @IsObject()
  cargo_dimension: { length: number; width: number; height: number };

  @ApiProperty({ description: 'Cargo attributes', example: null, nullable: true })
  @IsOptional()
  cargo_attributes?: any;

  @ApiProperty({ description: 'Cargo weight', example: 0 })
  @IsNumber()
  cargo_weight: number;
}

export class TaskStatusDto {
  @ApiProperty({ description: 'Task ID', example: '203' })
  @IsString()
  task_id: string;

  @ApiProperty({ 
    description: 'Task status', 
    enum: ['pending', 'assigned', 'inqueue', 'inprogress', 'processing', 'completed', 'cancelled', 'failed'],
    example: 'inqueue' 
  })
  @IsOptional()
  @IsIn(['pending', 'assigned', 'inqueue', 'inprogress', 'processing', 'completed', 'cancelled', 'failed'])
  status?: string;

  @ApiProperty({ description: 'Robot ID', example: 'ROBOT-001' })
  @IsString()
  robot_id: string;

  @ApiProperty({ description: 'Start location', type: LocationDto })
  @ValidateNested()
  @Type(() => LocationDto)
  start_location: LocationDto;

  @ApiProperty({ description: 'End location', type: LocationDto })
  @ValidateNested()
  @Type(() => LocationDto)
  end_location: LocationDto;

  @ApiProperty({ description: 'Array of cargos', type: [CargoDto] })
  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CargoDto)
  cargos?: CargoDto[];
}

export class WebhookRequestDto {
  @ApiProperty({ description: 'Pagination info', type: PaginationDto })
  @ValidateNested()
  @IsOptional()
  @Type(() => PaginationDto)
  pagination?: PaginationDto;

  @ApiProperty({ description: 'Batch job ID', example: 'B1545128788' })
  @IsString()
  batch_job_id: string;

  @ApiProperty({ description: 'Batch priority', example: 5 })
  @IsNumber()
  batch_priority: number;

  @ApiProperty({ 
    description: 'Batch job status', 
    enum: ['pending', 'inqueue', 'processing', 'completed', 'cancelled', 'failed','task_acknowledged','task_in_progress','robot_assigned','task_completed'],
    example: 'inqueue' 
  })
  @IsIn(['pending', 'inqueue', 'processing', 'completed', 'cancelled', 'failed','task_acknowledged','task_in_progress','robot_assigned','task_completed'])
  batch_job_status: string;

  @ApiProperty({ description: 'Timestamp', example: '2025-07-03T17:52:13.000Z' })
  @IsDateString()
  timestamp: string;

  @ApiProperty({ description: 'Array of task statuses', type: [TaskStatusDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TaskStatusDto)
  tasks: TaskStatusDto[];
}
