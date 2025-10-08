import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { getDBConfig } from './config/db.config';
import { OrdersModule } from './modules/orders/orders.module';
import { GtpModule } from './modules/gtp/gtp.module';
import { StationsModule } from './modules/stations/stations.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { OrchestratorModule } from './modules/orchestrator/orchestrator.module';
import { WebhookModule } from './modules/webhook/webhook.module';
import { TriggerModule } from './modules/trigger/trigger.module';
import { LoggingModule } from './modules/logging/logging.module';
import { DatabaseResetModule } from './modules/database-reset/database-reset.module';
import { WaitingLocationModule } from './modules/waiting_location/waiting_location.module';
import { AuthModule } from './modules/auth/auth.module';
import { BotModule } from './modules/bot/bot.module';
import { LocationsModule } from './modules/locations/locations.module';
import { BaseopsTaskModule } from './modules/baseops_task/baseops_task.module';
import { EmptyLocationsModule } from './modules/empty_locations/empty_locations.module';
import { SettingsModule } from './modules/settings/settings.module';
import { CrossdockTaskModule } from './modules/crossdock_task/crossdock_task.module';

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
    InventoryModule,
    OrchestratorModule,
    WebhookModule,
    TriggerModule,
    DatabaseResetModule,
    WaitingLocationModule,
    AuthModule,
    BotModule,
    LocationsModule,
    BaseopsTaskModule,
    CrossdockTaskModule,
    EmptyLocationsModule,
    SettingsModule
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
