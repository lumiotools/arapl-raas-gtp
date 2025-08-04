import { Logger, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { OrderItem } from '../../entities/order-item.entity';
import { Product } from '../../entities/product.entity';
import { GtpLocation } from '../../entities/gtp-location.entity';
import { JwtAuthGuard } from '../auth/guard/auth.guard';
import { JwtModule } from '@nestjs/jwt';
import { jwtConfig } from 'src/config/jwt.config';
import { User } from 'src/entities/user.entity';
import { LoggingService } from 'src/services/logging.service';
import { Log } from 'src/entities';
import { ScheduleMapping } from 'src/entities/schedule_mapping.entity';

@Module({
  imports: [JwtModule.register(jwtConfig),
    TypeOrmModule.forFeature([OrderItem, Product, GtpLocation, User, Log, ScheduleMapping])],
  controllers: [OrdersController],
  providers: [OrdersService, LoggingService],
})
export class OrdersModule {}
