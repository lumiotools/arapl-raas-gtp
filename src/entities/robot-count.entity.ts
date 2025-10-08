import {
  Entity,
  Column,
  PrimaryColumn,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum OperationType{
  CROSSDOCK = "CROSSDOCK",
  BASEOPS = "BASEOPS",
  FLOWOPS = "FLOWOPS",
}

@Entity('robot_counts')
export class RobotCount {
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

    @CreateDateColumn({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
      created_at: Date;
    
    @UpdateDateColumn({
      type: 'timestamp',
      default: () => 'CURRENT_TIMESTAMP',
      onUpdate: 'CURRENT_TIMESTAMP',
    })
    updated_at: Date;

}
