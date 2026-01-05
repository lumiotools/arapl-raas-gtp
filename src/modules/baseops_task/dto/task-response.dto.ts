import { ApiProperty } from '@nestjs/swagger';
import { LocationDto } from './location-response.dto';

export class BatchInfoDto {
  @ApiProperty({ type: 'string', format: 'date-time', nullable: true, example: null })
  created_at: string | null;

  @ApiProperty({ type: 'string', format: 'date-time', nullable: true, example: null })
  updated_at: string | null;

  @ApiProperty({ example: 'BO_19122025_4' })
  batch_id: string;

  @ApiProperty({ nullable: true, example: null })
  wms_batch_id: string | null;

  @ApiProperty({ example: 'BASEOPS' })
  task_type: string;

  @ApiProperty({ example: 3 })
  priority: number;

  @ApiProperty({ example: 'BASEOPS Batch' })
  description: string;

  @ApiProperty({ example: 'COMPLETED' })
  status: string;

  @ApiProperty({ example: 2 })
  total_tasks: number;

  @ApiProperty({ example: 2 })
  completed_tasks: number;

  @ApiProperty({ example: 0 })
  cancelled_tasks: number;

  @ApiProperty({ nullable: true, example: null })
  dependency: string | null;
}

export class TaskResponseDto {
  @ApiProperty({ type: 'string', format: 'date-time', nullable: true, example: null })
  created_at: string | null;

  @ApiProperty({ type: 'string', format: 'date-time', nullable: true, example: null })
  updated_at: string | null;

  @ApiProperty({ example: '81134147-4221-423a-bd5c-dbb13c0ade05' })
  task_id: string;

  @ApiProperty({ example: '577' })
  display_task_id: string;

  @ApiProperty({ example: 'BO_19122025_4' })
  batch_id: string;

  @ApiProperty({ nullable: true, example: 'Batch-2025121913233560' })
  fms_batch_id: string | null;

  @ApiProperty({ nullable: true, example: null })
  wms_task_id: string | null;

  @ApiProperty({ nullable: true, example: null })
  origin_location: string | null;

  @ApiProperty({ example: 2 })
  priority: number;

  @ApiProperty({ example: 'BASEOPS' })
  task_type: string;

  @ApiProperty({ example: 'COMPLETED' })
  status: string;

  @ApiProperty({ example: 'ZoneToWait' })
  move_type: string;

  @ApiProperty({ example: 1 })
  sequence_order: number;

  @ApiProperty({ nullable: true, example: null })
  task_dependency: string | null;

  @ApiProperty({ nullable: true, example: 'ROBOT-003' })
  robot_id: string | null;

  @ApiProperty({ type: BatchInfoDto })
  batch: BatchInfoDto;

  @ApiProperty({ type: LocationDto })
  start_location: LocationDto;

  @ApiProperty({ type: LocationDto })
  end_location: LocationDto;

  @ApiProperty({ nullable: true, example: null })
  wait: any | null;

  @ApiProperty({ nullable: true, example: null })
  cargos: any[] | null;

  @ApiProperty({ nullable: true, example: null })
  pause_resume_logs: any[] | null;

  @ApiProperty({ type: 'string', format: 'date-time', nullable: true, example: null })
  task_acknowledged: string | null;

  @ApiProperty({ type: 'string', format: 'date-time', nullable: true, example: null })
  inqueue: string | null;

  @ApiProperty({ type: 'string', format: 'date-time', nullable: true, example: null })
  processing: string | null;

  @ApiProperty({ type: 'string', format: 'date-time', nullable: true, example: null })
  in_progress: string | null;

  @ApiProperty({ type: 'string', format: 'date-time', nullable: true, example: null })
  completed: string | null;

  @ApiProperty({ type: 'string', format: 'date-time', nullable: true, example: null })
  triggered: string | null;

  @ApiProperty({ nullable: true, example: null })
  message: string | null;

  @ApiProperty({ example: false })
  is_gtp_cancelled: boolean;

  @ApiProperty({ example: false })
  is_paused: boolean;

  @ApiProperty({ type: 'string', format: 'date-time', nullable: true, example: null })
  start_time: string | null;

  @ApiProperty({ type: 'string', format: 'date-time', nullable: true, example: null })
  end_time: string | null;

  @ApiProperty({ type: LocationDto, nullable: true })
  final_end_location: LocationDto | null;
}

