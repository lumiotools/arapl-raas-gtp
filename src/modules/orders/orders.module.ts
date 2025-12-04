import { forwardRef, Logger, Module } from '@nestjs/common';
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
import { Inventory, Log, ProductRequirement, Station, Task } from 'src/entities';
import { ScheduleMapping } from 'src/entities/schedule_mapping.entity';
import { OrchestratorModule } from '../orchestrator/orchestrator.module';
import { OrdersCancelService } from './orders-cancel.service';
import { In } from 'typeorm';
import { InventoryModule } from '../inventory/inventory.module';
import { WebhookModule } from '../webhook/webhook.module';
import { Robot } from 'src/entities/robots.entity';
import { LoggingModule } from '../logging/logging.module';

@Module({
  imports: [JwtModule.register(jwtConfig),
    TypeOrmModule.forFeature([OrderItem,Robot, Product, GtpLocation,Inventory, User, Log, ScheduleMapping, Task, ProductRequirement, Station])
    ,forwardRef(() => OrchestratorModule),
    InventoryModule,
    WebhookModule,
    LoggingModule
  ],
  controllers: [OrdersController],
  providers: [OrdersService, OrdersCancelService],
  exports: [OrdersService],
})
export class OrdersModule {}