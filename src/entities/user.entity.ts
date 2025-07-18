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
    StationWorker = 'station_worker',
    Robot = 'robot'
}

@Entity('users')
export class User {
    @PrimaryColumn({ name: 'user_name', type: 'varchar', length: 255})
    user_name: string;

    @Column({name:'roles', type: 'enum', enum: Role})
    role: Role ;

    @Column({ name: 'password_hash', type: 'varchar', length: 255 })
    passwordHash: string;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;
}