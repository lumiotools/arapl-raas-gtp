import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Log } from '../entities/log.entity';

@Injectable()
export class LoggingService {
  private readonly logger = new Logger(LoggingService.name);

  constructor(
    @InjectRepository(Log)
    private readonly logRepository: Repository<Log>,
  ) {}

  async log(message: string): Promise<void> {
    try {
      const logEntry = this.logRepository.create({
        message,
      });

      await this.logRepository.save(logEntry);
    } catch (error) {
      // Fallback to console logging if database logging fails
      this.logger.error(`Failed to save log to database: ${error.message}`);
      this.logger.log(`Original log: ${message}`);
    }
  }

  // Query methods for retrieving logs
  async getAllLogs(limit: number = 100): Promise<Log[]> {
    return await this.logRepository.find({
      order: { timestamp: 'DESC' },
      take: limit,
    });
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
}
