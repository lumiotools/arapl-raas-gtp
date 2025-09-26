import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Relation,
  ManyToMany,
  JoinTable,
  Generated,
} from 'typeorm';
import type { Batch } from './batch.entity';
import { Location } from './location.entity';
import { Wait } from './wait.entity';
import { Cargo } from './cargo.entity';
import { OrderItem } from './order-item.entity';

export enum TaskType {
  CROSSDOCK = 'Crossdock',
  PUTAWAY = 'Putaway', 
  PICKING = 'PICKING',
  BASEOPS = 'Baseops',
  DROP = 'DROP',
  GOODS_TO_PERSON = 'GoodsToPerson',
  NOP = "NOP"
}

export  enum MOVE_TYPE {
  INVENTORY_TO_STATION = 'InventoryToStation',
  STATION_TO_INVENTORY = 'StationToInventory',
  STATION_TO_STATION = 'StationToStation',
  STATION_TO_WAITING_LOCATION = 'StationToWaitingLocation',
  WAITING_LOCATION_TO_STATION = 'WaitingLocationToStation',
  INVENTORY_TO_WAITING_LOCATION = 'InventoryToWaitingLocation',
  WAITING_LOCATION_TO_INVENTORY = 'WaitingLocationToInventory',
  INVENTORY_TO_INVENTORY = 'InventoryToInventory',
  ZONE_TO_ZONE = 'ZoneToZone',
  ZONE_TO_WAIT='ZoneToWait',
  WAIT_TO_ZONE='WaitToZone',
  STATION_TO_EMPTY_LOCATION = 'StationToEmptyLocation',
}


export enum TaskStatus {
  PENDING = 'PENDING',
  ASSIGNED = 'ASSIGNED',
  INQUEUE = 'INQUEUE',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  TRIGERRED = 'TRIGGERED',
  TASK_ACKNOWLEDGED = 'task_acknowledged',
  ROBOT_ASSIGNED = 'robot_assigned',
  PICKUP_SUCCESSFUL = 'pickup_successful',
  DROP_SUCCESSFUL = 'drop_successful',
  TASK_CANCELLED = 'task_cancelled',
  ROBOT_MOVEMENT_STARTED = 'robot_movement_started',
  DROP_REJECTED = 'drop_rejected',
  PICK_REJECTED = 'pick_rejected',
  PICK_FAILED = 'pick_failed',
  DROP_FAILED = 'drop_failed',
  HALTED = 'HALTED',

}

@Entity('tasks')
export class Task {
  @PrimaryGeneratedColumn('uuid')
  task_id: string;

  @Generated('increment')
  @Column({ type: 'bigint', unique: true })
  display_task_id: number;

  @Column({ type: 'varchar', length: 32 })
  batch_id: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  fms_batch_id: string;

  @Column({ type: 'varchar', length: 10, nullable: true })
  origin_location: string;

  @Column({ type: 'int', nullable: true })
  priority: number;

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

  @Column({ type: 'varchar', nullable: true })
  task_dependency: string;

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

  @Column({ type: 'json', nullable: true })
  wait: Wait;

  @Column({ type: 'json', nullable: true })
  cargos: Cargo[];

  @Column({ type: 'timestamp', precision: 3, nullable: true })
  inqueue: Date;

  @Column({ type: 'timestamp', precision: 3, nullable: true })
  processing: Date;

  @Column({ type: 'timestamp', precision: 3, nullable: true })
  completed: Date;

  @Column({ type: 'timestamp', precision: 3, nullable: true })
  triggered: Date;

  @ManyToMany(() => OrderItem, (orderItem) => orderItem.completedTasks)
  @JoinTable() // This should be on one side of the ManyToMany relation
  orderItems: Relation<OrderItem[]>;
}
