import {
  Entity,
  Column,
  PrimaryColumn,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum OperationType{
  BASEOPS = "BASEOPS",
  FLOWOPS = "FLOWOPS",
}

@Entity('robots')
export class Robot {
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
