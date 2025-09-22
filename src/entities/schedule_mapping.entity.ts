import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Relation,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { GtpLocation } from './gtp-location.entity';

@Entity('schedule-mapping')
export class ScheduleMapping {
    @PrimaryGeneratedColumn()
    id: number;

   @Column({ type: 'varchar', length: 255 })
   license_plate_id: string;

   @Column({ type: 'varchar', length: 10 })
   gtp_location_id: string;

   @ManyToOne('GtpLocation', 'scheduleMappings')
   @JoinColumn({ name: 'gtp_location_id' })
   gtpLocation: Relation<GtpLocation>;
}
