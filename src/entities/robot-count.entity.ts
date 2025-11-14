import {
  Entity,
  Column,
  PrimaryColumn,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { BaseEntity } from './base.entity';

export enum OperationType{
  BASEOPS = "BASEOPS",
  FLOWOPS = "FLOWOPS",
}

@Entity('robot_counts')
export class RobotCount extends BaseEntity {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({type: 'enum', enum: OperationType, default: OperationType.FLOWOPS})
    operation_type: OperationType;

    @Column({ type: 'int', nullable: false })
    total_robots : number;

    @Column({ type: 'int', nullable: false })
    robot_in_use: number;

    @Column({ type: 'boolean', nullable: false })
    is_waiting: boolean;

}
