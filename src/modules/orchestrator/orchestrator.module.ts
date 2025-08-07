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
      ScheduleMapping
    ]),
    HttpModule,
    InventoryModule,
  ],
  controllers: [OrchestratorController],
  providers: [OrchestratorService, StationsService, WaitingLocationService],
  exports: [OrchestratorService],
})
export class OrchestratorModule {}
