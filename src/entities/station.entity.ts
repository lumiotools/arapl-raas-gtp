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

export enum LocationStatus{
  AVAILABLE = 'AVAILABLE',
  OCCUPIED = 'OCCUPIED',
  RESERVED = 'RESERVED'
}

@Entity('stations')
export class Station {
  @PrimaryColumn({ type: 'varchar', length: 10 })
  station_id: string;

  @Column({ type: 'varchar', length: 100 })
  station_name: string;

  @Column({ type: 'enum', enum: LocationStatus, default: LocationStatus.AVAILABLE })
  status: LocationStatus;

  @Column({ type: 'integer' })
  priority: number;

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
  @OneToMany('GtpLocation', 'station')
  gtpLocations: Relation<GtpLocation[]>;

}
