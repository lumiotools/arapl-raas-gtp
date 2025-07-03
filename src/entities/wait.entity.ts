export enum WaitType {
  TRIGGER = 'Trigger',
  CONDITIONAL = 'Conditional',
}

export interface Wait {
  wait_type: string;
  wait_condition: string | null;
  start_location_wait_time?: number;
  end_location_wait_time?: number;
  start_location_available_wait?: boolean;
  end_location_available_wait?: boolean;
}
