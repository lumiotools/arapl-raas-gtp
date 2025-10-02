import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { OrchestratorService } from './orchestrator.service';
import { OrchestratorController } from './orchestrator.controller';
import { OrderItem } from 'src/entities/order-item.entity';
import { Task } from 'src/entities/task.entity';
import { Batch } from 'src/entities/batch.entity';
import { Inventory } from 'src/entities/inventory.entity';
import { Station } from 'src/entities/station.entity';
import { WaitingLocation } from 'src/entities/waiting-location.entity';
import { GtpLocation } from 'src/entities/gtp-location.entity';
import { ProductRequirement } from 'src/entities/product-requirement.entity';
import { InventoryModule } from '../inventory/inventory.module';
import { User } from 'src/entities/user.entity';
import { StationsService } from '../stations/stations.service';
import { ScheduleMapping } from 'src/entities/schedule_mapping.entity';
import { WaitingLocationService } from '../waiting_location/waiting_location.service';
import { Robot } from 'src/entities';
import { BaseopsTaskService } from '../baseops_task/baseops_task.service';
import { LocationEntity } from 'src/entities/location.entity';
import { BaseopsTaskModule } from '../baseops_task/baseops_task.module';
import { BaseOpsLocationManagerService } from '../baseops_task/location_manager.service';
import { EmptyLocation } from 'src/entities/empty-location.entity';
import { EmptyLocationsService } from '../empty_locations/empty_locations.service';
import { EmptyLocationsModule } from '../empty_locations/empty_locations.module';
import { Settings } from 'src/entities/settings.entity';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      OrderItem,
      Task,
      Batch,
      Inventory,
      Station,
      WaitingLocation,
      GtpLocation,
      ProductRequirement,
      User,
      Station,
      Robot,
      ScheduleMapping,
      LocationEntity,
      EmptyLocation,
      Settings,
    ]),
    HttpModule,
    InventoryModule,
    BaseopsTaskModule,
    EmptyLocationsModule,
    SettingsModule,
  ],
  controllers: [OrchestratorController],
  providers: [OrchestratorService, StationsService, WaitingLocationService, BaseopsTaskService, BaseopsTaskService, BaseOpsLocationManagerService, EmptyLocationsService],
  exports: [OrchestratorService],
})
export class OrchestratorModule {}
