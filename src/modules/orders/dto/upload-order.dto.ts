import {
  IsString,
  IsNumber,
  IsNotEmpty,
  IsOptional,
  IsArray,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UploadOrderItemDto {
  @ApiProperty({
    description: 'Unique identifier for the order',
    example: 'ORD001',
  })
  @IsString()
  @IsNotEmpty()
  'Order ID': string;

  @ApiProperty({
    description: 'Product identifier',
    example: 'PRD001',
  })
  @IsString()
  @IsNotEmpty()
  'Product Id': string;

  @ApiProperty({
    description: 'Quantity of the product',
    example: 10,
  })
  @IsNumber()
  @IsNotEmpty()
  'Qty': number;

  @ApiProperty({
    description: 'License plate identifier',
    example: 'LP001',
  })
  @IsString()
  @IsNotEmpty()
  'License Plate ID': string;
}

export class ProcessedOrderItemDto {
  @ApiProperty({
    description: 'Order identifier',
    example: 'ORD001',
  })
  orderId: string;

  @ApiProperty({
    description: 'Product identifier',
    example: 'PRD001',
  })
  productId: string;

  @ApiProperty({
    description: 'Quantity of the product',
    example: 10,
  })
  quantity: number;

  @ApiProperty({
    description: 'License plate identifier',
    example: 'LP001',
  })
  licensePlateId: string;
}

export class UploadResponseDto {
  @ApiProperty({
    description: 'Whether the upload was successful',
    example: true,
  })
  success: boolean;

  @ApiProperty({
    description: 'Response message describing the result',
    example: 'Successfully processed 24 orders and 28 items',
  })
  message: string;

  @ApiProperty({
    description: 'Number of orders processed',
    example: 24,
  })
  processedOrders: number;

  @ApiProperty({
    description: 'Number of order items processed',
    example: 28,
  })
  processedItems: number;

  @ApiProperty({
    description: 'Array of error messages if any occurred',
    example: ['Product PRD999 not found for order ORD025'],
    required: false,
  })
  @IsOptional()
  @IsArray()
  errors?: string[];
}
