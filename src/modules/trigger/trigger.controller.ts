import {
  Controller,
  Get,
  Post,
  Param,
  HttpStatus,
  HttpException,
  Body,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiOkResponse,
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiConflictResponse,
  ApiBody,
} from '@nestjs/swagger';
import { TriggerService } from './trigger.service';
import { JwtAuthGuard } from '../auth/guard/auth.guard';
import { RolesGuard } from '../auth/guard/roles.guard';
import { Roles } from '../auth/guard/roles.decorator';

export enum MessageCode {
  NO_PROBLEM = 'NO_PROBLEM',
  INSUFFICIENT_QUANTITY = 'INSUFFICIENT_QUANTITY',
  OTHER = 'OTHER',
  NOT_REQUIRED = 'NOT_REQUIRED',
}

@ApiTags('Trigger')
@Controller('trigger')
export class TriggerController {
  constructor(private readonly triggerService: TriggerService) {}

  @Post(':station_id')
  @ApiOperation({
    summary: 'Trigger station action',
    description: 'Triggers completion of current task at station and schedules next task. Station must be OCCUPIED (not RESERVED).',
  })
  @ApiParam({
    name: 'station_id',
    description: 'The ID of the station to trigger',
    example: 'ST001',
  })
  @ApiBody({
    description: 'Trigger station action payload',
    schema: {
      type: 'object',
      properties: {
        dropped_quantity: { type: 'integer', example: 5 },
        message_code: {
          type: 'string',
          enum: Object.values(MessageCode),
          example: 'NO_PROBLEM',
        },
      },
      required: ['dropped_quantity', 'message_code'],
    },
  })
  @ApiOkResponse({
    description: 'Station triggered successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            message: { type: 'string', example: 'Station ST001 triggered successfully' },
            triggered_task: { type: 'object' },
            station: { type: 'object' },
            timestamp: { type: 'string' },
          },
        },
        message: { type: 'string', example: 'Station ST001 triggered successfully' },
      },
    },
  })
  @ApiConflictResponse({
    description: 'Station cannot be triggered (reserved or not occupied)',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: false },
        message: { type: 'string', example: "Can't trigger now - station ST001 is reserved" },
        error: { type: 'string' },
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Failed to trigger station',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: false },
        message: { type: 'string', example: 'Failed to trigger station' },
        error: { type: 'string' },
      },
    },
  })
  @UseGuards (JwtAuthGuard, RolesGuard)
  @Roles('admin', 'operator')
  async triggerStation(
    @Param('station_id') stationId: string,
    @Body() body: { dropped_quantity: number; message_code: MessageCode }
  ) {
    try {
      const result = await this.triggerService.triggerStationAction(stationId, body.dropped_quantity, body.message_code);
      return {
        success: true,
        data: result,
        message: `Station ${stationId} triggered successfully`,
      };
    } catch (error) {
      if (error.status === 409) { // ConflictException
        throw new HttpException(
          {
            success: false,
            message: error.message || "Can't trigger now",
            error: error.message,
          },
          HttpStatus.CONFLICT,
        );
      }
      throw new HttpException(
        {
          success: false,
          message: error.message || 'Failed to trigger station',
          error: error.message,
        },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Get(':station_id/status')
  @ApiOperation({
    summary: 'Get station status',
    description: 'Retrieves the current status of a specific station',
  })
  @ApiParam({
    name: 'station_id',
    description: 'The ID of the station to get status for',
    example: 'ST001',
  })
  @ApiOkResponse({
    description: 'Station status retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            station_id: { type: 'string', example: 'ST001' },
            status: { type: 'string', example: 'AVAILABLE' },
            is_active: { type: 'boolean', example: true },
            priority: { type: 'number', example: 1 },
          },
        },
        message: { type: 'string', example: 'Status retrieved for station ST001' },
      },
    },
  })
  @ApiNotFoundResponse({
    description: 'Station not found or failed to get status',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: false },
        message: { type: 'string', example: 'Failed to get station status' },
        error: { type: 'string' },
      },
    },
  })
  async getStationStatus(@Param('station_id') stationId: string) {
    try {
      const status = await this.triggerService.getStationStatus(stationId);
      return {
        success: true,
        data: status,
        message: `Status retrieved for station ${stationId}`,
      };
    } catch (error) {
      throw new HttpException(
        {
          success: false,
          message: error.message || 'Failed to get station status',
          error: error.message,
        },
        HttpStatus.NOT_FOUND,
      );
    }
  }

  @Post('skip/:station_id')
  @ApiOperation({
    summary: 'Skip station without processing',
    description: 'Skips the current station without dropping any quantity and moves directly to the next station in sequence. No inventory updates or product requirement modifications occur.',
  })
  @ApiParam({
    name: 'station_id',
    description: 'The ID of the station to skip',
    example: 'ST001',
  })
  @ApiOkResponse({
    description: 'Station skipped successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            message: { type: 'string', example: 'Station ST001 skipped successfully' },
            skipped_task: {
              type: 'object',
              properties: {
                task_id: { type: 'number', example: 123 },
                batch_id: { type: 'string', example: 'B1641234567' },
                product_id: { type: 'string', example: 'P001' },
                previous_status: { type: 'string', example: 'COMPLETED' },
                new_status: { type: 'string', example: 'TRIGGERED' },
                quantity: { type: 'number', example: 10 },
                skipped_station: { type: 'string', example: 'ST001' }
              }
            },
            next_task: {
              type: 'object',
              properties: {
                task_id: { type: 'number', example: 124 },
                destination: { type: 'string', example: 'ST002' },
                quantity: { type: 'number', example: 10 },
                status: { type: 'string', example: 'PENDING' }
              }
            },
            station: {
              type: 'object',
              properties: {
                station_id: { type: 'string', example: 'ST001' },
                status: { type: 'string', example: 'OCCUPIED' },
                message: { type: 'string', example: 'Station remains occupied until next task starts processing' }
              }
            },
            timestamp: { type: 'string', format: 'date-time', example: '2024-01-01T00:00:00.000Z' },
          },
        },
        message: { type: 'string', example: 'Station ST001 skipped successfully' },
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Invalid request or station not ready for skip',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: false },
        message: { type: 'string', example: 'Station ST001 is not occupied or not ready for skip operation' },
        error: { type: 'string', example: 'Bad Request' },
      },
    },
  })
  @ApiNotFoundResponse({
    description: 'Station not found',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: false },
        message: { type: 'string', example: 'Station with ID ST001 not found' },
        error: { type: 'string', example: 'Not Found' },
      },
    },
  })
  @ApiConflictResponse({
    description: 'Station cannot be skipped',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: false },
        message: { type: 'string', example: "Can't skip - station ST001 is not occupied" },
        error: { type: 'string', example: 'Conflict' },
      },
    },
  })
  async skipStation(@Param('station_id') stationId: string) {
    try {
      const result = await this.triggerService.skipStationAction(stationId);
      return {
        success: true,
        data: result,
        message: `Station ${stationId} skipped successfully`,
      };
    } catch (error) {
      if (error.message.includes('not found')) {
        throw new HttpException(
          {
            success: false,
            message: error.message,
            error: 'Not Found',
          },
          HttpStatus.NOT_FOUND,
        );
      }
      if (error.message.includes("Can't skip")) {
        throw new HttpException(
          {
            success: false,
            message: error.message,
            error: 'Conflict',
          },
          HttpStatus.CONFLICT,
        );
      }
      throw new HttpException(
        {
          success: false,
          message: error.message || 'Failed to skip station',
          error: 'Bad Request',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Get('message-codes')
  @ApiOperation({
    summary: 'Get all message codes',
    description: 'Returns all possible message codes for station trigger actions.'
  })
  @ApiOkResponse({
    description: 'List of message codes',
    schema: {
      type: 'object',
      properties: {
        codes: {
          type: 'array',
          items: { type: 'string', enum: Object.values(MessageCode) },
          example: Object.values(MessageCode)
        }
      }
    }
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'operator')
  getMessageCodes() {
    return { codes: Object.values(MessageCode) };
  }
}
