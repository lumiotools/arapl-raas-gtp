import { Column, Entity, PrimaryColumn } from "typeorm";
import { LocationStatus } from "./station.entity";

export enum LocationType {
  ZONE = 'Zone',
  AISLE = 'Aisle',
  BAY = 'Bay',
  PALLET = 'PALLET',
  TRANSIENT = 'Transient',
}

export enum LocationAction {
  PICK = 'PICK',
  DROP = 'DROP',
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
}

export interface Location {
  location_id: string;
  location_type: LocationType;
  location_action: LocationAction;
  location_dimension?: LocationDimension;
  location_attribute?: LocationAttribute;
}

@Entity('locations')
export class LocationEntity {
  @PrimaryColumn('uuid')
  location_id: string;

  @Column({ type: 'varchar', length: 100 })
  display_name: string;

  @Column({ type: 'varchar', length: 100})
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

  @Column({ type: 'enum', enum: LocationStatus, default: LocationStatus.AVAILABLE })
  location_status: LocationStatus;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  created_at: Date;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' })
  updated_at: Date;
}
