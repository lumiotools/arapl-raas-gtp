import { Module } from '@nestjs/common';
import { StationsService } from './stations.service';
import { StationsController } from './stations.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Station } from 'src/entities/station.entity'; // Import Station entity
import { GtpController } from '../gtp/gtp.controller';
import { GtpLocation } from 'src/entities';

@Module({
  imports: [TypeOrmModule.forFeature([Station, GtpLocation])], // Import Station entity
  controllers: [StationsController],
  providers: [StationsService],
})
export class StationsModule {}
