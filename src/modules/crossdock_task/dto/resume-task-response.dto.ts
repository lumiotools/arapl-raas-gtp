import { ApiProperty } from '@nestjs/swagger';

export class ResumeTaskResponseDto {
  @ApiProperty({ example: 'ae46809c-1802-401f-9f0f-377632bdc758' })
  task_id: string;

  @ApiProperty({ example: 'resumed' })
  status: string;

  @ApiProperty({ example: 'Task resumed successfully' })
  message: string;
}

