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
import { BaseEntity } from './base.entity';

export enum OrderItemStatus {
  PENDING = 'PENDING',
  ASSIGNED = 'ASSIGNED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

@Entity('order_items')
export class OrderItem extends BaseEntity {
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

  @ManyToOne('GtpLocation', 'orderItems')
  @JoinColumn({ name: 'destination_pallet_slot_id' })
  destinationPalletSlot: Relation<GtpLocation>;

  @ManyToMany(() => Task, (task) => task.orderItems)
  completedTasks: Relation<Task[]>;
}
