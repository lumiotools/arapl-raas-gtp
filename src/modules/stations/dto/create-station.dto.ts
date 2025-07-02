import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsNumber, IsBoolean, IsOptional, IsArray, ArrayNotEmpty } from 'class-validator';

export class CreateStationDto {
  @ApiProperty({
    description: 'Unique identifier for the station',
    example: 'ST001',
    maxLength: 10,
  })
  @IsString()
  @IsNotEmpty()
  station_id: string;

  @ApiProperty({
    description: 'Name of the station',
    example: 'Main Station',
    maxLength: 100,
  })
  @IsString()
  @IsNotEmpty()
  station_name: string;

  @ApiProperty({
    description: 'Priority level of the station',
    example: 1,
    minimum: 1,
  })
  @IsNumber()
  priority: number;

  @ApiProperty({
    description: 'Whether the station is active',
    example: true,
    default: true,
  })
  @IsBoolean()
  @IsOptional()
  is_active?: boolean;

  @ApiProperty({
    description: 'Array of GTP location IDs associated with this station',
    example: ['GTP001', 'GTP002'],
    type: [String],
    required: false,
  })
  @IsArray()
  @IsOptional()
  @IsString({ each: true })
  gtp_locations_array?: string[];
}
