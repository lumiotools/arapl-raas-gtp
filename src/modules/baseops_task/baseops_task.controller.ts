import { Controller, Get, Post, Body, Param, UseGuards, HttpStatus, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBody, ApiExtraModels, getSchemaPath } from '@nestjs/swagger';
import { BaseopsTaskService } from './baseops_task.service';
import { JwtAuthGuard } from '../auth/guard/auth.guard';
import { RolesGuard } from '../auth/guard/roles.guard';
import { Roles } from '../auth/guard/roles.decorator';
import { Role } from 'src/entities/user.entity';
import { UploadTasksDto } from './dto/upload-tasks.dto';
import { BatchResponseDto } from './dto/batch-response.dto';
import { TaskResponseDto } from './dto/task-response.dto';
import { MovementActivityDto, WaitingActivityDto } from './dto/activity-response.dto';
import { LocationEntityResponseDto } from './dto/location-response.dto';
import { CancelTaskResponseDto } from './dto/cancel-task-response.dto';
import { UploadTasksResponseDto } from './dto/upload-tasks-response.dto';
import {
  SuccessResponseDto,
  NotFoundResponseDto,
} from 'src/common/dto/common-responses.dto';
import { BadRequestDto } from '../orders/dto/error-responses.dto';

@ApiTags('BaseOps Tasks')
@Controller('baseops-task')
export class BaseopsTaskController {
  constructor(private readonly baseopsTaskService: BaseopsTaskService) {}

  @Get('batch-tasks')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BASEOPS_ADMIN)
  @ApiOperation({
    summary: 'Get all BaseOps batches',
    description: 'Retrieve a list of all BaseOps task batches ordered by creation date (newest first) with their status and task counts.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'List of all BaseOps batches',
    type: [BatchResponseDto],
  })
  findAllBatches() {
    return this.baseopsTaskService.findAllBatches();
  }

  @Get('batch-tasks/:batch_id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BASEOPS_ADMIN)
  @ApiOperation({
    summary: 'Get tasks for a specific batch',
    description: 'Retrieve all tasks associated with a specific BaseOps batch ID.',
  })
  @ApiParam({
    name: 'batch_id',
    description: 'The unique identifier of the batch',
    example: 'BO_19122025_4',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'List of tasks in the batch',
    type: [TaskResponseDto],
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Batch not found',
    type: NotFoundResponseDto,
  })
  findBatchTasks(@Param('batch_id') batch_id: string) {
    return this.baseopsTaskService.findBatchTasks(batch_id);
  }

  @Get('batch-tasks/:batch_id/:task_id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BASEOPS_ADMIN)
  @ApiOperation({
    summary: 'Get activities for a specific task',
    description: 'Retrieve all activities (movements and waiting periods) associated with a specific task in a batch.',
  })
  @ApiParam({
    name: 'batch_id',
    description: 'The unique identifier of the batch',
    example: 'BO_19122025_4',
  })
  @ApiParam({
    name: 'task_id',
    description: 'The unique identifier of the task',
    example: '81134147-4221-423a-bd5c-dbb13c0ade05',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'List of activities for the task. Can contain both MOVEMENT activities (with move_type, robot_id, robot_name, start_time, end_time) and WAITING activities (with activity_reason, created_at, updated_at, inqueue, processing, completed, triggered).',
    schema: {
      type: 'array',
      items: {
        oneOf: [
          { $ref: getSchemaPath(MovementActivityDto) },
          { $ref: getSchemaPath(WaitingActivityDto) },
        ],
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Batch or task not found',
    type: NotFoundResponseDto,
  })
  findBatchTasksActivities(@Param('batch_id') batch_id: string, @Param('task_id') task_id: string) {
    return this.baseopsTaskService.findBatchTasksActivities(batch_id, task_id);
  }

  @Post(':id/cancel')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BASEOPS_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel a BaseOps task',
    description: 'Cancel a specific BaseOps task by its task ID. The task must be in a cancellable state.',
  })
  @ApiParam({
    name: 'id',
    description: 'The unique identifier of the task to be cancelled',
    example: 'c95332ff-322d-4262-85b3-283ff9bc4a75',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Task cancelled successfully',
    type: CancelTaskResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Task not found',
    type: NotFoundResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Task not found or cannot be cancelled in its current state',
    type: BadRequestDto,
  })
  async cancelTask(@Param('id') id: string) {
    return this.baseopsTaskService.cancelTask(id);
  }

  @Post('set-configuration')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BASEOPS_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Set initial BaseOps configuration',
    description: 'Initialize the BaseOps module configuration including robot counters and system settings. This should be called once during system setup.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Configuration set successfully',
    schema: {
      type: 'object',
      properties: {},
    },
  })
  setConfiguration() {
    return this.baseopsTaskService.setInitialConfiguration();
  }

  @Post('tasks/upload')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BASEOPS_ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Upload and process BaseOps tasks',
    description: 'Upload an array of BaseOps tasks to be processed. Each task must have valid start and end locations. Tasks are validated before processing, and duplicates are not allowed.',
  })
  @ApiBody({ type: UploadTasksDto })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Tasks processed and created successfully',
    type: UploadTasksResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Validation errors in task data (duplicate locations, invalid location types, etc.)',
    type: BadRequestDto,
  })
  async scheduleTasks(@Body() body: UploadTasksDto) {
    return await this.baseopsTaskService.processTasks(body.tasks, body.priority);
  }


  @Get('manual-task/start-location')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BASEOPS_ADMIN)
  @ApiOperation({
    summary: 'Get available start locations for manual tasks',
    description: 'Retrieve a list of available start locations (PALLET type) that can be used for creating manual BaseOps tasks.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'List of available start locations with parent relation',
    type: [LocationEntityResponseDto],
  })
  async getManualTaskStartLocation() {
    return await this.baseopsTaskService.getManualTaskStartLocation();
  }

  @Get('manual-task/end-location')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BASEOPS_ADMIN)
  @ApiOperation({
    summary: 'Get available end locations for manual tasks',
    description: 'Retrieve a list of available end locations (PALLET type) that can be used for creating manual BaseOps tasks.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'List of available end locations with parent relation',
    type: [LocationEntityResponseDto],
  })
  async getManualTaskEndLocation() {
    return this.baseopsTaskService.getManualTaskEndLocation();
  }

}
