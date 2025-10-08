import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { BaseopsTaskService } from './baseops_task.service';
import { JwtAuthGuard } from '../auth/guard/auth.guard';
import { RolesGuard } from '../auth/guard/roles.guard';
import { Roles } from '../auth/guard/roles.decorator';
import { Role } from 'src/entities/user.entity';

@Controller('baseops-task')
export class BaseopsTaskController {
  constructor(private readonly baseopsTaskService: BaseopsTaskService) {}

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
  findBatchTasksActivities(@Param('batch_id') batch_id: string, @Param('task_id') task_id: string) {
    return this.baseopsTaskService.findBatchTasksActivities(batch_id, task_id);
  }

  @Post(':id/cancel')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.BASEOPS_ADMIN)
  async cancelTask(@Param('id') id: string) {
    return this.baseopsTaskService.cancelTask(id);
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
