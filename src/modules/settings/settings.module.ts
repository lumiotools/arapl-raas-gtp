import { Module } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { SettingsController } from './settings.controller';
import { Settings } from 'src/entities/settings.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { Inventory, Log, RobotCount, Station, Task, TaskStatus, WaitingLocation } from 'src/entities';
import { Robot } from 'src/entities/robots.entity';
import { LoggingService } from 'src/services/logging.service';
import { EmptyLocation } from 'src/entities/empty-location.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Settings, Task,Station, Inventory, EmptyLocation, WaitingLocation, Robot, Log, RobotCount]),HttpModule],
  controllers: [SettingsController],
  providers: [SettingsService,LoggingService],
  exports: [SettingsService],
})
export class SettingsModule {}
