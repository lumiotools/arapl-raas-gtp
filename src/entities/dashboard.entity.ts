import {
  Entity,
  Column,
  OneToMany,
  Relation,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Task } from './task.entity';

@Entity('dashboard')
export class dashboard {
    @PrimaryGeneratedColumn()
    id: string;
    
    @Column({type: 'int'})
    task_id:number;

    @Column({ type: 'timestamp', precision: 3, nullable: true })
    inqueue: Date;

    @Column({ type: 'timestamp', precision: 3, nullable: true })
    processing: Date;

    @Column({ type: 'timestamp', precision: 3, nullable: true })
    completed: Date;

    @Column({ type: 'timestamp', precision: 3, nullable: true })
    triggered: Date;

    @OneToMany(() => Task, (task) => task.task_id, { cascade: true, onDelete: 'CASCADE' })
    task: Relation<Task>;

}
