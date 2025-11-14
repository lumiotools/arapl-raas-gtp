import {
  BeforeInsert,
  BeforeUpdate,
  Column,
  PrimaryGeneratedColumn,
} from 'typeorm';

export abstract class BaseEntity {
  @Column({ type: 'timestamptz', nullable: true })
  created_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  updated_at: Date;

  @BeforeInsert()
  setCreatedAt() {
    const now = this.getUtcTimestamp();
    this.created_at = now;
    this.updated_at = now;
  }

  @BeforeUpdate()
  setUpdatedAt() {
    this.updated_at = this.getUtcTimestamp();
  }
  private getUtcTimestamp(): Date {
    return new Date();
  }
}