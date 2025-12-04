import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Relation,
} from 'typeorm';
import type { OrderItem } from './order-item.entity';
import type { Inventory } from './inventory.entity';
import { BaseEntity } from './base.entity';

@Entity('products')
export class Product extends BaseEntity {
  @PrimaryColumn({ type: 'varchar', length: 10 })
  product_id: string;

  @Column({ type: 'varchar', length: 255 })
  product_name: string;

  // Relations - using Relation type with type-only imports
  @OneToMany('OrderItem', 'product')
  orderItems: Relation<OrderItem[]>;

  @OneToMany('Inventory', 'product')
  inventory: Relation<Inventory[]>;
}
