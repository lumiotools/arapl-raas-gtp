import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { LocationStatus } from './station.entity';
import { BaseEntity } from './base.entity';

@Entity('empty_locations')
export class EmptyLocation extends BaseEntity {
  @PrimaryColumn({ type: 'varchar', length: 10 })
  location_id: string;

  @Column({ type: 'varchar', length: 100 })
  location_name: string;

  @Column({ type: 'enum', enum: LocationStatus, default: LocationStatus.AVAILABLE })
  status: LocationStatus;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @Column({ type:'int', default: 1 })
  priority: number;
  
}
