import { Column, Entity, PrimaryColumn } from "typeorm";

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
  NOP_RESUME = 'NOP-resume',
  NOP_PAUSE = 'NOP-pause',
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
  location_attribute: LocationAttribute;
}

@Entity('locations')
export class LocationEntity {
  @PrimaryColumn({ type: 'varchar', length: 50 })
  location_id: string;

  @Column({ type: 'varchar', length: 50 })
  zone_id: string;

  @Column({ type: 'enum', enum: LocationType })
  location_type: LocationType;

  @Column({ type: 'int', nullable: true })
  row: number;

  @Column({ type: 'int', nullable: true })
  column: number;

  @Column({ type: 'boolean', default: false })
  is_occupied: boolean;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  created_at: Date;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' })
  updated_at: Date;
}
