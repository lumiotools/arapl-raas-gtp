import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Relation,
} from 'typeorm';
import { TaskType, type Task } from './task.entity';
import { BaseEntity } from './base.entity';

export enum BatchStatus {
  PENDING = 'PENDING',
  INQUEUE = 'INQUEUE',
  PROCESSING = 'PROCESSING',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  FAILED = 'FAILED',
  BATCH_ACKNOWLEDGED='BATCH_ACKNOWLEDGED',
  DISPATCHED='DISPATCHED',
  WAITING='WAITING',
  HALTED='HALTED',
  
}

@Entity('batches')
export class Batch extends BaseEntity {
  @PrimaryColumn({ type: 'varchar', length: 32 })
  batch_id: string;
  
  @Column({
    type: 'enum',
    enum: TaskType,
  })
  task_type: TaskType;

  @Column({ type: 'int', nullable: true })
  priority: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  description: string;

  @Column({
    type: 'enum',
    enum: BatchStatus,
    default: BatchStatus.PENDING,
  })
  status: BatchStatus;

  @Column({ type: 'int', default: 0 })
  total_tasks: number;

  @Column({ type: 'int', default: 0 })
  completed_tasks: number;

  @Column({ type: 'int', default: 0 })
  cancelled_tasks: number;

  // Relations
  @OneToMany('Task', 'batch')
  tasks: Relation<Task[]>;
}
