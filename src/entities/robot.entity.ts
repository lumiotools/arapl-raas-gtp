import {
  Entity,
  Column,
  PrimaryColumn,
} from 'typeorm';


@Entity('robots')
export class Robot {
    @PrimaryColumn('uuid')
    id: string;

    @Column({ type: 'int', nullable: false })
    total_robots : number;

    @Column({ type: 'int', nullable: false })
    robot_in_use: number;

    @Column({ type: 'boolean', nullable: false })
    is_waiting: boolean;

}
