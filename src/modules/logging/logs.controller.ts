import { Controller, Get, Query, Param, HttpStatus, Delete } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { LoggingService } from '../../services/logging.service';

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
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Logs retrieved successfully',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          log_id: { type: 'number', example: 1 },
          message: { type: 'string', example: 'Task 123 created successfully' },
          timestamp: { type: 'string', format: 'date-time', example: '2024-01-01T00:00:00.000Z' },
        }
      }
    }
  })
  async getAllLogs(@Query('limit') limit?: number) {
    return await this.loggingService.getAllLogs(limit);
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
    description: 'Search results retrieved successfully'
  })
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
    description: 'Time range logs retrieved successfully'
  })
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
  async deleteAllLogs() {
    const result = await this.loggingService.deleteAllLogs();
    return {
      ...result,
      timestamp: new Date()
    };
  }
}
