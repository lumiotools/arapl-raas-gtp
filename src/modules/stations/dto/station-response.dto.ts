import { ApiProperty } from '@nestjs/swagger';

export class StationResponseDto {
  @ApiProperty({
    description: 'Unique identifier for the station',
    example: 'ST001',
  })
  station_id: string;

  @ApiProperty({
    description: 'Name of the station',
    example: 'Main Station',
  })
  station_name: string;

  @ApiProperty({
    description: 'Priority level of the station',
    example: 1,
  })
  priority: number;

  @ApiProperty({
    description: 'Whether the station is active',
    example: true,
  })
  is_active: boolean;

  @ApiProperty({
    description: 'Timestamp when the station was created',
    example: '2024-01-15T10:30:00.000Z',
  })
  created_at: Date;

  @ApiProperty({
    description: 'Timestamp when the station was last updated',
    example: '2024-01-15T10:30:00.000Z',
  })
  updated_at: Date;
}
