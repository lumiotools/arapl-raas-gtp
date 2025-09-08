import { Module } from '@nestjs/common';
import { BaseopsTaskService } from './baseops_task.service';
import { BaseopsTaskController } from './baseops_task.controller';

@Module({
  controllers: [BaseopsTaskController],
  providers: [BaseopsTaskService],
})
export class BaseopsTaskModule {}
