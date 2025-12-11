import { Column, Entity, ManyToOne, PrimaryColumn, JoinColumn, OneToOne } from "typeorm";
import { LocationStatus } from "./station.entity";

export enum LocationType {
  ZONE = 'Zone',
  AISLE = 'Aisle',
  BAY = 'Bay',
  PALLET = 'PALLET',
  TRANSIENT = 'Transient',
  ENTRY = 'Entry',
}

export enum LocationAction {
  PICK = 'PICK',
  DROP = 'DROP',
  NOP = 'NOP',
  NOP_RESUME = 'NOP_RESUME',
  NOP_PAUSE = 'NOP_PAUSE',
}

export interface LocationDimension {
  length: number;
  height: number;
  width: number;
}

export interface LocationAttribute {
  attribute_name: string;
  attribute_value: string;
  attribute_zone_pair_id?: string;
  attribute_pending_next_intermediate_task?: boolean;
}

export interface Location {
  location_id: string;
  display_name?: string;
  location_type: LocationType;
  location_action: LocationAction;
  location_dimension?: LocationDimension;
  location_attribute: LocationAttribute;
}

@Entity('locations')
export class LocationEntity {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  location_id: string;

  @Column({ type: 'varchar', length: 100 })
  display_name: string;

  @Column({ type: 'uuid', nullable: true })
  parent_id: string;

  @Column({ type: 'enum', enum: LocationType })
  location_type: LocationType;

  @Column({ type: 'int', nullable: true })
  row: number;

  @Column({ type: 'int', nullable: true })
  column: number;

  @Column({ type: 'int', nullable: true })
  pick_priority: number;

  @Column({type: 'int', nullable: true})
  drop_priority: number;

  @Column({type: 'varchar', length: 36, nullable: true})
  dependent_location: string;

  @Column({ type: 'enum', enum: LocationStatus, default: LocationStatus.AVAILABLE })
  location_status: LocationStatus;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  created_at: Date;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' })
  updated_at: Date;

  @ManyToOne(() => LocationEntity)
  @JoinColumn({ name: 'parent_id' })
  parent: LocationEntity;

  @OneToOne(() => LocationEntity)
  @JoinColumn({ name: 'dependent_location' })
  dependency: LocationEntity;

  @Column({ type: 'json', nullable: true })
  attributes?: LocationAttribute[];
}