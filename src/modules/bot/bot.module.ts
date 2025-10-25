import { Module } from '@nestjs/common';
import { BotService } from './bot.service';
import { BotController } from './bot.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GtpLocation, Inventory, OrderItem, Product, Station, WaitingLocation } from 'src/entities';
import { ToolService } from './tools';
import { EmptyLocation } from 'src/entities/empty-location.entity';
import { EmptyLocationsModule } from '../empty_locations/empty_locations.module';

@Module({
  imports:[TypeOrmModule.forFeature([Inventory, Product, OrderItem, Station, GtpLocation, WaitingLocation,
    EmptyLocation
  ]),EmptyLocationsModule
  ],
  controllers: [BotController],
  providers: [BotService, ToolService],
})
export class BotModule {}
