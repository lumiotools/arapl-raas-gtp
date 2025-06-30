import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  OneToMany,
  Relation,
} from 'typeorm';
import type { InventoryLocation } from './inventory-location.entity';
import type { OrderItem } from './order-item.entity';

@Entity('products')
export class Product {
  @PrimaryColumn({ type: 'varchar', length: 10 })
  product_id: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  inventory_location: string;

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
  @ManyToOne('InventoryLocation', 'products')
  @JoinColumn({ name: 'inventory_location' })
  inventoryLocation: Relation<InventoryLocation>;

  @OneToMany('OrderItem', 'product')
  orderItems: Relation<OrderItem[]>;
}
