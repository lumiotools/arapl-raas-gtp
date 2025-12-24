import {
    Controller,
    Get,
    Post,
    Body,
    Patch,
    Param,
    Delete,
    HttpStatus,
    BadRequestException,
    UseGuards,
    Query,
    HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBody } from '@nestjs/swagger';
import { TaskService } from './tasks.service';
import {
    SuccessResponseDto,
    NotFoundResponseDto,
    ValidationErrorResponseDto,
    ConflictResponseDto
} from 'src/common/dto/common-responses.dto';
import { Roles } from '../auth/guard/roles.decorator';
import { JwtAuthGuard } from '../auth/guard/auth.guard';
import { RolesGuard } from '../auth/guard/roles.guard';
import { Role } from 'src/entities/user.entity';

@ApiTags('tasks')
@Controller('tasks')
export class TasksController {
    constructor(private readonly taskService: TaskService) { }

    @Post('/:task_id/pause')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({
        summary: 'Pause a task',
        description: 'Pauses the task with the specified task ID.'
    })
    @ApiParam({
        name: 'task_id',
        description: 'The unique identifier of the task to be paused',
        example: 'ae46809c-1802-401f-9f0f-377632bdc758'
    })
    @ApiResponse({
        status: HttpStatus.OK,
        description: 'Task paused successfully',
        schema: {
            example: {
                task_id: 'ae46809c-1802-401f-9f0f-377632bdc758',
                status: 'paused',
                message: 'Task paused successfully'
            }
        }
    })
    @ApiResponse({
        status: HttpStatus.NOT_FOUND,
        description: 'Task not found',
        type: NotFoundResponseDto
    })
    async pauseTask(@Param('task_id') task_id: string) {
        return await this.taskService.pauseTask(task_id);
    }

    @Post('/:task_id/resume')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({
        summary: 'Resume a paused task',
        description: 'Resumes the task with the specified task ID.'
    })
    @ApiParam({
        name: 'task_id',
        description: 'The unique identifier of the task to be resumed',
        example: 'ae46809c-1802-401f-9f0f-377632bdc758'
    })
    @ApiResponse({
        status: HttpStatus.OK,
        description: 'Task resumed successfully',
        schema: {
            example: {
                task_id: 'ae46809c-1802-401f-9f0f-377632bdc758',
                status: 'in_progress',
                message: 'Task resumed successfully'
            }
        }
    })
    @ApiResponse({
        status: HttpStatus.NOT_FOUND,
        description: 'Task not found',
        type: NotFoundResponseDto
    })
    async resumeTask(@Param('task_id') task_id: string) {
        return await this.taskService.resumeTask(task_id);
    }

}
