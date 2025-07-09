import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { getDBConfig } from './config/db.config';
import { OrdersModule } from './modules/orders/orders.module';
import { GtpModule } from './modules/gtp/gtp.module';
import { StationsModule } from './modules/stations/stations.module';
import { ProductsModule } from './modules/products/products.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { OrchestratorModule } from './modules/orchestrator/orchestrator.module';
import { WebhookModule } from './modules/webhook/webhook.module';
import { TriggerModule } from './modules/trigger/trigger.module';
import { LoggingModule } from './modules/logging/logging.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => getDBConfig(configService),
      inject: [ConfigService],
    }),
    LoggingModule,
    OrdersModule,
    GtpModule,
    StationsModule,
    ProductsModule,
    InventoryModule,
    OrchestratorModule,
    WebhookModule,
    TriggerModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
