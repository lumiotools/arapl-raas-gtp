import { DynamicModule, Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { TaskService } from './tasks.service';
import { LocationManagerService } from './location_manager.service';
import { Task, Batch } from 'src/entities';
import { ZonePairConfig } from 'src/entities/zone-pair-config.entity';
import { RobotCount } from 'src/entities/robot-count.entity';
import { LocationEntity } from 'src/entities/location.entity';
import { TASK_CONFIG } from './constants';
import { WebhookModule } from '../webhook/webhook.module';
import { LoggingModule } from '../logging/logging.module';
import { OperationType } from 'src/entities/robot-count.entity';
import { Robot } from 'src/entities/robots.entity';

@Module({})
export class TasksModule {
  static forOperation(operationType: OperationType): DynamicModule {
    return {
      module: TasksModule,
      imports: [
        TypeOrmModule.forFeature([Task, Batch, RobotCount, LocationEntity, ZonePairConfig, Robot]),
        HttpModule,
        forwardRef(() => WebhookModule),
        LoggingModule,
      ],
      providers: [
        TaskService,
        LocationManagerService,
        { provide: TASK_CONFIG, useValue: { operationType } },
      ],
      exports: [TaskService, LocationManagerService],
    };
  }
}
