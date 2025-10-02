import { Controller, Get, Post, Body, Patch, Param, Delete, Query } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { CreateSettingDto } from './dto/create-setting.dto';
import { UpdateSettingDto } from './dto/update-setting.dto';
import { TaskType } from 'src/entities';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Post()
  create(@Body() createSettingDto: CreateSettingDto) {
    return this.settingsService.create(createSettingDto);
  }

  @Get('robots')
  async findAllRobots(@Query() task_type: TaskType) {
    console.log('reached controller');
    return await this.settingsService.findAllRobots(task_type);
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

  @Patch(':robot_id/offline')
  async makeRobotOffline(@Param('robot_id') robotId: string) {
    return await this.settingsService.makeRobotOffline(robotId);
  }
  
}
