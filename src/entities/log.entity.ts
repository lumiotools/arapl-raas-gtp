import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';
import { TaskType } from './task.entity';

@Entity('logs')
export class Log {
  @PrimaryGeneratedColumn()
  log_id: number;

  @Column({ type: 'text' })
  message: string;

  @Column( {type: 'enum', enum: TaskType})
  task_type: TaskType;

  @Column({ type: 'varchar', length: 100, nullable: true })
  task_id: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  order_batch_id: string | null;

  @Column({ type: 'boolean', default: false })
  is_error: boolean;

  @CreateDateColumn({ 
    type: 'timestamp', 
    precision: 3, // Millisecond precision
    default: () => 'CURRENT_TIMESTAMP(3)'
  })
  timestamp: Date;
}
