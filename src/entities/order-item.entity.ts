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
} from 'typeorm';
import type { Product } from './product.entity';
import type { GtpLocation } from './gtp-location.entity';
import { Task } from './task.entity';

export enum OrderItemStatus {
  PENDING = 'PENDING',
  ASSIGNED = 'ASSIGNED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

@Entity('order_items')
export class OrderItem {
  @PrimaryGeneratedColumn()
  order_item_id: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  order_batch_id: string | null;

  @Column({type:'varchar', length: 100})
  source_location_id: string;

  @Column({type: 'varchar', length: 100})
  destination_pallet_slot_id: string;

  @Column({
    type: 'enum', 
    enum: OrderItemStatus,
    default: OrderItemStatus.PENDING,
  })
  status: OrderItemStatus;

  @Column({ type: 'int', default: null, nullable: true })
  merged_order_item_id: number | null;

  @Column({ type: 'int', default: 0})
  retry_reassign_attempts: number;

  @CreateDateColumn({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  created_at: Date;

  @UpdateDateColumn({
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
    onUpdate: 'CURRENT_TIMESTAMP',
  })
  updated_at: Date;

  @ManyToOne('GtpLocation', 'orderItems')
  @JoinColumn({ name: 'destination_pallet_slot_id' })
  destinationPalletSlot: Relation<GtpLocation>;

  @ManyToMany(() => Task, (task) => task.orderItems)
  completedTasks: Relation<Task[]>;
}
