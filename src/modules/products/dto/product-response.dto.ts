import { ApiProperty } from '@nestjs/swagger';

export class ProductResponseDto {
  @ApiProperty({
    description: 'Unique identifier for the product',
    example: 'PRD001',
  })
  product_id: string;

  @ApiProperty({
    description: 'Name of the product',
    example: 'Sample Product',
  })
  product_name: string;

  @ApiProperty({
    description: 'Timestamp when the product was created',
    example: '2024-01-15T10:30:00.000Z',
  })
  created_at: Date;

  @ApiProperty({
    description: 'Timestamp when the product was last updated',
    example: '2024-01-15T10:30:00.000Z',
  })
  updated_at: Date;
}
