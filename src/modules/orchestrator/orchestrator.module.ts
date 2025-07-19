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
import { StationRequest } from 'src/entities/station-request.entity';
import { ProductRequirement } from 'src/entities/product-requirement.entity';
import { InventoryModule } from '../inventory/inventory.module';
import { User } from 'src/entities/user.entity';
import { StationsService } from '../stations/stations.service';

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
      StationRequest,
      ProductRequirement,
      User,
      Station
    ]),
    HttpModule,
    InventoryModule,
  ],
  controllers: [OrchestratorController],
  providers: [OrchestratorService, StationsService],
  exports: [OrchestratorService],
})
export class OrchestratorModule {}
