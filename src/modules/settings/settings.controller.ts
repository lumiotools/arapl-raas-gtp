import { Controller, Get, Post, Body, Patch, Param, Delete, Query, HttpCode } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { CreateSettingDto } from './dto/create-setting.dto';
import { UpdateSettingDto } from './dto/update-setting.dto';
import { TaskType } from 'src/entities';
import { RobotStatus } from 'src/entities/robots.entity';
import { OperationType } from 'src/entities/robot-count.entity';
import { ApiBody, ApiOperation, ApiParam, ApiQuery, ApiResponse } from '@nestjs/swagger';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get('robots')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Get all robots by operation type',
    description: 'Retrieves a list of all robots filtered by the specified operation type.'
  })
  @ApiQuery({
    name: 'operation_type',
    required: true,
    description: 'The operation type to filter robots (FLOWOPS, BASEOPS, CROSSDOCK). Defaults to FLOWOPS if not provided.',
    example: 'FLOWOPS'
  })
  @ApiResponse({
    status: 200,
    description: 'List of robots',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', example: 'MAIA-001' },
          robot_name: { type: 'string', example: 'MAIA-001' },
          status: { type: 'string', example: 'in_use' },
          travel_status: { type: 'string', example: 'REACHED Station 1' },
          current_status_time: { type: 'number', example: 5092.132 },
          reason: { anyOf: [{ type: 'string' }, { type: 'null' }], example: null },
          is_paused: { type: 'boolean', example: false }
        }
      }
    }
  })
  async getAllRobots(@Query('operation_type') operation_type: OperationType = OperationType.FLOWOPS) {
    let task_type: TaskType;
    if (operation_type === OperationType.FLOWOPS)
      task_type = TaskType.GOODS_TO_PERSON;
    else if (operation_type === OperationType.BASEOPS)
      task_type = TaskType.BASEOPS;
    else if (operation_type === OperationType.CROSSDOCK)
      task_type = TaskType.CROSSDOCK;
    else
      throw new Error('Invalid operation type');

    return await this.settingsService.getAllRobots(task_type);
  }

  @Get('robots/InUse')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Get all robots currently in use by task type', 
    description: 'Retrieves the count of all robots currently in use for the specified task type.'
  })
  @ApiQuery({
    name: 'task_type',
    required: true,
    description: 'The task type to filter robots (BASEOPS, GOODS_TO_PERSON, CROSSDOCK). Defaults to GOODS_TO_PERSON if not provided.',
    example: 'GoodsToPerson'
  })
  @ApiResponse({
    status: 200,
    description: 'Robots in use count',
    schema: {
      type: 'object',
      properties: {
        total_robots: { type: 'number', example: 20 },
        robot_in_use: { type: 'number', example: 5 },
        is_waiting: { type: 'boolean', example: false }
      }
    }
  })
  async getAllRobotsInUse(@Query() task_type: TaskType) {
    return await this.settingsService.getAllRobotsInUse(task_type);
  }

  @Get()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Get all settings',
    description: 'Retrieves a list of all settings.'
  })
  @ApiResponse({
    status: 200,
    description: 'List of settings',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          operation_type: { type: 'string' },
          value: {
            type: 'object',
            additionalProperties: {
              anyOf: [
                { type: 'string' },
                { type: 'number' },
                { type: 'boolean' },
                { type: 'null' }
              ]
            }
          },
          created_at: { anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] },
          updated_at: { type: 'string', format: 'date-time' }
        }
      }
    }
  })
  async findAll() {
    return await this.settingsService.findAll();
  }
  @Patch('update-auto-start')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Update auto start setting',
    description: 'Updates the auto start setting value.'
  })
  @ApiBody({ schema: {
    type: 'object',
    properties: {
      auto_start: { type: 'number', example: 1 }
    },
    required: ['auto_start']
  }})
  @ApiResponse({
    status: 200,
    description: 'Auto start setting updated successfully',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Auto start setting updated to 1' }
      }
    }
  })
  async updateAutoStart(@Body() body: { auto_start: number }) {
    return await this.settingsService.updateAutoStart(body.auto_start);
  }
  @Patch('update-task-allocation-strategy')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Update task allocation strategy',
    description: 'Updates the task allocation strategy setting value.'
  })
  @ApiBody({ schema: {  
    type: 'object',
    properties: {
      task_allocation_strategy: { type: 'string', example: 'ROUND_ROBIN' }
    },
    required: ['task_allocation_strategy']
  }})
  @ApiResponse({
    status: 200,
    description: 'Task allocation strategy updated successfully',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Task allocation strategy updated to ROUND_ROBIN' }
      }
    }
  })
  async updateTaskAllocationStrategy(@Body() body: { task_allocation_strategy: string }) {
    return await this.settingsService.updateTaskAllocationStrategy(body.task_allocation_strategy);
  }

  @Patch(':robot_id/update')
  @ApiOperation({
    summary: 'Update robot status',
    description: 'Updates the status of a robot by its ID.'
  })
  @ApiParam({ name: 'robot_id', description: 'Robot ID', example: 'RB001' })
  @ApiBody({ schema: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: Object.values(RobotStatus) },
      reason: { type: 'string' }
    },
    required: ['status']
  }})
  @ApiResponse({
    status: 200,
    description: 'Robot status updated successfully',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Robot RB001 is now OFFLINE' }
      }
    }
  })
  async makeRobotOffline(@Param('robot_id') robotId: string, @Body() body: { status: RobotStatus, reason: string|null }) {
    return await this.settingsService.updateRobot(robotId, body.status, body.reason);
  }
  
}
