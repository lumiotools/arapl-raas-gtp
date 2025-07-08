import { Controller, Get, Post, Param, HttpStatus, NotFoundException } from '@nestjs/common';
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
    return await this.orchestratorService.triggerOrchestrator(true);
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

  @Get('product-requirements')
  @ApiOperation({
    summary: 'Get all product requirements',
    description: 'Retrieve all product requirements stored in the database.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'List of all product requirements',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'number' },
          product_id: { type: 'string' },
          station_id: { type: 'string' },
          requirement: { type: 'number' },
          created_at: { type: 'string' },
          updated_at: { type: 'string' },
        }
      }
    }
  })
  async getAllProductRequirements() {
    return await this.orchestratorService.getAllProductRequirements();
  }

  @Get('product-requirements/product/:productId')
  @ApiOperation({
    summary: 'Get product requirements by product ID',
    description: 'Retrieve all station requirements for a specific product.',
  })
  @ApiParam({ name: 'productId', description: 'Product ID', example: 'P001' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Product requirements for the specified product',
  })
  async getProductRequirementsByProductId(@Param('productId') productId: string) {
    return await this.orchestratorService.getProductRequirementsByProductId(productId);
  }

  @Get('product-requirements/station/:stationId')
  @ApiOperation({
    summary: 'Get product requirements by station ID',
    description: 'Retrieve all product requirements for a specific station.',
  })
  @ApiParam({ name: 'stationId', description: 'Station ID', example: 'ST001' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Product requirements for the specified station',
  })
  async getProductRequirementsByStationId(@Param('stationId') stationId: string) {
    return await this.orchestratorService.getProductRequirementsByStationId(stationId);
  }

  @Get('waiting-locations')
  @ApiOperation({ summary: 'Get all waiting locations' })
  @ApiResponse({ status: HttpStatus.OK, description: 'List of all waiting locations' })
  async getAllWaitingLocations() {
    return await this.orchestratorService.getAllWaitingLocations();
  }

  @Get('waiting-locations/:location_id')
  @ApiOperation({ summary: 'Get waiting location by ID' })
  @ApiParam({ name: 'location_id', description: 'Waiting location ID' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Waiting location details' })
  async getWaitingLocationById(@Param('location_id') locationId: string) {
    const waitingLocation = await this.orchestratorService.getWaitingLocationById(locationId);

    if (!waitingLocation) {
      throw new NotFoundException(`Waiting location ${locationId} not found`);
    }

    return waitingLocation;
  }

  @Get('tasks')
  @ApiOperation({
    summary: 'Get all tasks in the system',
    description: 'Retrieve all tasks from the database with their complete details including locations, status, and dependencies.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Successfully retrieved all tasks',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: 'Found 150 tasks in the system' },
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              task_id: { type: 'number', example: 1 },
              batch_id: { type: 'string', example: 'B1641234567' },
              product_id: { type: 'string', example: 'PROD001' },
              quantity: { type: 'number', example: 10 },
              task_type: { type: 'string', example: 'GOODS_TO_PERSON' },
              sequence_order: { type: 'number', example: 1 },
              task_dependency: { type: 'number', example: null },
              status: { type: 'string', example: 'COMPLETED' },
              robot_id: { type: 'string', example: 'ROBOT_001' },
              start_location: {
                type: 'object',
                properties: {
                  location_id: { type: 'string', example: 'INV001' },
                  location_type: { type: 'string', example: 'ZONE' },
                  location_action: { type: 'string', example: 'PICK' },
                  location_dimension: {
                    type: 'object',
                    properties: {
                      length: { type: 'number', example: 1 },
                      width: { type: 'number', example: 1 },
                      height: { type: 'number', example: 1 }
                    }
                  },
                  location_attribute: {
                    type: 'object',
                    properties: {
                      attribute_name: { type: 'string', example: 'location_type' },
                      attribute_value: { type: 'string', example: 'inventory' }
                    }
                  }
                }
              },
              end_location: {
                type: 'object',
                properties: {
                  location_id: { type: 'string', example: 'STA001' },
                  location_type: { type: 'string', example: 'ZONE' },
                  location_action: { type: 'string', example: 'WAIT' },
                  location_dimension: {
                    type: 'object',
                    properties: {
                      length: { type: 'number', example: 1 },
                      width: { type: 'number', example: 1 },
                      height: { type: 'number', example: 1 }
                    }
                  },
                  location_attribute: {
                    type: 'object',
                    properties: {
                      attribute_name: { type: 'string', example: 'location_type' },
                      attribute_value: { type: 'string', example: 'station' }
                    }
                  }
                }
              },
              wait: {
                type: 'object',
                properties: {
                  wait_type: { type: 'string', example: 'TRIGGER' }
                }
              },
              cargos: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    cargo_code: { type: 'string', example: 'PROD001' },
                    cargo_type: { type: 'string', example: 'Pallet' },
                    cargo_dimension: {
                      type: 'object',
                      properties: {
                        length: { type: 'number', example: 1 },
                        width: { type: 'number', example: 1 },
                        height: { type: 'number', example: 1 }
                      }
                    },
                    cargo_attributes: { type: 'object', example: null },
                    cargo_weight: { type: 'number', example: 1 }
                  }
                }
              },
              created_at: { type: 'string', format: 'date-time' },
              updated_at: { type: 'string', format: 'date-time' }
            }
          }
        }
      }
    }
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Internal server error',
    schema: {
      type: 'object',
      properties: {
        statusCode: { type: 'number', example: 500 },
        message: { type: 'string', example: 'Failed to retrieve tasks: Database connection error' },
        error: { type: 'string', example: 'Internal Server Error' }
      }
    }
  })
  async getAllTasks() {
    return await this.orchestratorService.getAllTasks();
  }
}
