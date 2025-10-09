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

  async log(message: string, task_type: TaskType, task_id: string | null, order_batch_id: string | null, is_error: boolean = false): Promise<void> {
    try {
      const logEntry = this.logRepository.create({
        message,
        task_type,
        task_id,
        order_batch_id,
        is_error,
      });

      await this.logRepository.save(logEntry);
    } catch (error) {
      // Fallback to console logging if database logging fails
      this.logger.error(`Failed to save log to database: ${error.message}`);
      this.logger.log(`Original log: ${message}`);
    }
  }

  async deleteErrorLogsForTask(task_id: string){
    await this.logRepository.delete({ task_id: task_id, is_error: true });
  }

  async createErrorLog(message: string, task_type: TaskType, task_id: string , order_batch_id: string | null, is_error: boolean = true): Promise<void> {
    const existingErrorLog = await this.logRepository.findOne({ where: { task_id: task_id, is_error: true } });
    if (existingErrorLog) {
      // If an error log already exists for this task, do not create a new one
      return;
    }
    await this.log(`Task ${task_id} is in CANCELLED state for more than 1 minute`, task_type, task_id, null);
    await this.log(message, task_type, task_id, order_batch_id, is_error);
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

  /**
   * Get logs with optional filtering by task type.
   * If taskType is provided, returns logs only for that task_type (descending by timestamp).
   */
  async getLogs(taskType?: string | TaskType, limit?: number): Promise<Log[]> {
    if (taskType) {
      const opts: any = { where: { task_type: taskType }, order: { timestamp: 'DESC' } };
      if (limit) opts.take = limit;
      return await this.logRepository.find(opts);
    }
    return await this.getAllLogs(limit);
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
