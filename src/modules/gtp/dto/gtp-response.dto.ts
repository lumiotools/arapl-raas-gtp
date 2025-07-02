import { ApiProperty } from '@nestjs/swagger';
import { GtpLocationStatus } from 'src/entities/gtp-location.entity';

export class GtpLocationResponseDto {
  @ApiProperty({
    description: 'Unique identifier for the GTP location',
    example: 'GTP001',
  })
  gtp_location_id: string;

  @ApiProperty({
    description: 'Station identifier that this GTP location belongs to',
    example: 'ST001',
    nullable: true,
  })
  station_id: string | null;

  @ApiProperty({
    description: 'Whether the GTP location is active',
    example: true,
  })
  is_active: boolean;

  @ApiProperty({
    description: 'Current status of the GTP location',
    enum: GtpLocationStatus,
    example: GtpLocationStatus.AVAILABLE,
  })
  status: GtpLocationStatus;

  @ApiProperty({
    description: 'Timestamp when the GTP location was created',
    example: '2024-01-15T10:30:00.000Z',
  })
  created_at: Date;

  @ApiProperty({
    description: 'Timestamp when the GTP location was last updated',
    example: '2024-01-15T10:30:00.000Z',
  })
  updated_at: Date;
}
