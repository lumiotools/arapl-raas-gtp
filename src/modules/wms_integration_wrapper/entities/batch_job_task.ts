import { WMSBatchJobCargo } from "./batch_job_task_cargo";
import { WMSBatchJobTaskLocation } from "./batch_job_task_location";
import { IsArray, IsEnum, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export enum WMSBatchJobTaskType {
  CROSSDOCK = 'CROSSDOCK',
}

export enum WMSBatchJobTaskStatus {
    TASK_ACKNOWLEDGED = 'task_acknowledged',
    ROBOT_ASSIGNED = 'robot_assigned',
    PICKUP_SUCCESSFUL = 'pickup_successful',
    DROP_SUCCESSFUL = 'drop_successful',
    TASK_CANCELLED = 'task_cancelled',
    TASK_COMPLETED = 'task_completed',
}

export class WMSBatchJobTask {
  @IsString()
  task_id: string;

  @IsEnum(WMSBatchJobTaskType)
  task_type: WMSBatchJobTaskType;

  @IsOptional()
  @IsEnum(WMSBatchJobTaskStatus)
  status?: WMSBatchJobTaskStatus;

  @ValidateNested()
  @Type(() => WMSBatchJobTaskLocation)
  start_location: WMSBatchJobTaskLocation;

  @ValidateNested()
  @Type(() => WMSBatchJobTaskLocation)
  end_location: WMSBatchJobTaskLocation;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WMSBatchJobCargo)
  cargos: WMSBatchJobCargo[];
}