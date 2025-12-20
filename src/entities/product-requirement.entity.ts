import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
  Relation,
} from 'typeorm';
import { Inventory } from './inventory.entity';
import { BaseEntity } from './base.entity';

@Entity('product_requirements')
export class ProductRequirement extends BaseEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 10, nullable: true })
  source_location_id: string;

  @Column({ type: 'varchar', length: 10 })
  station_id: string;

  @Column({ type: 'boolean', default: false })
  isPaused: boolean;

  @Column({ type: 'boolean', default: false })
  isCancelled: boolean; 

  @Column({ type: 'boolean', default: false })
  task_created : boolean;
  
  // If you want to keep both the column and relationship, don't use @JoinColumn
  @ManyToOne(() => Inventory, { nullable: true })
  sourceLocation: Relation<Inventory>;
}