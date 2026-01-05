import { Controller, Get, Post, Body, Param, UseGuards, HttpStatus, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBody, ApiExtraModels, getSchemaPath } from '@nestjs/swagger';
import { CrossdockTaskService } from './crossdock_task.service';
import { JwtAuthGuard } from '../auth/guard/auth.guard';
import { RolesGuard } from '../auth/guard/roles.guard';
import { Roles } from '../auth/guard/roles.decorator';
import { Role } from 'src/entities/user.entity';
import { UploadTasksDto } from './dto/upload-tasks.dto';
import { BatchResponseDto } from '../baseops_task/dto/batch-response.dto';
import { TaskResponseDto } from '../baseops_task/dto/task-response.dto';
import { MovementActivityDto, WaitingActivityDto } from '../baseops_task/dto/activity-response.dto';
import { LocationEntityResponseDto } from '../baseops_task/dto/location-response.dto';
import { CancelTaskResponseDto } from './dto/cancel-task-response.dto';
import { PauseTaskResponseDto } from './dto/pause-task-response.dto';
import { ResumeTaskResponseDto } from './dto/resume-task-response.dto';
import { RetryTaskResponseDto } from './dto/retry-task-response.dto';
import { UploadTasksResponseDto } from './dto/upload-tasks-response.dto';
import {
  NotFoundResponseDto,
} from 'src/common/dto/common-responses.dto';
import { BadRequestDto } from '../orders/dto/error-responses.dto';

@ApiTags('CrossDock Tasks')
@ApiExtraModels(MovementActivityDto, WaitingActivityDto)
@Controller('crossdock-task')
export class CrossdockTaskController {
  constructor(private readonly crossdockTaskService: CrossdockTaskService) {}

  @Get('batch-tasks')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.CROSSDOCK_ADMIN)
  @ApiOperation({
    summary: 'Get all CrossDock batches',
    description: 'Retrieve a list of all CrossDock task batches ordered by creation date (newest first) with their status and task counts.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'List of all CrossDock batches',
    type: [BatchResponseDto],
  })
  findAllBatches() {
    return this.crossdockTaskService.findAllBatches();
  }

  @Get('batch-tasks/:batch_id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.CROSSDOCK_ADMIN)
  @ApiOperation({
    summary: 'Get tasks for a specific batch',
    description: 'Retrieve all tasks associated with a specific CrossDock batch ID.',
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
    return this.crossdockTaskService.findBatchTasks(batch_id);
  }

  @Get('batch-tasks/:batch_id/:task_id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.CROSSDOCK_ADMIN)
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
    return this.crossdockTaskService.findBatchTasksActivities(batch_id, task_id);
  }

  @Post(':id/cancel')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.CROSSDOCK_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel a CrossDock task',
    description: 'Cancel a specific CrossDock task by its task ID. The task must be in a cancellable state.',
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
    return this.crossdockTaskService.cancelTask(id);
  }

  @Post(':id/pause')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.CROSSDOCK_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Pause a CrossDock task',
    description: 'Pause a specific CrossDock task by its task ID. The task must be in PROCESSING or IN_PROGRESS status.',
  })
  @ApiParam({
    name: 'id',
    description: 'The unique identifier of the task to be paused',
    example: 'ae46809c-1802-401f-9f0f-377632bdc758',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Task paused successfully',
    type: PauseTaskResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Task not found',
    type: NotFoundResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Task cannot be paused in its current state or is already paused',
    type: BadRequestDto,
  })
  async pauseTask(@Param('id') id: string) {
    return this.crossdockTaskService.pauseTask(id);
  }

  @Post(':id/resume')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.CROSSDOCK_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Resume a paused CrossDock task',
    description: 'Resume a paused CrossDock task by its task ID. The task must be in a paused state.',
  })
  @ApiParam({
    name: 'id',
    description: 'The unique identifier of the task to be resumed',
    example: 'ae46809c-1802-401f-9f0f-377632bdc758',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Task resumed successfully',
    type: ResumeTaskResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Task not found',
    type: NotFoundResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Task is not paused or cannot be resumed',
    type: BadRequestDto,
  })
  async resumeTask(@Param('id') id: string) {
    return this.crossdockTaskService.resumeTask(id);
  }

  @Post(':id/retry')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.CROSSDOCK_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Retry a CrossDock task',
    description: 'Create a new task as a retry of the specified task. The original task will be cancelled and a new task with a new task_id will be created.',
  })
  @ApiParam({
    name: 'id',
    description: 'The unique identifier of the task to be retried',
    example: 'ae46809c-1802-401f-9f0f-377632bdc758',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Retry task created successfully',
    type: RetryTaskResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Task not found',
    type: NotFoundResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Task cannot be retried',
    type: BadRequestDto,
  })
  async retryTask(@Param('id') id: string) {
    return this.crossdockTaskService.retryTask(id);
  }

  @Post('set-configuration')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.CROSSDOCK_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Set initial CrossDock configuration',
    description: 'Initialize the CrossDock module configuration including robot counters and system settings. This should be called once during system setup.',
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
    return this.crossdockTaskService.setInitialConfiguration();
  }

  @Post('tasks/upload')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.CROSSDOCK_ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Upload and process CrossDock tasks',
    description: 'Upload an array of CrossDock tasks to be processed. Each task must have valid start and end locations. Tasks are validated before processing, and duplicates are not allowed. Supports partial pick scenarios with automatic wait location assignment.',
  })
  @ApiBody({ type: UploadTasksDto })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Tasks processed and created successfully',
    type: UploadTasksResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Validation errors in task data (duplicate locations, invalid location types, zone pair issues, etc.)',
    type: BadRequestDto,
  })
  async scheduleTasks(@Body() body: UploadTasksDto) {
    return await this.crossdockTaskService.processTasks(body.tasks, body.priority);
  }


  @Get('manual-task/start-location')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.CROSSDOCK_ADMIN)
  @ApiOperation({
    summary: 'Get available start locations for manual tasks',
    description: 'Retrieve a list of available start locations (PALLET type) that can be used for creating manual CrossDock tasks.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'List of available start locations with parent relation',
    type: [LocationEntityResponseDto],
  })
  async getManualTaskStartLocation() {
    return await this.crossdockTaskService.getManualTaskStartLocation();
  }

  @Get('manual-task/end-location')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.CROSSDOCK_ADMIN)
  @ApiOperation({
    summary: 'Get available end locations for manual tasks',
    description: 'Retrieve a list of available end locations (PALLET type) that can be used for creating manual CrossDock tasks.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'List of available end locations with parent relation',
    type: [LocationEntityResponseDto],
  })
  async getManualTaskEndLocation() {
    return this.crossdockTaskService.getManualTaskEndLocation();
  }

}
