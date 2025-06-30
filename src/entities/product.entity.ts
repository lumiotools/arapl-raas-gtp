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

@Entity('products')
export class Product {
  @PrimaryColumn({ type: 'varchar', length: 10 })
  product_id: string;

  @Column({ type: 'varchar', length: 255 })
  product_name: string;

  @CreateDateColumn({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  created_at: Date;

  @UpdateDateColumn({
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
    onUpdate: 'CURRENT_TIMESTAMP',
  })
  updated_at: Date;

  // Relations - using Relation type with type-only imports
  @OneToMany('OrderItem', 'product')
  orderItems: Relation<OrderItem[]>;

  @OneToMany('Inventory', 'product')
  inventory: Relation<Inventory[]>;
}
