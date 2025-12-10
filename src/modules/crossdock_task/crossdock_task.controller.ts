import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { CrossdockTaskService } from './crossdock_task.service';
import { JwtAuthGuard } from '../auth/guard/auth.guard';
import { RolesGuard } from '../auth/guard/roles.guard';
import { Roles } from '../auth/guard/roles.decorator';
import { Role } from 'src/entities/user.entity';

@Controller('crossdock-task')
export class CrossdockTaskController {
  constructor(private readonly crossdockTaskService: CrossdockTaskService) {}

  @Get('batch-tasks')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.CROSSDOCK_ADMIN)
  findAllBatches() {
    return this.crossdockTaskService.findAllBatches();
  }

  @Get('batch-tasks/:batch_id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.CROSSDOCK_ADMIN)
  findBatchTasks(@Param('batch_id') batch_id: string) {
    return this.crossdockTaskService.findBatchTasks(batch_id);
  }

  @Get('batch-tasks/:batch_id/:task_id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.CROSSDOCK_ADMIN)
  findBatchTasksActivities(@Param('batch_id') batch_id: string, @Param('task_id') task_id: string) {
    return this.crossdockTaskService.findBatchTasksActivities(batch_id, task_id);
  }

  @Post(':id/cancel')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.CROSSDOCK_ADMIN)
  async cancelTask(@Param('id') id: string) {
    return this.crossdockTaskService.cancelTask(id);
  }

  @Post(':id/pause')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.CROSSDOCK_ADMIN)
  async pauseTask(@Param('id') id: string) {
    return this.crossdockTaskService.pauseTask(id);
  }

  @Post(':id/resume')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.CROSSDOCK_ADMIN)
  async resumeTask(@Param('id') id: string) {
    return this.crossdockTaskService.resumeTask(id);
  }

  @Post('set-configuration')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.CROSSDOCK_ADMIN)
  setConfiguration() {
    return this.crossdockTaskService.setInitialConfiguration();
  }

  @Post('tasks/upload')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.CROSSDOCK_ADMIN)
  async scheduleTasks(@Body()body: any){
    return await this.crossdockTaskService.processTasks(body.tasks, body.priority);
  }


  @Get('manual-task/start-location')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.CROSSDOCK_ADMIN)
  async getManualTaskStartLocation() {
    return await this.crossdockTaskService.getManualTaskStartLocation();
  }

  @Get('manual-task/end-location')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.CROSSDOCK_ADMIN)
  async getManualTaskEndLocation() {
    return this.crossdockTaskService.getManualTaskEndLocation();
  }

}
