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
import { Log, ProductRequirement, Station, Task } from 'src/entities';
import { ScheduleMapping } from 'src/entities/schedule_mapping.entity';
import { OrchestratorModule } from '../orchestrator/orchestrator.module';
import { OrdersCancelService } from './orders-cancel.service';
import { In } from 'typeorm';
import { InventoryModule } from '../inventory/inventory.module';
import { WebhookModule } from '../webhook/webhook.module';

@Module({
  imports: [JwtModule.register(jwtConfig),
    TypeOrmModule.forFeature([OrderItem, Product, GtpLocation, User, Log, ScheduleMapping, Task, ProductRequirement, Station])
    ,forwardRef(() => OrchestratorModule),
    InventoryModule,
    WebhookModule
  ],
  controllers: [OrdersController],
  providers: [OrdersService, LoggingService, OrdersCancelService],
  exports: [OrdersService, OrdersCancelService],
})
export class OrdersModule {}
