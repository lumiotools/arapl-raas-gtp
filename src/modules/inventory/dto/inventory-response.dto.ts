import { ApiProperty } from '@nestjs/swagger';

export class InventoryResponseDto {
  @ApiProperty({
    description: 'Unique identifier for the inventory location',
    example: 'INV001',
  })
  id: string;

  @ApiProperty({
    description: 'Product identifier for this inventory entry',
    example: 'PRD001',
  })
  product_id: string;

  @ApiProperty({
    description: 'Quantity of the product in inventory',
    example: 100,
  })
  quantity: number;

  @ApiProperty({
    description: 'Timestamp when the inventory entry was created',
    example: '2024-01-15T10:30:00.000Z',
  })
  created_at: Date;

  @ApiProperty({
    description: 'Timestamp when the inventory entry was last updated',
    example: '2024-01-15T10:30:00.000Z',
  })
  updated_at: Date;
}
