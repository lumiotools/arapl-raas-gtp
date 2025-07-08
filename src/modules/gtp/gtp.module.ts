import { Module } from '@nestjs/common';
import { GtpService } from './gtp.service';
import { GtpController } from './gtp.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GtpLocation } from 'src/entities/gtp-location.entity'; // Import GtpLocation entity
import { Station } from 'src/entities/station.entity';
import { OrderItem, OrderItemStatus } from 'src/entities/order-item.entity';
@Module({
  imports: [TypeOrmModule.forFeature([GtpLocation, Station, OrderItem])], // Import GtpLocation entity
  controllers: [GtpController],
  providers: [GtpService],
})
export class GtpModule {}
