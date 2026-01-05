import { ApiProperty } from '@nestjs/swagger';

export class CreateBatchJobResponseDto {
  @ApiProperty({
    example: 'B6566210101',
    description: 'Unique identifier of the created batch job',
  })
  batch_job_id: string;

  @ApiProperty({
    example: 'Batch job created successfully',
    description: 'Status message',
  })
  status: string;
}

