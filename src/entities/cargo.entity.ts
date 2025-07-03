export interface CargoDimension {
  length: number;
  width: number;
  height: number;
}

export interface CargoAttribute {
  attribute_name: string;
  attribute_value: string;
}

export interface Cargo {
  cargo_code: string;
  cargo_type: string;
  cargo_dimension: CargoDimension;
  cargo_attributes: CargoAttribute[] | null;
  cargo_weight: number;
}
