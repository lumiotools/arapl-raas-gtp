import { Controller, Get, Query, Param, HttpStatus, Delete, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { LoggingService } from '../../services/logging.service';
import { JwtAuthGuard } from '../auth/guard/auth.guard';
import { RolesGuard } from '../auth/guard/roles.guard';
import { Roles } from '../auth/guard/roles.decorator';
import { Role } from 'src/entities/user.entity';
import { OperationType } from 'src/entities/robot-count.entity';

@ApiTags('Logs')
@Controller('logs')
export class LogsController {
  constructor(private readonly loggingService: LoggingService) {}

  @Get()
  @ApiOperation({
    summary: 'Get all logs',
    description: 'Retrieve all logs with optional limit.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Maximum number of logs to return (optional - returns all logs if not specified)',
    example: 100
  })
  @ApiQuery({
    name: 'task_type',
    required: false,
    description: 'Filter logs by task type (optional)',
    example: 'GoodsToPerson'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Logs retrieved successfully',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          created_at: { type: 'string', format: 'date-time', example: '2025-12-22T05:39:46.831Z' },
          updated_at: { type: 'string', format: 'date-time', example: '2025-12-22T05:39:46.831Z' },
          log_id: { type: 'number', example: 10555 },
          message: { type: 'string', example: 'Robot in use decremented. Current robot in use: 0' },
          task_type: { type: 'string', example: 'GoodsToPerson' },
          task_id: { type: 'string', example: 'ae46809c-1802-401f-9f0f-377632bdc758' },
          order_batch_id: { type: 'string', nullable: true, example: null },
          is_error: { type: 'boolean', example: false },
          timestamp: { type: 'string', format: 'date-time', example: '2025-12-22T05:39:46.834Z' },
        }
      }
    }
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.FLOWOPS_ADMIN, Role.FLOWOPS_OPERATOR)
  async getAllLogs(@Query('limit') limit?: number, @Query('task_type') taskType?: OperationType) {
    return await this.loggingService.getLogs(taskType, limit);
  }

  @Get('search')
  @ApiOperation({
    summary: 'Search logs by message content',
    description: 'Search logs that contain specific text in the message.',
  })
  @ApiQuery({
    name: 'q',
    description: 'Search term to look for in log messages',
    example: 'error'
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Maximum number of logs to return',
    example: 100
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Search results retrieved successfully',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          created_at: { type: 'string', format: 'date-time', example: '2025-12-24T08:50:51.656Z' },
          updated_at: { type: 'string', format: 'date-time', example: '2025-12-24T08:50:51.656Z' },
          log_id: { type: 'number', example: 10612 },
          message: { type: 'string', example: 'Task c95332ff-322d-4262-85b3-283ff9bc4a75: Marking station ST002 as OCCUPIED.' },
          task_type: { type: 'string', example: 'GoodsToPerson' },
          task_id: { type: 'string', example: 'c95332ff-322d-4262-85b3-283ff9bc4a75' },
          order_batch_id: { type: 'string', nullable: true, example: null },
          is_error: { type: 'boolean', example: false },
          timestamp: { type: 'string', format: 'date-time', example: '2025-12-24T08:50:51.661Z' },
        }
      }
    }
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.FLOWOPS_ADMIN, Role.FLOWOPS_OPERATOR)
  async searchLogs(
    @Query('q') searchTerm: string,
    @Query('limit') limit?: number
  ) {
    return await this.loggingService.searchLogs(searchTerm, limit || 100);
  }
  @Get('time-range')
  @ApiOperation({
    summary: 'Get logs by time range',
    description: 'Retrieve logs within a specific time range.',
  })
  @ApiQuery({
    name: 'startTime',
    description: 'Start time (ISO string)',
    example: '2024-01-01T00:00:00.000Z'
  })
  @ApiQuery({
    name: 'endTime',
    description: 'End time (ISO string)',
    example: '2024-01-02T00:00:00.000Z'
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Maximum number of logs to return',
    example: 1000
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Time range logs retrieved successfully',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          created_at: { type: 'string', format: 'date-time', example: '2025-12-24T08:50:51.656Z' },
          updated_at: { type: 'string', format: 'date-time', example: '2025-12-24T08:50:51.656Z' },
          log_id: { type: 'number', example: 10612 },
          message: { type: 'string', example: 'Task c95332ff-322d-4262-85b3-283ff9bc4a75: Marking station ST002 as OCCUPIED.' },
          task_type: { type: 'string', example: 'GoodsToPerson' },
          task_id: { type: 'string', example: 'c95332ff-322d-4262-85b3-283ff9bc4a75' },
          order_batch_id: { type: 'string', nullable: true, example: null },
          is_error: { type: 'boolean', example: false },
          timestamp: { type: 'string', format: 'date-time', example: '2025-12-24T08:50:51.661Z' },
        }
      }
    }
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.FLOWOPS_ADMIN, Role.FLOWOPS_OPERATOR)
  async getLogsByTimeRange(
    @Query('startTime') startTime: string,
    @Query('endTime') endTime: string,
    @Query('limit') limit?: number
  ) {
    const start = new Date(startTime);
    const end = new Date(endTime);
    return await this.loggingService.getLogsByTimeRange(start, end, limit || 1000);
  }

  @Delete()
  @ApiOperation({
    summary: 'Delete all logs',
    description: 'Delete all log entries from the system. This action cannot be undone.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'All logs deleted successfully',
    schema: {
      type: 'object',
      properties: {
        deletedCount: { type: 'number', example: 150 },
        message: { type: 'string', example: 'Successfully deleted 150 log entries' },
        timestamp: { type: 'string', format: 'date-time', example: '2024-01-01T00:00:00.000Z' }
      }
    }
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Failed to delete logs'
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.FLOWOPS_ADMIN, Role.FLOWOPS_OPERATOR)
  async deleteAllLogs() {
    const result = await this.loggingService.deleteAllLogs();
    return {
      ...result,
      timestamp: new Date()
    };
  }
}
