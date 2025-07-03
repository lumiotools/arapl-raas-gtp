export enum WaitType {
  TRIGGER = 'Trigger',
  CONDITIONAL = 'Conditional',
}

export enum WaitStatus {
  NOT_STARTED = 'Not started',
  START_WAIT = 'Start Wait', 
  END_WAIT = 'End Wait',
}

export enum FallbackAction {
  RETRY = 'Retry',
  REROUTE = 'Reroute',
  ERROR = 'Error',
}

export interface Wait {
  wait_type: string;
  wait_condition?: string | null;
  start_location_wait_time?: number;
  end_location_wait_time?: number;
  start_location_available_wait?: boolean;
  end_location_available_wait?: boolean;
  wait_status?: string;
  timeout?: number;
  fallback_action?: string;
}
