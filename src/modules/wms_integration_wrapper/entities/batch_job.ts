import { WMSBatchJobTask } from "./batch_job_task";
import { IsArray, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export enum WMSBatchJobStatus {
    TASK_ACKNOWLEDGED = 'task_acknowledged',
    ROBOT_ASSIGNED = 'robot_assigned',
    TASK_IN_PROGRESS = 'task_in_progress',
    TASK_CANCELLED = 'task_cancelled',
    TASK_COMPLETED = 'task_completed',
}

export class WMSBatchJob {
    @IsOptional()
    @IsString()
    batch_job_id?: string;

    @IsOptional()
    @IsString()
    batch_job_status?: WMSBatchJobStatus;

    @IsOptional()
    @IsNumber()
    batch_priority?: number;

    @IsOptional()
    @IsString()
    batch_type?: string;

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => WMSBatchJobTask)
    tasks: WMSBatchJobTask[];
}