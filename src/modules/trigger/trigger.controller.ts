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
import { Role } from 'src/entities/user.entity';

export enum MessageCode {
  SEND_TO_EMPTY_LOCATION = 'SEND_TO_EMPTY_LOCATION',
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
  @Roles(Role.FLOWOPS_ADMIN, Role.FLOWOPS_OPERATOR)
  async triggerStation(
    @Param('station_id') stationId: string,
    @Body() body: { dropped_quantity: number; message_code: MessageCode, robot_id?:string }
  ) {
    try {
      const result = await this.triggerService.triggerStationAction(stationId, body.message_code, body.robot_id);
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
  @Roles(Role.FLOWOPS_ADMIN, Role.FLOWOPS_OPERATOR)
  getMessageCodes() {
    return { codes: Object.values(MessageCode) };
  }
}
