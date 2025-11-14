import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { OperationType } from './robot-count.entity';
import { BaseEntity } from './base.entity';

export enum SettingType{
    EMPTY_LOCATION = "EMPTY_LOCATION",
}


@Entity('settings')
export class Settings extends BaseEntity {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ type: 'enum', enum: OperationType, default: OperationType.FLOWOPS})
    operation_type: OperationType;

    @Column({ type: 'json', nullable: true })
    value: any;

}
