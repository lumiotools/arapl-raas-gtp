import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { LocationStatus } from './station.entity';

export enum WaitingLocationType {
  STATION_TO_STATION = 'STATION_TO_STATION', 
  INVENTORY_TO_STATION = 'INVENTORY_TO_STATION' 
}

@Entity('waiting_locations')
export class WaitingLocation {
  @PrimaryColumn({ type: 'varchar', length: 10 })
  location_id: string;

  @Column({ type: 'varchar', length: 100 })
  location_name: string;

  @Column({ type: 'enum', enum: LocationStatus, default: LocationStatus.AVAILABLE })
  status: LocationStatus;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @Column({ type: 'integer', nullable: true })
  holded_by: number | null;

  @Column({ type: 'enum', enum: WaitingLocationType, default: WaitingLocationType.STATION_TO_STATION })
  type: WaitingLocationType;

  @CreateDateColumn({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  created_at: Date;

  @UpdateDateColumn({
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
    onUpdate: 'CURRENT_TIMESTAMP',
  })
  updated_at: Date;
}
