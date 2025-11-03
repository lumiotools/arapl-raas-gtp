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
import { Robot } from 'src/entities/robots.entity';
import { RobotCount } from 'src/entities';
import { BaseOpsLocationManagerService } from '../baseops_task/location_manager.service';
import { LocationEntity } from 'src/entities/location.entity';
import { BaseopsTaskService } from '../baseops_task/baseops_task.service';
import { EmptyLocation } from 'src/entities/empty-location.entity';
import { InventoryModule } from '../inventory/inventory.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Batch, Task, Inventory, Station, WaitingLocation, Robot, RobotCount,LocationEntity, EmptyLocation]),
    HttpModule,
    forwardRef(() => OrchestratorModule),
    LoggingModule,
    InventoryModule
  ],
  controllers: [WebhookController],
  providers: [WebhookService, WaitingLocationService, BaseOpsLocationManagerService, BaseopsTaskService],
  exports: [WebhookService],
})
export class WebhookModule {}
