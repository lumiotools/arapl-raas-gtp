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
import { LocationEntity } from 'src/entities/location.entity';
import { BaseopsTaskModule } from '../baseops_task/baseops_task.module';
import { EmptyLocation } from 'src/entities/empty-location.entity';
import { CrossdockTaskModule } from '../crossdock_task/crossdock_task.module';
import { StationsService } from '../stations/stations.service';
import { StationsModule } from '../stations/stations.module';
import { InventoryModule } from '../inventory/inventory.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Batch, Task, Inventory, Station, WaitingLocation, Robot, RobotCount,LocationEntity, EmptyLocation]),
    HttpModule,
    forwardRef(() => OrchestratorModule),
    forwardRef(() => BaseopsTaskModule),
    forwardRef(() => CrossdockTaskModule),
    LoggingModule,
    StationsModule,
    InventoryModule
  ],
  controllers: [WebhookController],
  providers: [WebhookService, WaitingLocationService],
  exports: [WebhookService],
})
export class WebhookModule {}