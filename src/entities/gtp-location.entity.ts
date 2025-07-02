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
import type { Station } from './station.entity';
import type { OrderItem } from './order-item.entity';

export enum GtpLocationStatus {
  AVAILABLE = 'AVAILABLE',
  OCCUPIED = 'OCCUPIED',
}

@Entity('gtp_locations')
export class GtpLocation {
  @PrimaryColumn({ type: 'varchar', length: 10 })
  gtp_location_id: string;

  @Column({ type: 'varchar', length: 10, nullable: true })
  station_id?: string;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @Column({
    type: 'enum',
    enum: GtpLocationStatus,
    default: GtpLocationStatus.AVAILABLE,
  })
  status: GtpLocationStatus;

  @CreateDateColumn({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  created_at: Date;

  @UpdateDateColumn({
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
    onUpdate: 'CURRENT_TIMESTAMP',
  })
  updated_at: Date;

  // Relations - using Relation type with type-only imports
  @ManyToOne('Station', 'gtpLocations')
  @JoinColumn({ name: 'station_id' })
  station: Relation<Station>;

  @OneToMany('OrderItem', 'assignedGtpLocation')
  orderItems: Relation<OrderItem[]>;
}
