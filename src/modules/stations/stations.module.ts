import { Module } from '@nestjs/common';
import { StationsService } from './stations.service';
import { StationsController } from './stations.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Station } from 'src/entities/station.entity'; // Import Station entity
import { GtpController } from '../gtp/gtp.controller';
import { GtpLocation, OrderItem, ProductRequirement } from 'src/entities';
import { User } from 'src/entities/user.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Station, GtpLocation,ProductRequirement, OrderItem, User])], // Import Station entity
  controllers: [StationsController],
  providers: [StationsService],
})
export class StationsModule {}
