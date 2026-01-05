import { ApiProperty } from '@nestjs/swagger';

export class UploadTasksResponseDto {
  @ApiProperty({ example: 'B6566210101' })
  batch_id: string;
}

