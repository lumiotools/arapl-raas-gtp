import { IsEnum, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type, Transform } from 'class-transformer';

export enum WMSBatchJobTaskLocationType {
  PALLET = 'PALLET',
  ZONE = 'ZONE',
}

export enum WMSBatchJobTaskLocationAction {
  PICK = 'PICK',
  DROP = 'DROP',
}

class WMSBatchJobTaskLocationDimensions {
  @Type(() => Number)
  @IsNumber()
  length: number;

  @Type(() => Number)
  @IsNumber()
  width: number;

  @Type(() => Number)
  @IsNumber()
  height: number;
}

export class WMSBatchJobTaskLocation {
  @IsString()
  location_id: string;

  @IsEnum(WMSBatchJobTaskLocationType)
  location_type: WMSBatchJobTaskLocationType;

  @IsEnum(WMSBatchJobTaskLocationAction)
  location_action: WMSBatchJobTaskLocationAction;

  @IsOptional()
  @ValidateNested()
  @Type(() => WMSBatchJobTaskLocationDimensions)
  location_dimension?: WMSBatchJobTaskLocationDimensions;
}