import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { LocationStatus } from 'src/entities/station.entity';

export class UpdateLocationDto {
  @IsString()
  @IsOptional()
  @MaxLength(100)
  display_name?: string;

  @IsInt()
  @IsOptional()
  @Min(0)
  pick_priority?: number;

  @IsInt()
  @IsOptional()
  @Min(0)
  drop_priority?: number;

  @IsEnum(LocationStatus)
  @IsOptional()
  location_status?: LocationStatus;

  @IsOptional()
  @IsBoolean()
  is_waiting_area?: boolean;
}
 
