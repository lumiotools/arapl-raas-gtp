export enum LocationType {
  ZONE = 'Zone',
  AISLE = 'Aisle',
  BAY = 'Bay',
  PALLET = 'Pallet',
  TRANSIENT = 'Transient',
}

export enum LocationAction {
  PICK = 'Pick',
  DROP = 'Drop',
  NOP = 'Nop',
  WAITPICK = 'Waitpick',
  WAITDROP = 'Waitdrop',
  WAIT = 'Wait',
  DESTACK = 'Destack',
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
