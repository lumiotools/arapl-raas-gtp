import { ApiProperty } from '@nestjs/swagger';
import { GtpLocationResponseDto } from '../../gtp/dto/gtp-response.dto';

export class StationResponseDto {
  @ApiProperty({ example: '2025-12-11T10:27:36.314Z' })
  created_at: string;

  @ApiProperty({ example: '2025-12-19T06:36:29.880Z' })
  updated_at: string;

  @ApiProperty({ example: 'ST001' })
  station_id: string;

  @ApiProperty({ example: 'Station 1' })
  location_name: string;

  @ApiProperty({ example: 'OCCUPIED' })
  status: string;

  @ApiProperty({ example: 1 })
  priority: number;

  @ApiProperty({ example: true })
  is_active: boolean;

  @ApiProperty({
    example: '77c24cf1-0fe4-4a1b-ba8f-e049b9ba2206',
    nullable: true,
  })
  holded_by: string | null;

  @ApiProperty({ type: [GtpLocationResponseDto] })
  gtpLocations: GtpLocationResponseDto[];
}
