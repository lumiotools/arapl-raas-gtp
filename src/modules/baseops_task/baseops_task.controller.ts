import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseInterceptors, UploadedFile, UseGuards } from '@nestjs/common';
import { BaseopsTaskService } from './baseops_task.service';
import { CreateBaseopsTaskDto } from './dto/create-baseops_task.dto';
import { UpdateBaseopsTaskDto } from './dto/update-baseops_task.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/guard/auth.guard';
import { RolesGuard } from '../auth/guard/roles.guard';
import { Roles } from '../auth/guard/roles.decorator';
import { Role } from 'src/entities/user.entity';

@Controller('baseops-task')
export class BaseopsTaskController {
  constructor(private readonly baseopsTaskService: BaseopsTaskService) {}

  @Post()
  create(@Body() createBaseopsTaskDto: CreateBaseopsTaskDto) {
    return this.baseopsTaskService.create(createBaseopsTaskDto);
  }
  
  @Post('upload-tasks')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BASEOPS_ADMIN)
  @UseInterceptors(FileInterceptor('file'))
  async uploadTasks(@UploadedFile() file: Express.Multer.File, @Query('priority') priority: string) {
    try {
      const priorityNum = priority ? +priority : 1; // Default to 1 if not provided
      const csvData = file.buffer.toString('utf-8');
      // const result = await this.baseopsTaskService.processCsvTasks(csvData, priorityNum);
      const tasks = await this.baseopsTaskService.parseCsv(csvData);
      const result = await this.baseopsTaskService.processTasks(tasks, priorityNum);
      return {
        success: true,
        message: 'All tasks processed successfully',
        data: result
      };
    } catch (error) {
      return {
        success: false,
        message: error.message || 'Failed to process CSV tasks'
      };
    }
  }

  @Get('batch-tasks')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BASEOPS_ADMIN)
  findAllBatches() {
    return this.baseopsTaskService.findAllBatches();
  }

  @Get('batch-tasks/:batch_id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BASEOPS_ADMIN)
  findBatchTasks(@Param('batch_id') batch_id: string) {
    return this.baseopsTaskService.findBatchTasks(batch_id);
  }

  @Get('batch-tasks/:batch_id/:task_id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BASEOPS_ADMIN)
  findBatchTasksSubtasks(@Param('batch_id') batch_id: string, @Param('task_id') task_id: string) {
    return this.baseopsTaskService.findBatchTasksSubtasks(batch_id, task_id);
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BASEOPS_ADMIN)
  findAll() {
    return this.baseopsTaskService.findAll();
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BASEOPS_ADMIN)
  findOne(@Param('id') id: string) {
    return this.baseopsTaskService.findOne(+id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BASEOPS_ADMIN)
  update(@Param('id') id: string, @Body() updateBaseopsTaskDto: UpdateBaseopsTaskDto) {
    return this.baseopsTaskService.update(+id, updateBaseopsTaskDto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BASEOPS_ADMIN)
  remove(@Param('id') id: string) {
    return this.baseopsTaskService.remove(+id);
  }

  @Post('set-configuration')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BASEOPS_ADMIN)
  setConfiguration() {
    return this.baseopsTaskService.setInitialConfiguration();
  }

  @Post('tasks/upload')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BASEOPS_ADMIN)
  async scheduleTasks(@Body()body: any){
    return await this.baseopsTaskService.processTasks(body.tasks, body.priority);
  }


  @Get('manual-task/start-location')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BASEOPS_ADMIN)
  async getManualTaskStartLocation() {
    return await this.baseopsTaskService.getManualTaskStartLocation();
  }

  @Get('manual-task/end-location')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BASEOPS_ADMIN)
  async getManualTaskEndLocation() {
    return this.baseopsTaskService.getManualTaskEndLocation();
  }

}
