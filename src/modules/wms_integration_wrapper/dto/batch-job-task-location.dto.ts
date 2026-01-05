import { ApiProperty } from '@nestjs/swagger';
import { WMSBatchJobTaskLocationType, WMSBatchJobTaskLocationAction } from '../entities/batch_job_task_location';

export class WMSBatchJobTaskLocationDimensionsDto {
  @ApiProperty({ example: 1, description: 'Length of the location' })
  length: number;

  @ApiProperty({ example: 1, description: 'Width of the location' })
  width: number;

  @ApiProperty({ example: 1, description: 'Height of the location' })
  height: number;
}

export class WMSBatchJobTaskLocationDto {
  @ApiProperty({ example: 'ap1517', description: 'Location identifier' })
  location_id: string;

  @ApiProperty({
    enum: WMSBatchJobTaskLocationType,
    example: WMSBatchJobTaskLocationType.PALLET,
    description: 'Type of location (PALLET or ZONE)',
  })
  location_type: WMSBatchJobTaskLocationType;

  @ApiProperty({
    enum: WMSBatchJobTaskLocationAction,
    example: WMSBatchJobTaskLocationAction.PICK,
    description: 'Action to perform at this location (PICK or DROP)',
  })
  location_action: WMSBatchJobTaskLocationAction;

  @ApiProperty({
    type: WMSBatchJobTaskLocationDimensionsDto,
    required: false,
    description: 'Dimensions of the location',
    example: { length: 1, width: 1, height: 1 },
  })
  location_dimension?: WMSBatchJobTaskLocationDimensionsDto;
}

