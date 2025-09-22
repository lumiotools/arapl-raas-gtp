import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity('logs')
export class Log {
  @PrimaryGeneratedColumn()
  log_id: number;

  @Column({ type: 'text' })
  message: string;

  @CreateDateColumn({ 
    type: 'timestamp', 
    precision: 3, // Millisecond precision
    default: () => 'CURRENT_TIMESTAMP(3)'
  })
  timestamp: Date;
}
