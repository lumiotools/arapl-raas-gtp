import { ApiProperty } from '@nestjs/swagger';
import { WaitStatus, FallbackAction } from 'src/entities/wait.entity';

export class WaitResponseDto {
  @ApiProperty({
    description: 'Type of the waiting',
    example: 'Trigger',
  })
  wait_type: string;

  @ApiProperty({
    description: 'The condition for waiting',
    example: null,
    nullable: true,
    required: false,
  })
  wait_condition?: string | null;

  @ApiProperty({
    description: 'Required waiting time at the start location',
    example: 0,
    required: false,
  })
  start_location_wait_time?: number;

  @ApiProperty({
    description: 'Required waiting time at the end location',
    example: 0,
    required: false,
  })
  end_location_wait_time?: number;

  @ApiProperty({
    description: 'If location is empty, should the wait be performed until the location is occupied for pickup',
    example: false,
    required: false,
  })
  start_location_available_wait?: boolean;

  @ApiProperty({
    description: 'If location is occupied, should the wait be performed until the location is empty for drop',
    example: false,
    required: false,
  })
  end_location_available_wait?: boolean;

  @ApiProperty({
    description: 'Current status of the wait',
    enum: WaitStatus,
    example: WaitStatus.NOT_STARTED,
    required: false,
  })
  wait_status?: string;

  @ApiProperty({
    description: 'Maximum number of seconds the wait should be performed (default: 1800 = 30 minutes)',
    example: 1800,
    required: false,
  })
  timeout?: number;

  @ApiProperty({
    description: 'Action to perform in case of wait timeout',
    enum: FallbackAction,
    example: FallbackAction.ERROR,
    required: false,
  })
  fallback_action?: string;
}
