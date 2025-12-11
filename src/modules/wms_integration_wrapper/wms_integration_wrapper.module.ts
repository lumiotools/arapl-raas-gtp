import { Module } from '@nestjs/common';
import { WMSIntegrationWrapperService } from './wms_integration_wrapper.service';
import { WMSIntegrationWrapperController } from './wms_integration_wrapper.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { CrossdockTaskModule } from '../crossdock_task/crossdock_task.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([]),
    HttpModule,
    CrossdockTaskModule,
  ],
  controllers: [WMSIntegrationWrapperController],
  providers: [WMSIntegrationWrapperService],
  exports: [WMSIntegrationWrapperService],
})
export class WMSIntegrationWrapperModule {}
