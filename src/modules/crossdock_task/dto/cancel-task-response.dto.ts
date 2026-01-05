import { ApiProperty } from '@nestjs/swagger';

export class CancelTaskResponseDto {
  @ApiProperty({ example: 'c95332ff-322d-4262-85b3-283ff9bc4a75' })
  task_id: string;

  @ApiProperty({ example: 'CANCELLED' })
  status: string;
}

