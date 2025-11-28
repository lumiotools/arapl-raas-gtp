import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { LocationEntity } from "./location.entity";

@Entity('zone_pair_config')
export class ZonePairConfig {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 36 })
  start_zone_id: string;

  @Column({ type: 'varchar', length: 36 })
  end_zone_id: string;

  @Column({ type: 'boolean', default: false })
  reverse_start_pick_priority: boolean;

  @Column({ type: 'boolean', default: false })
  reverse_end_drop_priority: boolean;

  @Column({ type: 'varchar', length: 36, nullable: true })
  start_entry_point_location_id: string | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  end_entry_point_location_id: string | null;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  created_at: Date;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' })
  updated_at: Date;

  @ManyToOne(() => LocationEntity)
  @JoinColumn({ name: 'start_zone_id', referencedColumnName: 'location_id' })
  start_zone: LocationEntity;

  @ManyToOne(() => LocationEntity)
  @JoinColumn({ name: 'end_zone_id', referencedColumnName: 'location_id' })
  end_zone: LocationEntity;

  @ManyToOne(() => LocationEntity)
  @JoinColumn({ name: 'start_entry_point_location_id', referencedColumnName: 'location_id' })
  start_entry_point_location: LocationEntity;

  @ManyToOne(() => LocationEntity)
  @JoinColumn({ name: 'end_entry_point_location_id', referencedColumnName: 'location_id' })
  end_entry_point_location: LocationEntity;
}
