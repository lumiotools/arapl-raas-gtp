import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WaitingLocation } from 'src/entities/waiting-location.entity'; // Import WaitingLocation entity
import { WaitingLocationService } from './waiting_location.service';
import { WaitingLocationController } from './waiting_location.controller';

@Module({
  imports: [TypeOrmModule.forFeature([WaitingLocation])], // Import WaitingLocation entity
  controllers: [WaitingLocationController],
  providers: [WaitingLocationService],
})
export class WaitingLocationModule {}
