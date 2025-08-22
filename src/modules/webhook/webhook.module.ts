import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';
import { Batch } from 'src/entities/batch.entity';
import { Task } from 'src/entities/task.entity';
import { Inventory } from 'src/entities/inventory.entity';
import { Station } from 'src/entities/station.entity';
import { WaitingLocation } from 'src/entities/waiting-location.entity';
import { OrchestratorModule } from '../orchestrator/orchestrator.module';
import { LoggingModule } from '../logging/logging.module';
import { WaitingLocationService } from '../waiting_location/waiting_location.service';
import { Robot } from 'src/entities';

@Module({
  imports: [
    TypeOrmModule.forFeature([Batch, Task, Inventory, Station, WaitingLocation, Robot]),
    HttpModule,
    forwardRef(() => OrchestratorModule),
    LoggingModule,
  ],
  controllers: [WebhookController],
  providers: [WebhookService, WaitingLocationService],
  exports: [WebhookService],
})
export class WebhookModule {}
