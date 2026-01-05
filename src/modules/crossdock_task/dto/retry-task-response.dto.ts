import { ApiProperty } from '@nestjs/swagger';

export class RetryTaskResponseDto {
  @ApiProperty({ example: 'ae46809c-1802-401f-9f0f-377632bdc758' })
  task_id: string;

  @ApiProperty({ example: 'retry_task_created' })
  status: string;

  @ApiProperty({ example: 'Retry task created successfully' })
  message: string;
}

