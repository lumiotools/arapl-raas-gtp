import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { TaskType } from './task.entity';
import { BaseEntity } from './base.entity';

export interface RobotLogs{
    timestamp: Date;
    previous_status: RobotStatus;
    new_status: RobotStatus;
    reason?: string | null;
}

export enum RobotStatus{
    ONLINE = "online",
    MAINTENANCE = "maintenance",
    CHARGING = "charging",
    ERROR = "error",
    INUSE = "in_use",
    OTHER = 'other'
}
@Entity('robots')
export class Robot extends BaseEntity {
    @PrimaryColumn({ type: 'varchar', length: 50 })
    robot_id: string;

    @Column({ type: 'enum', enum: RobotStatus, default: RobotStatus.ONLINE })
    status: RobotStatus;

    @Column({ type: 'enum', enum : TaskType, default: TaskType.GOODS_TO_PERSON })
    task_type: TaskType;

    @Column({ type: 'json', nullable: true })
    logs: RobotLogs[];

    @Column({ type: 'varchar', length: 100, nullable: true })
    message_code: string | null;
}