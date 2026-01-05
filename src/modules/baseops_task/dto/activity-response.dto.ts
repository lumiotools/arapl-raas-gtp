import { ApiProperty } from '@nestjs/swagger';
import { LocationDto } from './location-response.dto';

export class MovementActivityDto {
  @ApiProperty({ example: '81134147-4221-423a-bd5c-dbb13c0ade05' })
  activity_id: string;

  @ApiProperty({ example: '577' })
  display_activity_id: string;

  @ApiProperty({ enum: ['MOVEMENT'], example: 'MOVEMENT' })
  activity_type: 'MOVEMENT';

  @ApiProperty({ example: 'COMPLETED' })
  status: string;

  @ApiProperty({ example: 'ZoneToWait' })
  move_type: string;

  @ApiProperty({ nullable: true, example: 'ROBOT-003' })
  robot_id: string | null;

  @ApiProperty({ nullable: true, example: 'ROBOT-003' })
  robot_name: string | null;

  @ApiProperty({ type: 'string', format: 'date-time', nullable: true, example: null })
  start_time: string | null;

  @ApiProperty({ type: 'string', format: 'date-time', nullable: true, example: null })
  end_time: string | null;

  @ApiProperty({ nullable: true, example: null })
  cargos: any[] | null;

  @ApiProperty({ type: LocationDto })
  start_location: LocationDto;

  @ApiProperty({ type: LocationDto })
  end_location: LocationDto;
}

export class WaitingActivityDto {
  @ApiProperty({ example: 'WAIT-81134147-4221-423a-bd5c-dbb13c0ade05' })
  activity_id: string;

  @ApiProperty({ example: 'w577' })
  display_activity_id: string;

  @ApiProperty({ enum: ['WAITING'], example: 'WAITING' })
  activity_type: 'WAITING';

  @ApiProperty({ example: 'COMPLETED' })
  status: string;

  @ApiProperty({ nullable: true, example: 'Waiting for location L11 to be available' })
  activity_reason: string | null;

  @ApiProperty({ example: '-' })
  robot_id: string;

  @ApiProperty({ type: 'string', format: 'date-time', nullable: true, example: null })
  created_at: string | null;

  @ApiProperty({ type: 'string', format: 'date-time', nullable: true, example: null })
  updated_at: string | null;

  @ApiProperty({ type: 'string', format: 'date-time', nullable: true, example: null })
  inqueue: string | null;

  @ApiProperty({ type: 'string', format: 'date-time', nullable: true, example: null })
  processing: string | null;

  @ApiProperty({ type: 'string', format: 'date-time', nullable: true, example: null })
  completed: string | null;

  @ApiProperty({ type: 'string', format: 'date-time', nullable: true, example: null })
  triggered: string | null;

  @ApiProperty({ type: LocationDto })
  start_location: LocationDto;

  @ApiProperty({ type: LocationDto })
  end_location: LocationDto;
}

