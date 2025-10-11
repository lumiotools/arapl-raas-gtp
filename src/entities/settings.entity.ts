import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { OperationType } from './robot-count.entity';

export enum SettingType{
    EMPTY_LOCATION = "EMPTY_LOCATION",
}


@Entity('settings')
export class Settings {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ type: 'enum', enum: OperationType, default: OperationType.FLOWOPS})
    operation_type: OperationType;

    @Column({ type: 'json', nullable: true })
    value: any;

    @CreateDateColumn({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
    created_at: Date;
    
    @UpdateDateColumn({
      type: 'timestamp',
      default: () => 'CURRENT_TIMESTAMP',
      onUpdate: 'CURRENT_TIMESTAMP',
    })
    updated_at: Date;

}