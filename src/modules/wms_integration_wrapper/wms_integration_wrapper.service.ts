import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { CrossdockTaskService } from '../crossdock_task/crossdock_task.service';
import { WMSBatchJob } from './entities/batch_job';

@Injectable()
export class WMSIntegrationWrapperService {
  constructor(
    @Inject(forwardRef(() => CrossdockTaskService))
    private readonly crossdockTaskService: CrossdockTaskService,
  ) {}

  async createBatchJob(batch_job: WMSBatchJob): Promise<string> {
    const batch_job_id = await this.crossdockTaskService.createWMSBatchJob(batch_job);
    return batch_job_id;
  }

  async getBatchJob(batch_id: string): Promise<WMSBatchJob> {
    const batch_job = await this.crossdockTaskService.getWMSBatchJob(batch_id);
    return batch_job;
  }
}
