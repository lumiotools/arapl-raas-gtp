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
import type { Order } from './order.entity';
import type { Product } from './product.entity';
import type { GtpLocation } from './gtp-location.entity';

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

  @Column({ type: 'varchar', length: 10 })
  order_id: string;

  @Column({ type: 'varchar', length: 10 })
  product_id: string;

  @Column({ type: 'int' })
  quantity: number;

  @Column({ type: 'int'})
  remaining_quantity: number;


  @Column({ type: 'varchar', length: 10, nullable: true })
  license_plate_id: string;

  @Column({ type: 'varchar', length: 10, nullable: true })
  assigned_gtp_location: string | null;

  @Column({
    type: 'enum',
    enum: OrderItemStatus,
    default: OrderItemStatus.PENDING,
  })
  status: OrderItemStatus;

  @CreateDateColumn({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  created_at: Date;

  @UpdateDateColumn({
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
    onUpdate: 'CURRENT_TIMESTAMP',
  })
  updated_at: Date;

  // Relations - using Relation type with type-only imports
  @ManyToOne('Order', 'orderItems')
  @JoinColumn({ name: 'order_id' })
  order: Relation<Order>;

  @ManyToOne('Product', 'orderItems')
  @JoinColumn({ name: 'product_id' })
  product: Relation<Product>;

  @ManyToOne('GtpLocation', 'orderItems')
  @JoinColumn({ name: 'assigned_gtp_location' })
  assignedGtpLocation: Relation<GtpLocation>;
}
