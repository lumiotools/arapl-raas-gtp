import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Relation,
  PrimaryColumn,
} from 'typeorm';

export enum Role {
    ADMIN = 'admin',
    SYSTEM_ADMIN = 'system_admin',
    HEAD_STATION_MANAGER = 'head_station_manager',
    STATION_WORKER = 'station_worker',
    ROBOT = 'robot'
}

@Entity('users')
export class User {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'user_name', type: 'varchar', length: 255, unique: true })
    user_name: string;

    @Column({name:'role', type: 'enum', enum: Role})
    role: Role ;

    @Column({ name: 'password', type: 'varchar', length: 255 })
    password: string;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;
}