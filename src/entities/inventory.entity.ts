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

@Entity('inventory')
export class Inventory {
  @PrimaryColumn({ type: 'varchar', length: 10 })
  id: string;

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

  @CreateDateColumn({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  created_at: Date;

  @UpdateDateColumn({
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
    onUpdate: 'CURRENT_TIMESTAMP',
  })
  updated_at: Date;

}
