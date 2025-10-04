import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { TaskType } from './task.entity';

@Entity('robots')
export class Robot {
    @PrimaryColumn({ type: 'varchar', length: 50 })
    robot_id: string;

    @Column({ type: 'boolean', default: false })
    in_use: boolean;

    @Column({ type: 'enum', enum : TaskType, default: TaskType.GOODS_TO_PERSON })
    task_type: TaskType;

    @Column({ type: 'boolean', default: true})
    is_active: boolean;

    @Column({ type: 'varchar', length: 100, nullable: true })
    message_code: 'maintenance' | 'charging' | 'error' | null;

    @CreateDateColumn()
    created_at: Date;

    @UpdateDateColumn()
    updated_at: Date;
}