import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('product_requirements')
@Index(['product_id', 'station_id'], { unique: true })
export class ProductRequirement {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 10 })
  product_id: string;

  @Column({ type: 'varchar', length: 10 })
  station_id: string;

  @Column({ type: 'integer' })
  requirement: number;

  @Column({ type: 'boolean', default: false })
  isPaused: boolean;

  @Column({ type: 'boolean', default: false })
  isCancelled: boolean; 

  @CreateDateColumn({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  created_at: Date;

  @UpdateDateColumn({
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
    onUpdate: 'CURRENT_TIMESTAMP',
  })
  updated_at: Date;
}
