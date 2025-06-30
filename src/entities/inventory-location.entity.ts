import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Relation,
} from 'typeorm';
import type { Product } from './product.entity';

@Entity('inventory_locations')
export class InventoryLocation {
  @PrimaryColumn({ type: 'varchar', length: 20 })
  location_id: string;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @CreateDateColumn({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  created_at: Date;

  @UpdateDateColumn({
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
    onUpdate: 'CURRENT_TIMESTAMP',
  })
  updated_at: Date;

  // Relations - using Relation type with type-only import
  @OneToMany('Product', 'inventoryLocation')
  products: Relation<Product[]>;
}
