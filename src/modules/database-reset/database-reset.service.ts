import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ResetResponseDto } from './dto/reset-response.dto';

@Injectable()
export class DatabaseResetService {
  private readonly logger = new Logger(DatabaseResetService.name);

  constructor(private dataSource: DataSource) {}

  async resetDatabase(): Promise<ResetResponseDto> {
    this.logger.log('Starting database reset process...');

    // Use a transaction to ensure all operations succeed or fail together
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Execute the SQL queries directly (matches your original script)
      const queries = [
        'DELETE FROM tasks_order_items_order_items',
        'DELETE FROM order_items',
        'DELETE FROM product_requirements',
        'DELETE FROM tasks',
        'DELETE FROM batches',
        'DELETE FROM logs',
        'DELETE FROM empty_locations',
        "UPDATE stations SET status = 'AVAILABLE', holded_by = NULL",
        "UPDATE waiting_locations SET status = 'AVAILABLE', holded_by = NULL",
        "UPDATE robots SET total_robots = 1, robot_in_use = 0, is_waiting = false"
      ];

      for (const query of queries) {
        this.logger.log(`Executing: ${query}`);
        await queryRunner.query(query);
      }

      // Commit the transaction
      await queryRunner.commitTransaction();

      const successMessage = 'Database reset completed successfully';
      this.logger.log(successMessage);

      return {
        success: true,
        message: successMessage,
      };
    } catch (error) {
      // Rollback the transaction in case of error
      await queryRunner.rollbackTransaction();

      this.logger.error('Database reset failed:', error.message);

      throw error;
    } finally {
      // Release the query runner
      await queryRunner.release();
    }
  }

  async resetSequences(): Promise<{ success: boolean; message: string }> {
    this.logger.log('Resetting database sequences...');

    try {
      const queryRunner = this.dataSource.createQueryRunner();
      await queryRunner.connect();

      // Reset sequence counters for PostgreSQL
      const sequences = [
        'ALTER SEQUENCE order_items_order_item_id_seq RESTART WITH 1',
        'ALTER SEQUENCE orders_id_seq RESTART WITH 1',
        'ALTER SEQUENCE station_requests_id_seq RESTART WITH 1',
        'ALTER SEQUENCE product_requirements_id_seq RESTART WITH 1',
        'ALTER SEQUENCE tasks_task_id_seq RESTART WITH 1',
        'ALTER SEQUENCE batches_id_seq RESTART WITH 1',
        'ALTER SEQUENCE logs_log_id_seq RESTART WITH 1',
      ];

      for (const sequence of sequences) {
        try {
          await queryRunner.query(sequence);
        } catch (seqError) {
          // Log warning but continue - sequence might not exist
          this.logger.warn(
            `Failed to reset sequence: ${sequence} - ${seqError.message}`,
          );
        }
      }

      await queryRunner.release();

      const message = 'Database sequences reset completed';
      this.logger.log(message);

      return {
        success: true,
        message,
      };
    } catch (error) {
      this.logger.error('Sequence reset failed:', error.message);
      throw error;
    }
  }

  async resetDatabaseAndSequences(): Promise<ResetResponseDto> {
    // First reset the data
    const resetResult = await this.resetDatabase();

    // Then reset the sequences
    await this.resetSequences();

    return {
      success: true,
      message: resetResult.message + ' (including sequence reset)',
    };
  }
}
