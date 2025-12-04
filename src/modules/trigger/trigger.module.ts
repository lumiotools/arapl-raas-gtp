import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { TriggerController } from './trigger.controller';
import { TriggerService } from './trigger.service';
import { Station } from '../../entities/station.entity';
import { WaitingLocation } from '../../entities/waiting-location.entity';
import { Task } from '../../entities/task.entity';
import { OrchestratorModule } from '../orchestrator/orchestrator.module';
import { Inventory } from 'src/entities';
import { LoggingModule } from '../logging/logging.module';
import { User } from 'src/entities/user.entity';
import { StationsModule } from '../stations/stations.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Station, WaitingLocation, Task, Inventory,User]),
    forwardRef(() => OrchestratorModule),
    HttpModule,
    LoggingModule,
    StationsModule
  ],
  controllers: [TriggerController],
  providers: [TriggerService],
  exports: [TriggerService],
})
export class TriggerModule {}
