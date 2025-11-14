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
import { LocationStatus } from './station.entity'
import { BaseEntity } from './base.entity';

@Entity('inventory')
export class Inventory extends BaseEntity {
  @PrimaryColumn({ type: 'varchar', length: 10 })
  id: string;

  @Column({ type: 'varchar', length: 10 })
  location_name: string;

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

  @Column({ type: 'boolean', default: true})
  is_active: boolean;

  @Column({ type: 'boolean', default: false})
  is_empty: boolean;

}
