import { Controller, Get, Post, Param, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { OrchestratorService } from './orchestrator.service';
import { BatchResponseDto } from './dto/batch-response.dto';

@ApiTags('Orchestrator')
@Controller('orchestrator')
export class OrchestratorController {
  constructor(private readonly orchestratorService: OrchestratorService) {}

  @Post('trigger')
  @ApiOperation({
    summary: 'Manually trigger orchestrator process',
    description: 'Manually start the orchestrator process to handle assigned order items and create tasks.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Orchestrator process triggered successfully',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Orchestrator process triggered successfully' }
      }
    }
  })
  async triggerOrchestrator() {
    await this.orchestratorService.triggerOrchestrator();
    return { message: 'Orchestrator process triggered successfully' };
  }

  @Get('batches')
  @ApiOperation({
    summary: 'Get all batches',
    description: 'Retrieve all task batches ordered by creation date (newest first).',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'List of all batches',
    type: [BatchResponseDto]
  })
  async getAllBatches() {
    return await this.orchestratorService.getAllBatches();
  }

  @Get('batches/:batchId')
  @ApiOperation({
    summary: 'Get batch details with tasks',
    description: 'Retrieve detailed information about a specific batch including all its tasks.',
  })
  @ApiParam({ name: 'batchId', description: 'Batch ID', example: 'BATCH12345678' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Batch details with tasks',
    type: BatchResponseDto
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Batch not found'
  })
  async getBatchStatus(@Param('batchId') batchId: string) {
    const batch = await this.orchestratorService.getBatchStatus(batchId);
    if (!batch) {
      return { message: 'Batch not found' };
    }
    return batch;
  }
}
