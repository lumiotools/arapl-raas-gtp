import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { LocationStatus } from './station.entity';
import { BaseEntity } from './base.entity';

export enum WaitingLocationType {
  STATION_TO_STATION = 'STATION_TO_STATION', 
  INVENTORY_TO_STATION = 'INVENTORY_TO_STATION' 
}

@Entity('waiting_locations')
export class WaitingLocation extends BaseEntity {
  @PrimaryColumn({ type: 'varchar', length: 10 })
  location_id: string;

  @Column({ type: 'varchar', length: 100 })
  location_name: string;

  @Column({ type: 'enum', enum: LocationStatus, default: LocationStatus.AVAILABLE })
  status: LocationStatus;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @Column({ type: 'varchar', nullable: true })
  holded_by: string | null;

  @Column({ type: 'enum', enum: WaitingLocationType, default: WaitingLocationType.STATION_TO_STATION })
  type: WaitingLocationType;
}
