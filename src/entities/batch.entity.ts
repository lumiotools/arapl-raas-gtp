import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Relation,
} from 'typeorm';
import type { Task } from './task.entity';

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
  
}

@Entity('batches')
export class Batch {
  @PrimaryColumn({ type: 'varchar', length: 32 })
  batch_id: string;

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

  @CreateDateColumn({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  created_at: Date;

  @UpdateDateColumn({
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
    onUpdate: 'CURRENT_TIMESTAMP',
  })
  updated_at: Date;

  // Relations
  @OneToMany('Task', 'batch')
  tasks: Relation<Task[]>;
}
