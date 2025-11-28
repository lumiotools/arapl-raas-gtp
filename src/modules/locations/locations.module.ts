import { Module } from '@nestjs/common';
import { LocationsService } from './locations.service';
import { LocationsController } from './locations.controller';
import { Type } from 'class-transformer';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LocationEntity } from 'src/entities/location.entity';
import { Task } from 'src/entities';
import { ZonePairConfig } from 'src/entities/zone-pair-config.entity';
import { LocationManagerService } from '../tasks/location_manager.service';

@Module({
  imports: [TypeOrmModule.forFeature([LocationEntity, Task, ZonePairConfig])],
  controllers: [LocationsController],
  providers: [LocationsService, LocationManagerService],
})
export class LocationsModule {}
