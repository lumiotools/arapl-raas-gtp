import { Body, Controller, Get, Param, Post, HttpStatus, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBody } from '@nestjs/swagger';
import { WMSIntegrationWrapperService } from './wms_integration_wrapper.service';
import { WMSBatchJob } from './entities/batch_job';
import { WMSBatchJobDto } from './dto/batch-job.dto';
import { CreateBatchJobResponseDto } from './dto/create-batch-job-response.dto';
import { BadRequestDto } from '../orders/dto/error-responses.dto';
import { NotFoundResponseDto } from 'src/common/dto/common-responses.dto';

@ApiTags('WMS Integration Wrapper')
@Controller('wms-integration-wrapper/:warehouse_id')
export class WMSIntegrationWrapperController {
  constructor(
    private readonly wmsIntegrationWrapperService: WMSIntegrationWrapperService,
  ) {}

  @Post('tasks')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a new WMS batch job',
    description: 'Create a new batch job with tasks for WMS integration. The batch job will be processed by the CrossDock task service.',
  })
  @ApiParam({
    name: 'warehouse_id',
    description: 'The unique identifier of the warehouse',
    example: 'WH001',
  })
  @ApiBody({
    type: WMSBatchJobDto,
    description: 'Batch job data containing tasks, locations, and cargo information',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Batch job created successfully',
    type: CreateBatchJobResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid batch job data or validation errors',
    type: BadRequestDto,
  })
  async createBatchJob(@Param('warehouse_id') warehouse_id: string, @Body() batch_job: WMSBatchJob) {
    const batch_job_id =
      await this.wmsIntegrationWrapperService.createBatchJob(batch_job);
    return {
      batch_job_id,
      status: 'Batch job created successfully',
    };
  }

  @Get('tasks/:batch_id')
  @ApiOperation({
    summary: 'Get WMS batch job details',
    description: 'Retrieve the details of a specific WMS batch job including all tasks, their status, locations, and cargo information.',
  })
  @ApiParam({
    name: 'warehouse_id',
    description: 'The unique identifier of the warehouse',
    example: 'WH001',
  })
  @ApiParam({
    name: 'batch_id',
    description: 'The unique identifier of the batch job',
    example: 'B6566210101',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Batch job details retrieved successfully',
    type: WMSBatchJobDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Batch job not found',
    type: NotFoundResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid batch ID',
    type: BadRequestDto,
  })
  async getBatchJob(@Param('warehouse_id') warehouse_id: string, @Param('batch_id') batch_id: string) {
    return await this.wmsIntegrationWrapperService.getBatchJob(batch_id);
  }
}
