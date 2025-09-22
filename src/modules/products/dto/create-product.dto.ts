import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

export class CreateProductDto {
  @ApiProperty({
    description: 'Unique identifier for the product',
    example: 'PRD001',
    maxLength: 10,
  })
  @IsString()
  @IsNotEmpty()
  product_id: string;

  @ApiProperty({
    description: 'Name of the product',
    example: 'Sample Product',
    maxLength: 255,
  })
  @IsString()
  @IsNotEmpty()
  product_name: string;
}
