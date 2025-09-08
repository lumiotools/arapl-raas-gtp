import { Module } from '@nestjs/common';
import { BaseopsTaskService } from './baseops_task.service';
import { BaseopsTaskController } from './baseops_task.controller';
import { OrchestratorService } from '../orchestrator/orchestrator.service';
import { OrchestratorModule } from '../orchestrator/orchestrator.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Task } from 'src/entities';
import { Batch } from 'src/entities/batch.entity';
import { User } from 'src/entities/user.entity';
import { HeapPriorityQueueService } from './heap.service';
import { HttpModule } from '@nestjs/axios';

@Module({
  imports:[ TypeOrmModule.forFeature([Task, Batch,User]) ,OrchestratorModule,HttpModule],
  controllers: [BaseopsTaskController],
  providers: [BaseopsTaskService, HeapPriorityQueueService],
})
export class BaseopsTaskModule {}
