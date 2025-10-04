import { forwardRef, Module } from '@nestjs/common';
import { BaseopsTaskService } from './baseops_task.service';
import { BaseopsTaskController } from './baseops_task.controller';
import { OrchestratorService } from '../orchestrator/orchestrator.service';
import { OrchestratorModule } from '../orchestrator/orchestrator.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Robot, Task } from 'src/entities';
import { Batch } from 'src/entities/batch.entity';
import { User } from 'src/entities/user.entity';
import { HttpModule } from '@nestjs/axios';
import { BaseOpsLocationManagerService } from './location_manager.service';
import { LocationEntity } from 'src/entities/location.entity';
import { LocationsModule } from '../locations/locations.module';
import { WebhookModule } from '../webhook/webhook.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Task, Batch, User, LocationEntity, Robot, Task]),
    HttpModule,
    LocationsModule,
    forwardRef(() => WebhookModule),
  ],
  controllers: [BaseopsTaskController],
  providers: [BaseopsTaskService, BaseOpsLocationManagerService],
})
export class BaseopsTaskModule {}
