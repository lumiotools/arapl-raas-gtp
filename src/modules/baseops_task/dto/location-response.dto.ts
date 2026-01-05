import { ApiProperty } from '@nestjs/swagger';

export class LocationDimensionDto {
  @ApiProperty({ example: 1 })
  length: number;

  @ApiProperty({ example: 1 })
  width: number;

  @ApiProperty({ example: 1 })
  height: number;
}

export class LocationAttributeDto {
  @ApiProperty({ example: 'Pallet' })
  attribute_name: string;

  @ApiProperty({ example: 'ap1517' })
  attribute_value: string;

  @ApiProperty({ nullable: true, example: '9b27d4c3-2e5f-4a91-8c3e-7f04dbe61b2a' })
  attribute_zone_pair_id?: string | null;
}

export class LocationDto {
  @ApiProperty({ example: 'ap1517' })
  location_id: string;

  @ApiProperty({ example: 'PALLET' })
  location_type: string;

  @ApiProperty({ example: 'PICK' })
  location_action: string;

  @ApiProperty({ type: LocationDimensionDto })
  location_dimension: LocationDimensionDto;

  @ApiProperty({ type: LocationAttributeDto })
  location_attribute: LocationAttributeDto;

  @ApiProperty({ example: '182', nullable: true })
  display_name?: string;
}

export class LocationEntityResponseDto {
  @ApiProperty({ example: 'ap1588' })
  location_id: string;

  @ApiProperty({ example: 'ap1588' })
  display_name: string;

  @ApiProperty({ nullable: true, example: 'dropping' })
  parent_id: string | null;

  @ApiProperty({ enum: ['PALLET'], example: 'PALLET' })
  location_type: string;

  @ApiProperty({ nullable: true, example: 5 })
  row: number | null;

  @ApiProperty({ nullable: true, example: 5 })
  column: number | null;

  @ApiProperty({ nullable: true, example: 1 })
  pick_priority: number | null;

  @ApiProperty({ nullable: true, example: 5 })
  drop_priority: number | null;

  @ApiProperty({ nullable: true, example: null })
  dependent_location: string | null;

  @ApiProperty({ example: 'AVAILABLE' })
  location_status: string;

  @ApiProperty({ type: 'string', format: 'date-time', example: '2025-11-20T07:00:17.400Z' })
  created_at: string;

  @ApiProperty({ type: 'string', format: 'date-time', example: '2025-11-20T07:00:17.400Z' })
  updated_at: string;

  @ApiProperty({
    type: 'object',
    nullable: true,
    additionalProperties: true,
    description: 'Parent location object with same structure as LocationEntityResponseDto',
    example: {
      location_id: 'dropping',
      display_name: 'dropping',
      parent_id: null,
      location_type: 'Zone',
      row: null,
      column: null,
      pick_priority: null,
      drop_priority: null,
      dependent_location: null,
      location_status: 'AVAILABLE',
      created_at: '2025-11-20T07:00:17.306Z',
      updated_at: '2025-11-20T07:00:17.306Z',
      attributes: null,
    },
  })
  parent?: {
    location_id: string;
    display_name: string;
    parent_id: string | null;
    location_type: string;
    row: number | null;
    column: number | null;
    pick_priority: number | null;
    drop_priority: number | null;
    dependent_location: string | null;
    location_status: string;
    created_at: string;
    updated_at: string;
    attributes: any[] | null;
  } | null;
}

