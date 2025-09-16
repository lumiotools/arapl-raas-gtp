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
  location_attribute: LocationAttribute;
}
