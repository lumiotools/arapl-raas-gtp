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
import type { Product } from './product.entity';
import type { InventoryLocation } from './inventory-location.entity';

@Entity('inventory')
export class Inventory {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 20 })
  location_id: string;

  @Column({ type: 'varchar', length: 10 })
  product_id: string;

  @Column({ type: 'int', default: 0 })
  quantity: number;

  @CreateDateColumn({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  created_at: Date;

  @UpdateDateColumn({
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
    onUpdate: 'CURRENT_TIMESTAMP',
  })
  updated_at: Date;

  // Relations - using Relation type with type-only imports
  @ManyToOne('InventoryLocation', 'inventory')
  @JoinColumn({ name: 'location_id' })
  inventoryLocation: Relation<InventoryLocation>;

  @ManyToOne('Product', 'inventory')
  @JoinColumn({ name: 'product_id' })
  product: Relation<Product>;
}
