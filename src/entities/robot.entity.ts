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
  PrimaryColumn,
} from 'typeorm';
import type { Batch } from './batch.entity';
import { Location } from './location.entity';
import { Wait } from './wait.entity';
import { Cargo } from './cargo.entity';
import { OrderItem } from './order-item.entity';
import { WaitingLocation } from './waiting-location.entity';

export enum TaskType {
  CROSSDOCK = 'Crossdock',
  PUTAWAY = 'Putaway', 
  PICKING = 'PICKING',
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

}

@Entity('robots')
export class Robot {
    @PrimaryColumn('uuid')
    robot_id: string;

    @Column({ type: 'varchar', length: 100, nullable: true })
    parking_wait_location_id: string;

    @ManyToOne(() => WaitingLocation, { eager: true })
    @JoinColumn({ name: 'parking_wait_location_id' })
    waiting_location: Relation<WaitingLocation>;
}
