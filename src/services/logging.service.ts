import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Log } from '../entities/log.entity';
import { TaskType } from 'src/entities';

@Injectable()
export class LoggingService {
  static log(arg0: string) {
    throw new Error('Method not implemented.');
  }
  private readonly logger = new Logger(LoggingService.name);

  constructor(
    @InjectRepository(Log)
    private readonly logRepository: Repository<Log>,
  ) {}

  async log(message: string, task_type: TaskType, task_id: string | null, order_batch_id: string | null): Promise<void> {
    try {
      const logEntry = this.logRepository.create({
        message,
        task_type,
        task_id,
        order_batch_id,
      });

      await this.logRepository.save(logEntry);
    } catch (error) {
      // Fallback to console logging if database logging fails
      this.logger.error(`Failed to save log to database: ${error.message}`);
      this.logger.log(`Original log: ${message}`);
    }
  }

  // Query methods for retrieving logs
  async getAllLogs(limit?: number): Promise<Log[]> {
    const query = this.logRepository.find({
      order: { timestamp: 'DESC' },
    });
    
    if (limit) {
      return await this.logRepository.find({
        order: { timestamp: 'DESC' },
        take: limit,
      });
    }
    
    return await query;
  }

  async getLogsByTimeRange(startTime: Date, endTime: Date, limit: number = 1000): Promise<Log[]> {
    return await this.logRepository
      .createQueryBuilder('log')
      .where('log.timestamp BETWEEN :startTime AND :endTime', { startTime, endTime })
      .orderBy('log.timestamp', 'DESC')
      .limit(limit)
      .getMany();
  }

  async searchLogs(searchTerm: string, limit: number = 100): Promise<Log[]> {
    return await this.logRepository
      .createQueryBuilder('log')
      .where('log.message LIKE :searchTerm', { searchTerm: `%${searchTerm}%` })
      .orderBy('log.timestamp', 'DESC')
      .limit(limit)
      .getMany();
  }

  // Delete all logs
  async deleteAllLogs(): Promise<{ deletedCount: number; message: string }> {
    try {
      // Get count before deletion
      const countBefore = await this.logRepository.count();
      
      // Use clear() method to delete all records
      await this.logRepository.clear();
      
      const deletedCount = countBefore;
      
      return {
        deletedCount,
        message: `Successfully deleted ${deletedCount} log entries`
      };
    } catch (error) {
      this.logger.error(`Failed to delete all logs: ${error.message}`);
      throw error;
    }
  }
}
