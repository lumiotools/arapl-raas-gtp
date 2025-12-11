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
    async pauseTask(@Param('task_id') task_id: string) {
        return await this.taskService.pauseTask(task_id);
    }

    @Post('/:task_id/resume')
    async resumeTask(@Param('task_id') task_id: string) {
        return await this.taskService.resumeTask(task_id);
    }

}
