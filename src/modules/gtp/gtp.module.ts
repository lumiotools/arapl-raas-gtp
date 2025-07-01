import { Module } from '@nestjs/common';
import { GtpService } from './gtp.service';
import { GtpController } from './gtp.controller';

@Module({
  controllers: [GtpController],
  providers: [GtpService],
})
export class GtpModule {}
