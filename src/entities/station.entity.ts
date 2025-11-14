import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Relation,
} from 'typeorm';
import type { GtpLocation } from './gtp-location.entity';
import { BaseEntity } from './base.entity';

export enum LocationStatus{
  AVAILABLE = 'AVAILABLE',
  OCCUPIED = 'OCCUPIED',
  RESERVED = 'RESERVED'
}

@Entity('stations')
export class Station extends BaseEntity {
  @PrimaryColumn({ type: 'varchar', length: 10 })
  station_id: string;

  @Column({ type: 'varchar', length: 100 })
  location_name: string;

  @Column({ type: 'enum', enum: LocationStatus, default: LocationStatus.AVAILABLE })
  status: LocationStatus;

  @Column({ type: 'integer' })
  priority: number;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @Column({ type: 'varchar', nullable: true })
  holded_by: string | null;

  // Relations - using Relation type with type-only import
  @OneToMany('GtpLocation', 'station')
  gtpLocations: Relation<GtpLocation[]>;

}
