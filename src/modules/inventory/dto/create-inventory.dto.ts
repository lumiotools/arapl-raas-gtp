import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsNumber, Min, IsOptional } from 'class-validator';
import { LocationStatus } from 'src/entities/station.entity';

export class CreateInventoryDto {
  @ApiProperty({
    description: 'Unique identifier for the inventory location',
    example: 'INV001',
    maxLength: 10,
  })
  @IsString()
  @IsNotEmpty()
  id: string;

  @ApiProperty({
    description: 'Product identifier for this inventory entry',
    example: 'PRD001',
    maxLength: 10,
  })
  @IsString()
  @IsNotEmpty()
  product_id: string;

  @ApiProperty({
    description: 'Quantity of the product in inventory',
    example: 100,
    minimum: 0,
  })
  @IsNumber()
  @Min(0)
  quantity: number;

  @ApiProperty({
    description: 'Defective quantity of the product in inventory',
    example: 5,
    minimum: 0,
  })
  @IsNumber()
  @Min(0)
  defective_quantity: number;

  @ApiProperty({
    description: 'Missing quantity of the product in inventory',
    example: 2,
    minimum: 0,
  })
  @IsNumber()
  @Min(0)
  missing_quantity: number;

  @ApiProperty({
    description: 'Barcode number associated with the inventory item',
    example: '1234567890123',
    maxLength: 20,
  })
  @IsString()
  @IsNotEmpty()
  barcode_number: string;

  @ApiProperty({
    description: 'Indicates if the inventory item is currently being processed',
    example: true,
  })
  @IsNotEmpty()
  isProcessing: boolean;

  @ApiProperty({
    description: 'Indicates if the inventory item is currently active',
    example: true,
  })
  @IsOptional()
  is_active?: boolean;

  @ApiProperty({
    description: 'Indicates if the inventory item is currently empty',
    example: true,
  })
  @IsOptional()
  is_empty?: boolean;

  @ApiProperty({
    description: 'Current status of the inventory location',
    example: 'AVAILABLE',
  })
  @IsOptional()
  status?: LocationStatus;
}
