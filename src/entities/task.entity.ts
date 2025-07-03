import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Relation,
} from 'typeorm';
import type { Batch } from './batch.entity';
import { Location } from './location.entity';
import { Wait } from './wait.entity';

export enum TaskType {
  CROSSDOCK = 'Crossdock',
  PUTAWAY = 'Putaway', 
  PICKING = 'Picking',
  GOODS_TO_PERSON = 'GoodsToPerson',
}

export enum TaskStatus {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

@Entity('tasks')
export class Task {
  @PrimaryGeneratedColumn()
  task_id: number;

  @Column({ type: 'varchar', length: 32 })
  batch_id: string;

  @Column({ type: 'varchar', length: 10 })
  product_id: string;

  @Column({ type: 'int' })
  quantity: number;

  @Column({
    type: 'enum',
    enum: TaskType,
  })
  task_type: TaskType;

  @Column({
    type: 'enum',
    enum: TaskStatus,
    default: TaskStatus.PENDING,
  })
  status: TaskStatus;

  @Column({ type: 'int' })
  sequence_order: number;

  @Column({ type: 'int', nullable: true })
  task_dependency: number;

  @CreateDateColumn({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  created_at: Date;

  @UpdateDateColumn({
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
    onUpdate: 'CURRENT_TIMESTAMP',
  })
  updated_at: Date;

  // Relations
  @ManyToOne('Batch', 'tasks')
  @JoinColumn({ name: 'batch_id' })
  batch: Relation<Batch>;

  @Column({ type: 'json' })
  start_location: Location;

  @Column({ type: 'json' })
  end_location: Location;

  @Column({ type: 'json' })
  wait: Wait;
}
