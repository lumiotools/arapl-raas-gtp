import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TriggerController } from './trigger.controller';
import { TriggerService } from './trigger.service';
import { Station } from '../../entities/station.entity';
import { Task } from '../../entities/task.entity';
import { OrchestratorModule } from '../orchestrator/orchestrator.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Station, Task]),
    OrchestratorModule,
  ],
  controllers: [TriggerController],
  providers: [TriggerService],
  exports: [TriggerService],
})
export class TriggerModule {}
