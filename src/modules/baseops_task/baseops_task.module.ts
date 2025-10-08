import { forwardRef, Module } from '@nestjs/common';
import { BaseopsTaskService } from './baseops_task.service';
import { BaseopsTaskController } from './baseops_task.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RobotCount, Task } from 'src/entities';
import { Batch } from 'src/entities/batch.entity';
import { User } from 'src/entities/user.entity';
import { HttpModule } from '@nestjs/axios';
import { LocationEntity } from 'src/entities/location.entity';
import { LocationsModule } from '../locations/locations.module';
import { WebhookModule } from '../webhook/webhook.module';
import { TasksModule } from '../tasks/tasks.module';
import { OperationType } from 'src/entities/robot-count.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Task, Batch, User, LocationEntity, RobotCount]),
    HttpModule,
    LocationsModule,
    forwardRef(() => WebhookModule),
    // Import the TasksModule configured for BASEOPS
    TasksModule.forOperation(OperationType.BASEOPS),
  ],
  controllers: [BaseopsTaskController],
  providers: [BaseopsTaskService],
  exports: [BaseopsTaskService],
})
export class BaseopsTaskModule {}
