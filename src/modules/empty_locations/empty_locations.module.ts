import { Module } from '@nestjs/common';
import { EmptyLocationsService } from './empty_locations.service';
import { EmptyLocationsController } from './empty_locations.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EmptyLocation } from 'src/entities/empty-location.entity';
import { Inventory, Task } from 'src/entities';
import { InventoryModule } from '../inventory/inventory.module';
import { InventoryService } from '../inventory/inventory.service';

@Module({
  imports: [TypeOrmModule.forFeature([EmptyLocation, Inventory, Task]), InventoryModule],
  controllers: [EmptyLocationsController],
  providers: [EmptyLocationsService, InventoryService],
})
export class EmptyLocationsModule {}
