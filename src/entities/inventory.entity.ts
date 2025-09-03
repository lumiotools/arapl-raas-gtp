import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Relation,
} from 'typeorm';
import type { Product } from './product.entity';
import { LocationStatus } from './station.entity'

@Entity('inventory')
export class Inventory {
  @PrimaryColumn({ type: 'varchar', length: 10 })
  id: string;

  @Column({ type: 'varchar', length: 10 })
  product_id: string;

  @Column({ type: 'int', default: 0 })
  quantity: number;

  @Column({ type: 'int', default: 0 })
  defective_quantity: number;

  @Column({ type: 'int', default: 0 })
  missing_quantity: number;
  
  @Column({ type: 'int', default: 0 })
  quantity_in_system: number;

  @Column({ type: 'boolean', default: false })
  isProcessing: boolean;

  @Column({ type: 'varchar', length: 255, nullable: true })
  barcode_number: string;

  @Column({
    type: 'enum',
    enum: LocationStatus,
    default: LocationStatus.AVAILABLE,
  })
  status: LocationStatus;

  @Column({ type: 'varchar', nullable: true })
  holded_by: string | null;

  @CreateDateColumn({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  created_at: Date;

  @UpdateDateColumn({
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
    onUpdate: 'CURRENT_TIMESTAMP',
  })
  updated_at: Date;

  @ManyToOne('Product', 'inventory')
  @JoinColumn({ name: 'product_id' })
  product: Relation<Product>;
}
