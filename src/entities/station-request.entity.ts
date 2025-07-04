import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Relation,
} from 'typeorm';
import type { Task } from './task.entity';
import type { Station } from './station.entity';

@Entity('station_requests')
export class StationRequest {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  task_id: number;

  @Column({ type: 'varchar', length: 10 })
  station_id: string;

  @CreateDateColumn({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  created_at: Date;

  // Relations
  @ManyToOne('Task')
  @JoinColumn({ name: 'task_id' })
  task: Relation<Task>;

  @ManyToOne('Station')
  @JoinColumn({ name: 'station_id' })
  station: Relation<Station>;
}
