import { Cargo, TaskStatus } from 'src/entities';
import { MOVE_TYPE } from 'src/entities/task.entity';
import { Location } from 'src/entities/location.entity';

export enum ActivityType {
  MOVEMENT = 'MOVEMENT',
  WAITING = 'WAITING', 
}

export class BaseopsTaskActivity {
  activity_id: string;
  display_activity_id: number | string;
  activity_type: ActivityType;
  status: TaskStatus;
  activity_reason?: string;
  move_type?: MOVE_TYPE;
  robot_id?: string;
  // Timestamps mirrored from Task entity
  created_at: Date | null;
  updated_at: Date | null;
  inqueue?: Date | null;
  processing?: Date | null;
  completed?: Date | null;
  triggered?: Date | null;
  start_location: Location;
  end_location: Location;
  cargos: Cargo[];
}
