import { Controller, Get, Post, Body, Patch, Param, Delete, Query } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { CreateSettingDto } from './dto/create-setting.dto';
import { UpdateSettingDto } from './dto/update-setting.dto';
import { TaskType } from 'src/entities';
import { RobotStatus } from 'src/entities/robots.entity';
import { OperationType } from 'src/entities/robot-count.entity';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Post()
  create(@Body() createSettingDto: CreateSettingDto) {
    return this.settingsService.create(createSettingDto);
  }

  @Get('robots')
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

  @Get()
  async findAll() {
    return await this.settingsService.findAll();
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateSettingDto: UpdateSettingDto) {
    return this.settingsService.update(+id, updateSettingDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.settingsService.remove(+id);
  }

  @Patch(':robot_id/update')
  async makeRobotOffline(@Param('robot_id') robotId: string, @Body() body: { status: RobotStatus, reason: string|null }) {
    return await this.settingsService.updateRobot(robotId, body.status, body.reason);
  }
  
}
