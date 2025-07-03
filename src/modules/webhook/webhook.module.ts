import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';
import { Batch } from 'src/entities/batch.entity';
import { Task } from 'src/entities/task.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Batch, Task]),
  ],
  controllers: [WebhookController],
  providers: [WebhookService],
  exports: [WebhookService],
})
export class WebhookModule {}
