import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { WMSIntegrationWrapperService } from './wms_integration_wrapper.service';
import { WMSBatchJob } from './entities/batch_job';

@Controller('wms-integration-wrapper/:warehouse_id')
export class WMSIntegrationWrapperController {
  constructor(
    private readonly wmsIntegrationWrapperService: WMSIntegrationWrapperService,
  ) {}

  @Post('tasks')
  async createBatchJob(@Body() batch_job: WMSBatchJob) {
    const batch_job_id =
      await this.wmsIntegrationWrapperService.createBatchJob(batch_job);
    return {
      batch_job_id,
      status: 'Batch job created successfully',
    };
  }

  @Get('tasks/:batch_id')
  async getBatchJob(@Param('batch_id') batch_id: string) {
    return await this.wmsIntegrationWrapperService.getBatchJob(batch_id);
  }
}
