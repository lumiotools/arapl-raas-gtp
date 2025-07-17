import { Module } from '@nestjs/common';
import { WaitingLocationService } from './waiting_location.service';
import { WaitingLocationController } from './waiting_location.controller';

@Module({
  controllers: [WaitingLocationController],
  providers: [WaitingLocationService],
})
export class WaitingLocationModule {}
