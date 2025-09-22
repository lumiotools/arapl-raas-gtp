import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsBoolean, IsOptional, IsEnum } from 'class-validator';
import { GtpLocationStatus } from 'src/entities/gtp-location.entity';

export class CreateGtpDto {
  @ApiProperty({
    description: 'Unique identifier for the GTP location',
    example: 'GTP001',
    maxLength: 10,
  })
  @IsString()
  @IsNotEmpty()
  gtp_location_id: string;

  @ApiProperty({
    description: 'Station identifier that this GTP location belongs to',
    example: 'ST001',
    maxLength: 10,
    required: false,
  })
  @IsString()
  @IsOptional()
  station_id?: string;

  @ApiProperty({
    description: 'Whether the GTP location is active',
    example: true,
    default: true,
  })
  @IsBoolean()
  @IsOptional()
  is_active?: boolean;

  @ApiProperty({
    description: 'Current status of the GTP location',
    enum: GtpLocationStatus,
    example: GtpLocationStatus.AVAILABLE,
    default: GtpLocationStatus.AVAILABLE,
  })
  @IsEnum(GtpLocationStatus)
  @IsOptional()
  status?: GtpLocationStatus;
}
