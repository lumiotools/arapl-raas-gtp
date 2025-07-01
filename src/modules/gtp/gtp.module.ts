import { Module } from '@nestjs/common';
import { GtpService } from './gtp.service';
import { GtpController } from './gtp.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GtpLocation } from 'src/entities/gtp-location.entity'; // Import GtpLocation entity

@Module({
  imports: [TypeOrmModule.forFeature([GtpLocation])], // Import GtpLocation entity
  controllers: [GtpController],
  providers: [GtpService],
})
export class GtpModule {}
