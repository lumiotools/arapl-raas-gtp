import { ApiProperty } from '@nestjs/swagger';
import { LocationType, LocationAction, LocationDimension, LocationAttribute } from 'src/entities/location.entity';

export class LocationResponseDto {
  @ApiProperty({
    description: 'Location identifier (station_id or inventory_id)',
    example: 'ST001',
  })
  location_id: string;

  @ApiProperty({
    description: 'Type of location',
    enum: LocationType,
    example: LocationType.ZONE,
  })
  location_type: LocationType;

  @ApiProperty({
    description: 'Action to be performed at this location',
    enum: LocationAction,
    example: LocationAction.PICK,
  })
  location_action: LocationAction;

  @ApiProperty({
    description: 'Dimensions of the location',
    example: { length: 0, height: 0, width: 0 },
  })
  location_dimension: LocationDimension;

  @ApiProperty({
    description: 'Attributes of the location',
    example: { attribute_name: 'station' },
  })
  location_attribute: LocationAttribute;
}
