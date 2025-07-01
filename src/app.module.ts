import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { getDBConfig } from './config/db.config';
import { OrdersModule } from './modules/orders/orders.module';
import { GtpModule } from './modules/gtp/gtp.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => getDBConfig(configService),
      inject: [ConfigService],
    }),
    OrdersModule,
    GtpModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
