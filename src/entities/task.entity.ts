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
import { Cargo } from './cargo.entity';

export enum TaskType {
  CROSSDOCK = 'Crossdock',
  PUTAWAY = 'Putaway', 
  PICKING = 'Picking',
  GOODS_TO_PERSON = 'GoodsToPerson',
}

export  enum MOVE_TYPE {
  INVENTORY_TO_STATION = 'InventoryToStation',
  STATION_TO_INVENTORY = 'StationToInventory',
  STATION_TO_STATION = 'StationToStation',
  STATION_TO_WAITING_LOCATION = 'StationToWaitingLocation',
  WAITING_LOCATION_TO_STATION = 'WaitingLocationToStation',
  INVENTORY_TO_WAITING_LOCATION = 'InventoryToWaitingLocation',
  WAITING_LOCATION_TO_INVENTORY = 'WaitingLocationToInventory',
}


export enum TaskStatus {
  PENDING = 'PENDING',
  ASSIGNED = 'ASSIGNED',
  INQUEUE = 'INQUEUE',
  INPROGRESS = 'INPROGRESS', 
  IN_PROGRESS = 'IN_PROGRESS',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  FAILED = 'FAILED',
  TRIGERRED = 'TRIGGERED',
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

  @Column({
    type: 'enum',
    enum: MOVE_TYPE,
    nullable: true,
  })
  move_type: MOVE_TYPE;

  @Column({ type: 'int' })
  sequence_order: number;

  @Column({ type: 'int', nullable: true })
  task_dependency: number;

  @Column({ type: 'varchar', length: 64, nullable: true })
  robot_id: string;

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

  @Column({ type: 'json' })
  cargos: Cargo[];
}
