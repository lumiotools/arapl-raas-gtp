import { Module } from '@nestjs/common';
import { EmptyLocationsService } from './empty_locations.service';
import { EmptyLocationsController } from './empty_locations.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EmptyLocation } from 'src/entities/empty-location.entity';

@Module({
  imports: [TypeOrmModule.forFeature([EmptyLocation])],
  controllers: [EmptyLocationsController],
  providers: [EmptyLocationsService],
})
export class EmptyLocationsModule {}
