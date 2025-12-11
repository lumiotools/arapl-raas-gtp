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
import { BaseEntity } from './base.entity';

export enum Role {
  ADMIN = 'admin',
  FLOWOPS_OPERATOR = 'flowops.operator',
  FLOWOPS_ADMIN = 'flowops.admin',
  BASEOPS_ADMIN = 'baseops.admin',
  CROSSDOCK_ADMIN = 'crossdock.admin',
}

@Entity('users')
export class User extends BaseEntity {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'user_name', type: 'varchar', length: 255, unique: true })
    user_name: string;

    @Column({name:'role', type: 'enum', enum: Role})
    role: Role ;

    @Column({ name: 'password', type: 'varchar', length: 255 })
    password: string;
}