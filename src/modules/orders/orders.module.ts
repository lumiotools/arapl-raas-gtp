import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { Order } from '../../entities/order.entity';
import { OrderItem } from '../../entities/order-item.entity';
import { Product } from '../../entities/product.entity';
import { GtpLocation } from '../../entities/gtp-location.entity';
import { JwtAuthGuard } from '../auth/guard/auth.guard';
import { JwtModule } from '@nestjs/jwt';
import { jwtConfig } from 'src/config/jwt.config';
import { User } from 'src/entities/user.entity';

@Module({
  imports: [JwtModule.register(jwtConfig),
    TypeOrmModule.forFeature([Order, OrderItem, Product, GtpLocation, User])],
  controllers: [OrdersController],
  providers: [OrdersService],
})
export class OrdersModule {}
