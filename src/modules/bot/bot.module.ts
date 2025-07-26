import { Module } from '@nestjs/common';
import { BotService } from './bot.service';
import { BotController } from './bot.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GtpLocation, Inventory, OrderItem, Product, Station, WaitingLocation } from 'src/entities';
import { ToolService } from './tools';

@Module({
  imports:[TypeOrmModule.forFeature([Inventory, Product, OrderItem, Station, GtpLocation, WaitingLocation])],
  controllers: [BotController],
  providers: [BotService, ToolService],
})
export class BotModule {}
