import { ApiProperty } from '@nestjs/swagger';

export class WMSBatchJobTaskCargoDto {
  @ApiProperty({
    example: 'PRD001',
    description: 'Cargo identifier code',
  })
  cargo_code: string;
}

