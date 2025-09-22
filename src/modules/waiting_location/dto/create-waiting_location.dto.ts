import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsNumber, IsBoolean, IsOptional, IsArray, ArrayNotEmpty } from 'class-validator';
import { WaitingLocationType } from '../../../entities/waiting-location.entity';
export class CreateWaitingLocationDto {
  @ApiProperty({
    description: 'Unique identifier for the waiting location',
    example: 'ST001',
    maxLength: 10,
  })
  @IsString()
  @IsNotEmpty()
  location_id: string;

  @ApiProperty({
    description: 'Name of the waiting location',
    example: 'Main waiting location',
    maxLength: 100,
  })
  @IsString()
  @IsNotEmpty()
  location_name: string;

  @ApiProperty({
    description: 'type of the waiting location',
    example: 'STATION_TO_STATION',
  })
    @IsString()
    @IsNotEmpty()
    type: WaitingLocationType;

  @ApiProperty({
    description: 'Whether the waiting location is active',
    example: true,
    default: true,
  })
  @IsBoolean()
  @IsOptional()
  is_active?: boolean;

}
