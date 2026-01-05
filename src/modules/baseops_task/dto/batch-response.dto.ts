import { ApiProperty } from '@nestjs/swagger';

export class BatchResponseDto {
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

  @ApiProperty({ example: 'COMPLETED' })
  status: string;

  @ApiProperty({ example: 2 })
  total_tasks: number;

  @ApiProperty({ example: 2 })
  completed_tasks: number;

  @ApiProperty({ example: 0 })
  cancelled_tasks: number;

  @ApiProperty({ nullable: true, example: null })
  alert?: string | null;
}

