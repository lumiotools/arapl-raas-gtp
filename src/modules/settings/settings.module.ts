import { Module } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { SettingsController } from './settings.controller';
import { Settings } from 'src/entities/settings.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { Log, Task, TaskStatus } from 'src/entities';
import { Robot } from 'src/entities/robots.entity';
import { LoggingService } from 'src/services/logging.service';

@Module({
  imports: [TypeOrmModule.forFeature([Settings, Task, Robot, Log]),HttpModule],
  controllers: [SettingsController],
  providers: [SettingsService,LoggingService],
  exports: [SettingsService],
})
export class SettingsModule {}