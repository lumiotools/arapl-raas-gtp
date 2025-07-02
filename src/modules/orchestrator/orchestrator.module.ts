import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { OrchestratorService } from './orchestrator.service';
import { OrchestratorController } from './orchestrator.controller';
import { OrderItem } from 'src/entities/order-item.entity';
import { Task } from 'src/entities/task.entity';
import { Batch } from 'src/entities/batch.entity';
import { Inventory } from 'src/entities/inventory.entity';
import { Station } from 'src/entities/station.entity';
import { GtpLocation } from 'src/entities/gtp-location.entity';
import { InventoryModule } from '../inventory/inventory.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      OrderItem,
      Task,
      Batch,
      Inventory,
      Station,
      GtpLocation,
    ]),
    ScheduleModule.forRoot(),
    InventoryModule,
  ],
  controllers: [OrchestratorController],
  providers: [OrchestratorService],
  exports: [OrchestratorService],
})
export class OrchestratorModule {}
