import { Controller, Get, Post, Param, HttpStatus, NotFoundException, Put, UseGuards, Query, BadRequestException, HttpCode, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBody, ApiQuery } from '@nestjs/swagger';
import { OrchestratorService, TaskDetails } from './orchestrator.service';
import { BatchResponseDto } from './dto/batch-response.dto';
import { JwtAuthGuard } from '../auth/guard/auth.guard';
import { Roles } from '../auth/guard/roles.decorator';
import { RolesGuard } from '../auth/guard/roles.guard';
import { BadRequestDto } from '../orders/dto/error-responses.dto';
import { Role } from 'src/entities/user.entity';
import { TaskType } from 'src/entities';
import { OperationType } from 'src/entities/robot-count.entity';

@ApiTags('Orchestrator')
@Controller('orchestrator')
export class OrchestratorController {
  constructor(private readonly orchestratorService: OrchestratorService) {}

  // @Post('trigger')
  // @ApiOperation({
  //   summary: 'Manually trigger orchestrator process',
  //   description: 'Manually start the orchestrator process to handle assigned order items and create tasks.',
  // })
  // @ApiResponse({
  //   status: HttpStatus.OK,
  //   description: 'Orchestrator process triggered successfully',
  //   schema: {
  //     type: 'object',
  //     properties: {
  //       message: { type: 'string', example: 'Orchestrator process triggered successfully' }
  //     }
  //   }
  // })
  // @UseGuards(JwtAuthGuard, RolesGuard)
  // @Roles(Role.FLOWOPS_ADMIN, Role.FLOWOPS_OPERATOR, Role.ADMIN)
  // async triggerOrchestrator() {
  //   return await this.orchestratorService.writeInDatabase();
  // }

  // @Get('batches')
  // @ApiOperation({
  //   summary: 'Get all batches',
  //   description: 'Retrieve all task batches ordered by creation date (newest first).',
  // })
  // @ApiResponse({
  //   status: HttpStatus.OK,
  //   description: 'List of all batches',
  //   type: [BatchResponseDto]
  // })
  // async getAllBatches() {
  //   return await this.orchestratorService.getAllBatches();
  // }

  // @Get('batches/:batchId')
  // @ApiOperation({
  //   summary: 'Get batch details with tasks',
  //   description: 'Retrieve detailed information about a specific batch including all its tasks.',
  // })
  // @ApiParam({ name: 'batchId', description: 'Batch ID', example: 'BATCH12345678' })
  // @ApiResponse({
  //   status: HttpStatus.OK,
  //   description: 'Batch details with tasks',
  //   type: BatchResponseDto
  // })
  // @ApiResponse({
  //   status: HttpStatus.NOT_FOUND,
  //   description: 'Batch not found'
  // })
  // async getBatchStatus(@Param('batchId') batchId: string) {
  //   const batch = await this.orchestratorService.getBatchStatus(batchId);
  //   if (!batch) {
  //     return { message: 'Batch not found' };
  //   }
  //   return batch;
  // }

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
          id: { type: 'number', example: 498 },
          source_location_id: { type: 'string', example: 'R10X02' },
          station_id: { type: 'string', example: 'ST001' },
          isPaused: { type: 'boolean', example: false },
          isCancelled: { type: 'boolean', example: false },
          task_created: { type: 'boolean', example: true },
          created_at: { type: 'string', format: 'date-time', example: '2025-12-24T08:50:02.912Z' },
          updated_at: { type: 'string', format: 'date-time', example: '2025-12-24T08:50:02.912Z' }
        }
      }
    }
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.FLOWOPS_ADMIN, Role.FLOWOPS_OPERATOR, Role.ADMIN)
  async getAllProductRequirements() {
    return await this.orchestratorService.getAllProductRequirements();
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
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          created_at: { type: 'string', format: 'date-time', example: '2025-12-24T08:50:02.912Z' },
          updated_at: { type: 'string', format: 'date-time', example: '2025-12-24T08:50:02.912Z' },
          id: { type: 'number', example: 498 },
          source_location_id: { type: 'string', example: 'R10X02' },
          station_id: { type: 'string', example: 'ST001' },
          isPaused: { type: 'boolean', example: false },
          isCancelled: { type: 'boolean', example: false },
          task_created: { type: 'boolean', example: true }
        }
      }
    }
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.FLOWOPS_ADMIN, Role.FLOWOPS_OPERATOR , Role.ADMIN)
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
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(Role.FLOWOPS_ADMIN, Role.FLOWOPS_OPERATOR, Role.BASEOPS_ADMIN, Role.CROSSDOCK_ADMIN)
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
                created_at: { type: 'string', format: 'date-time', example: '2025-12-24T08:50:10.110Z' },
                updated_at: { type: 'string', format: 'date-time', example: '2025-12-24T08:50:51.651Z' },
                task_id: { type: 'string', format: 'uuid', example: 'c95332ff-322d-4262-85b3-283ff9bc4a75' },
                display_task_id: { type: 'string', example: '903' },
                batch_id: { type: 'string', example: 'B6566210101' },
                fms_batch_id: { type: 'string', nullable: true, example: 'Batch-20251224142010162' },
                wms_task_id: { type: 'string', nullable: true, example: null },
                origin_location: { type: 'string', example: 'R20X01' },
                priority: { type: 'number', example: 1 },
                task_type: { type: 'string', example: 'GoodsToPerson' },
                status: { type: 'string', example: 'COMPLETED' },
                move_type: { type: 'string', example: 'InventoryToStation' },
                sequence_order: { type: 'number', example: 1 },
                task_dependency: { type: 'string', example: 'c95332ff-322d-4262-85b3-283ff9bc4a75' },
                robot_id: { type: 'string', format: 'uuid', example: '81b23183-8e23-48c8-9337-50e30f20ad45' },
                start_location: {
                  type: 'object',
                  properties: {
                    location_id: { type: 'string', example: 'R20X01' },
                    location_type: { type: 'string', example: 'PALLET' },
                    location_action: { type: 'string', example: 'PICK' },
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
                    location_id: { type: 'string', example: 'ST002' },
                    location_type: { type: 'string', example: 'PALLET' },
                    location_action: { type: 'string', example: 'NOP_PAUSE' },
                    location_attribute: {
                      type: 'object',
                      properties: {
                        attribute_name: { type: 'string', example: 'location_type' },
                        attribute_value: { type: 'string', example: 'station' }
                      }
                    }
                  }
                },
                wait: { type: 'object', nullable: true, example: null },
                cargos: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      cargo_code: { type: 'string', example: '843920174600' },
                      cargo_type: { type: 'string', example: 'PALLET' },
                      cargo_dimension: {
                        type: 'object',
                        properties: {
                          length: { type: 'number', example: 1 },
                          width: { type: 'number', example: 1 },
                          height: { type: 'number', example: 1 }
                        }
                      },
                      cargo_weight: { type: 'number', example: 0 },
                      cargo_attributes: { type: 'object', nullable: true, example: null }
                    }
                  }
                },
                pause_resume_logs: { type: 'array',  nullable: true, example: null },
                task_acknowledged: { type: 'string', format: 'date-time', example: '2025-12-24T08:50:10.432Z' },
                inqueue: { type: 'string', format: 'date-time', example: '2025-12-24T08:50:10.488Z' },
                processing: { type: 'string', format: 'date-time', example: '2025-12-24T08:50:11.533Z' },
                completed: { type: 'string', format: 'date-time', example: '2025-12-24T08:50:51.649Z' },
                triggered: { type: 'string', nullable: true, example: null },
                message: { type: 'string', nullable: true, example: null },
                is_gtp_cancelled: { type: 'boolean', example: false },
                is_paused: { type: 'boolean', example: false }
              }
            }
          }
        }
      }})
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

    @Get('tasks/:taskId')
    @ApiOperation({
      summary: 'Get task by task ID',
      description: 'Retrieve a specific task by its task_id with complete details including locations, status, and dependencies.',
    })
    @ApiParam({ name: 'taskId', description: 'Task ID', example: 'c95332ff-322d-4262-85b3-283ff9bc4a75' })
    @ApiResponse({
      status: HttpStatus.OK,
      description: 'Successfully retrieved the task',
      schema: {
        type: 'object',
        properties: {
          created_at: { type: 'string', format: 'date-time', example: '2025-12-24T08:50:10.110Z' },
          updated_at: { type: 'string', format: 'date-time', example: '2025-12-24T08:50:51.651Z' },
          task_id: { type: 'string', format: 'uuid', example: 'c95332ff-322d-4262-85b3-283ff9bc4a75' },
          display_task_id: { type: 'string', example: '903' },
          batch_id: { type: 'string', example: 'B6566210101' },
          fms_batch_id: { type: 'string', nullable: true, example: 'Batch-20251224142010162' },
          wms_task_id: { type: 'string', nullable: true, example: null },
          origin_location: { type: 'string', example: 'R20X01' },
          priority: { type: 'number', example: 1 },
          task_type: { type: 'string', example: 'GoodsToPerson' },
          status: { type: 'string', example: 'COMPLETED' },
          move_type: { type: 'string', example: 'InventoryToStation' },
          sequence_order: { type: 'number', example: 1 },
          task_dependency: { type: 'string', example: 'c95332ff-322d-4262-85b3-283ff9bc4a75' },
          robot_id: { type: 'string', format: 'uuid', example: '81b23183-8e23-48c8-9337-50e30f20ad45' },
          start_location: {
            type: 'object',
            properties: {
              location_id: { type: 'string', example: 'R20X01' },
              location_type: { type: 'string', example: 'PALLET' },
              location_action: { type: 'string', example: 'PICK' },
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
              location_id: { type: 'string', example: 'ST002' },
              location_type: { type: 'string', example: 'PALLET' },
              location_action: { type: 'string', example: 'NOP_PAUSE' },
              location_attribute: {
                type: 'object',
                properties: {
                  attribute_name: { type: 'string', example: 'location_type' },
                  attribute_value: { type: 'string', example: 'station' }
                }
              }
            }
          },
          wait: { type: 'object', nullable: true, example: null },
          cargos: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                cargo_code: { type: 'string', example: '843920174600' },
                cargo_type: { type: 'string', example: 'PALLET' },
                cargo_dimension: {
                  type: 'object',
                  properties: {
                    length: { type: 'number', example: 1 },
                    width: { type: 'number', example: 1 },
                    height: { type: 'number', example: 1 }
                  }
                },
                cargo_weight: { type: 'number', example: 0 },
                cargo_attributes: { type: 'object', nullable: true, example: null }
              }
            }
          },
          pause_resume_logs: { type: 'array', nullable: true, example: null },
          task_acknowledged: { type: 'string', format: 'date-time', example: '2025-12-24T08:50:10.432Z' },
          inqueue: { type: 'string', format: 'date-time', example: '2025-12-24T08:50:10.488Z' },
          processing: { type: 'string', format: 'date-time', example: '2025-12-24T08:50:11.533Z' },
          completed: { type: 'string', format: 'date-time', example: '2025-12-24T08:50:51.649Z' },
          triggered: { type: 'string', nullable: true, example: null },
          message: { type: 'string', nullable: true, example: null },
          is_gtp_cancelled: { type: 'boolean', example: false },
          is_paused: { type: 'boolean', example: false }
        }
      }
    })
    @ApiResponse({
      status: HttpStatus.NOT_FOUND,
      description: 'Task not found',
      schema: {
        type: 'object',
        properties: {
          message: { type: 'string', example: 'Task with ID c95332ff-322d-4262-85b3-283ff9bc4a75 not found' },
          error: { type: 'string', example: 'Not Found' },
          statusCode: { type: 'number', example: 404 }
        }
      }
    })
    @ApiResponse({
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      description: 'Internal server error',
      schema: {
        type: 'object',
        properties: {
          message: { type: 'string', example: 'Failed to retrieve task: Database connection error' },
          error: { type: 'string', example: 'Internal Server Error' },
          statusCode: { type: 'number', example: 500 }
        }
      }
    })
  async getTaskById(@Param('taskId') taskId: string) {
    return await this.orchestratorService.getTaskbyID(taskId);
  }

  @Get('predicted-robots')
  @ApiOperation({
    summary: 'Get predicted robots',
    description: 'Returns a count of predicted robots based on current system state or requirements.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Predicted robots count',
    schema: {
      type: 'object',
      properties: {
        predicted: { type: 'number', example: 1 }
      }
    }
  })
  async getPredictedRobots() {
    return await this.orchestratorService.getPredictedRobots();
  }

  @Post('handle-erroneous-task')
  @ApiOperation({
    summary: 'Handle erroneous task',
    description: 'Mark a task as erroneous or perform corrective action for a given task_id.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', example: '123' }
      },
      required: ['task_id']
    }
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Erroneous task handled successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: 'Erroneous task handled successfully' },
        task_id: { type: 'number', example: 123 }
      }
    }
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid or missing task_id',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'task_id is required and must be a number' },
        error: { type: 'string', example: 'Bad Request' },
        statusCode: { type: 'number', example: 400 }
      }
    }
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.FLOWOPS_ADMIN, Role.FLOWOPS_OPERATOR, Role.ADMIN)
  async handleErroneousTask(@Body('task_id') taskId: string) {
    await this.orchestratorService.handleErroneousTask(taskId);
    return {
      success: true,
      message: 'Erroneous task handled successfully',
      task_id: taskId
    };
  }

  @Post('initial-config')
  @ApiOperation({
    summary: 'Set initial configuration',
    description: 'Initialize the system with default configuration settings including robot status, location mappings, and system parameters.',
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.FLOWOPS_ADMIN, Role.FLOWOPS_OPERATOR, Role.ADMIN)
  async setInitialConfiguration() {
    return await this.orchestratorService.setInitialConfiguration();
  }


  @Get('robots/:robotId/tasks')
  @ApiOperation({
    summary: 'Get tasks by robot ID',
    description: 'Retrieve all tasks assigned to a specific robot.',
  })
  @ApiParam({ 
    name: 'robotId', 
    description: 'Robot ID', 
    example: 'ROBOT_001' 
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
                created_at: { type: 'string', format: 'date-time', example: '2025-12-24T08:50:10.110Z' },
                updated_at: { type: 'string', format: 'date-time', example: '2025-12-24T08:50:51.651Z' },
                task_id: { type: 'string', format: 'uuid', example: 'c95332ff-322d-4262-85b3-283ff9bc4a75' },
                display_task_id: { type: 'string', example: '903' },
                batch_id: { type: 'string', example: 'B6566210101' },
                fms_batch_id: { type: 'string', nullable: true, example: 'Batch-20251224142010162' },
                wms_task_id: { type: 'string', nullable: true, example: null },
                origin_location: { type: 'string', example: 'R20X01' },
                priority: { type: 'number', example: 1 },
                task_type: { type: 'string', example: 'GoodsToPerson' },
                status: { type: 'string', example: 'COMPLETED' },
                move_type: { type: 'string', example: 'InventoryToStation' },
                sequence_order: { type: 'number', example: 1 },
                task_dependency: { type: 'string', example: 'c95332ff-322d-4262-85b3-283ff9bc4a75' },
                robot_id: { type: 'string', format: 'uuid', example: '81b23183-8e23-48c8-9337-50e30f20ad45' },
                start_location: {
                  type: 'object',
                  properties: {
                    location_id: { type: 'string', example: 'R20X01' },
                    location_type: { type: 'string', example: 'PALLET' },
                    location_action: { type: 'string', example: 'PICK' },
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
                    location_id: { type: 'string', example: 'ST002' },
                    location_type: { type: 'string', example: 'PALLET' },
                    location_action: { type: 'string', example: 'NOP_PAUSE' },
                    location_attribute: {
                      type: 'object',
                      properties: {
                        attribute_name: { type: 'string', example: 'location_type' },
                        attribute_value: { type: 'string', example: 'station' }
                      }
                    }
                  }
                },
                wait: { type: 'object', nullable: true, example: null },
                cargos: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      cargo_code: { type: 'string', example: '843920174600' },
                      cargo_type: { type: 'string', example: 'PALLET' },
                      cargo_dimension: {
                        type: 'object',
                        properties: {
                          length: { type: 'number', example: 1 },
                          width: { type: 'number', example: 1 },
                          height: { type: 'number', example: 1 }
                        }
                      },
                      cargo_weight: { type: 'number', example: 0 },
                      cargo_attributes: { type: 'object', nullable: true, example: null }
                    }
                  }
                },
                pause_resume_logs: { type: 'array',  nullable: true, example: null },
                task_acknowledged: { type: 'string', format: 'date-time', example: '2025-12-24T08:50:10.432Z' },
                inqueue: { type: 'string', format: 'date-time', example: '2025-12-24T08:50:10.488Z' },
                processing: { type: 'string', format: 'date-time', example: '2025-12-24T08:50:11.533Z' },
                completed: { type: 'string', format: 'date-time', example: '2025-12-24T08:50:51.649Z' },
                triggered: { type: 'string', nullable: true, example: null },
                message: { type: 'string', nullable: true, example: null },
                is_gtp_cancelled: { type: 'boolean', example: false },
                is_paused: { type: 'boolean', example: false }
              }
            }
          }
        }
      }})
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'No tasks found for the robot',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'No tasks found for robot ROBOT_001' }
      }
    }
  })
  @Get('robots/:robotId/tasks')
  async getTasksByRobotId(@Param('robotId') robotId: string) {
    return await this.orchestratorService.getTasksByRobotId(robotId);
  }
  @Get('robot-report')
  @ApiOperation({
    summary: 'Get robot report',
    description: 'Generate a comprehensive report of all robots including their current status, task assignments, and performance metrics within the specified time range.',
  })
  @ApiQuery({
    name: 'start_time',
    description: 'Optional start time for the report (ISO 8601 format)',
    required: false
  })
  @ApiQuery({
    name: 'end_time',
    description: 'Optional end time for the report (ISO 8601 format)',
    required: false
  })
  @ApiQuery({
    name: 'module',
    description: 'Operation module to filter robots (FLOWOPS, BASEOPS or CROSSDOCK)',
    example: 'FLOWOPS'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Robot report generated successfully',
    schema: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        properties: {
          totalTasks: { type: 'number', example: 12 },
          robot_name: { type: 'string', example: 'Robot Alpha' },
          travel_time: { type: 'array', items: { type: 'number' } },
          wait_time: { type: 'array', items: { type: 'number' } },
          unloading_time: {
            type: 'object',
            additionalProperties: {
              type: 'array',
              items: { type: 'number' }
            }
          },
          completedTasks: { type: 'number', example: 10 },
          canceledTasks: { type: 'number', example: 1 },
          pause_time: { type: 'number', example: 120 },
          move_types: {
            type: 'object',
            additionalProperties: {
              type: 'object',
              properties: {
                total_tasks: { type: 'number', example: 5 },
                travel_times: { type: 'array', items: { type: 'number' } },
                picking_times: { type: 'array', items: { type: 'number' }, nullable: true }
              }
            }
          },
          maintenance_time: { type: 'number', example: 3600 },
          charging_time: { type: 'number', example: 1800 },
          online_time: { type: 'number', example: 7200 },
          error_time: { type: 'number', example: 300 },
          inUse_time: { type: 'number', example: 5400 }
        }
      }
    }
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Failed to generate robot report',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: false },
        message: { type: 'string', example: 'Failed to generate robot report' },
        error: { type: 'string', example: 'Database connection error' }
      }
    }
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.FLOWOPS_ADMIN, Role.FLOWOPS_OPERATOR, Role.BASEOPS_ADMIN, Role.CROSSDOCK_ADMIN)
    async getRobotReport(
      @Query('start_time') startTime?: string,
      @Query('end_time') endTime?: string,
      @Query('module') module: OperationType = OperationType.FLOWOPS
    ) {
      let startDate: Date | undefined;
      let endDate: Date | undefined;

      if (startTime) {
        startDate = new Date(startTime);
        if (isNaN(startDate.getTime())) {
          throw new BadRequestException('Invalid start_time format. Use ISO 8601 format (e.g., 2025-08-19T09:00:00)');
        }
      }

      if (endTime) {
        endDate = new Date(endTime);
        if (isNaN(endDate.getTime())) {
          throw new BadRequestException('Invalid end_time format. Use ISO 8601 format (e.g., 2025-08-19T17:00:00)');
        }
      }

      if (startDate && endDate && startDate >= endDate) {
        throw new BadRequestException('start_time must be before end_time');
      }

      return await this.orchestratorService.getRobotReport(startDate, endDate, module);
    }
  @Get('movement-report')
  @ApiOperation({
    summary: 'Get movement report',
    description: 'Generate a report of robot movements within the specified time range. Returns a map of movement types to arrays of travel times in seconds.',
  })
  @ApiQuery({
    name: 'start_time',
    description: 'Optional start time for the report (ISO 8601 format)',
    required: false
  })
  @ApiQuery({
    name: 'end_time',
    description: 'Optional end time for the report (ISO 8601 format)',
    required: false
  })
  @ApiQuery({
    name: 'module',
    description: 'Operation module to filter movements (FLOWOPS, BASEOPS or CROSSDOCK)',
    example: 'FLOWOPS'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Movement report generated successfully',
    schema: {
      type: 'object',
      additionalProperties: {
        type: 'array',
        items: {
          type: 'number',
          example: 120,
          description: 'Travel time in seconds'
        }
      },
      description: 'An object where keys are movement categories and values are arrays of travel times (seconds). Keys vary by module (e.g., InventoryToStation, ZoneToZone, PickEntry, etc.).'
    }
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid date format or invalid query parameters',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Invalid start_time format. Use ISO 8601 format (e.g., 2025-08-19T09:00:00)' },
        error: { type: 'string', example: 'Bad Request' },
        statusCode: { type: 'number', example: 400 }
      }
    }
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.FLOWOPS_ADMIN, Role.FLOWOPS_OPERATOR, Role.BASEOPS_ADMIN, Role.CROSSDOCK_ADMIN)
  async getMovementReport(
    @Query('start_time') startTime?: string,
    @Query('end_time') endTime?: string,
    @Query('module') module: OperationType = OperationType.FLOWOPS
  ) {
    let startDate: Date | undefined;
    let endDate: Date | undefined;

    if (startTime) {
      startDate = new Date(startTime);
      if (isNaN(startDate.getTime())) {
        throw new BadRequestException('Invalid start_time format. Use ISO 8601 format (e.g., 2025-08-19T09:00:00)');
      }
    }

    if (endTime) {
      endDate = new Date(endTime);
      if (isNaN(endDate.getTime())) {
        throw new BadRequestException('Invalid end_time format. Use ISO 8601 format (e.g., 2025-08-19T17:00:00)');
      }
    }

    if (startDate && endDate && startDate >= endDate) {
      throw new BadRequestException('start_time must be before end_time');
    }

    return await this.orchestratorService.getMovementReport(startDate, endDate, module);
  }
  @Get('by-status')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.FLOWOPS_ADMIN, Role.FLOWOPS_OPERATOR, Role.BASEOPS_ADMIN, Role.CROSSDOCK_ADMIN)
  @ApiOperation({
    summary: 'Get tasks by status and time range',
    description: 'Retrieve all tasks filtered by their status and optionally by time range. Multiple statuses can be provided as comma-separated values.',
  })
  @ApiQuery({ 
    name: 'status', 
    description: 'Comma-separated list of task statuses to filter by (e.g., PENDING,COMPLETED)',
    example: 'PENDING,COMPLETED'
  })
  @ApiQuery({ 
    name: 'start_time',
    description: 'Optional start time for filtering tasks (ISO 8601 format)',
    example: '2025-08-19T09:00:00',
    required: false
  })
  @ApiQuery({
    name: 'end_time',
    description: 'Optional end time for filtering tasks (ISO 8601 format)',
    example: '2025-08-19T17:00:00',
    required: false
  })
  @ApiQuery({
    name: 'module',
    description: 'Operation module to filter tasks (FLOWOPS or BASEOPS)',
    example: 'FLOWOPS'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Successfully retrieved tasks by status and time range',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: 'Found 5 tasks with status PENDING, COMPLETED' },
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              task_id: { type: 'string', example: 'T001' },
              display_task_id: { type: 'number', example: 1001 },
              batch_id: { type: 'string', example: 'BATCH001' },
              fms_batch_id: { type: 'string', example: 'FMS001', nullable: true },
              wms_batch_id: { type: 'string', example: 'WMS001', nullable: true },
              origin_location: { type: 'string', example: 'ZONE_A' },
              robot_id: { type: 'string', example: 'ROBOT_001' },
              robot_name: { type: 'string', example: 'Robot Alpha' },
              move_type: { type: 'string', example: 'PICK' },
              status: { type: 'string', example: 'PENDING' },
              start_location_id: { type: 'string', example: 'LOC001' },
              end_location_id: { type: 'string', example: 'LOC002' },
              created_at: { type: 'string', format: 'date-time', example: '2024-01-01T00:00:00.000Z' },
              updated_at: { type: 'string', format: 'date-time', example: '2024-01-01T01:00:00.000Z' },
              pallet_id: { type: 'string', example: 'PALLET001', nullable: true },
              start_location_attribute_value: { type: 'string', example: 'inventory' },
              end_location_attribute_value: { type: 'string', example: 'station' },
              priority: { type: 'number', example: 1 },
              batch_priority: { type: 'number', example: 2 },
              orderItems: {
                type: 'array',
                items: { type: 'object' } // You can further define OrderItem schema if needed
              },
              sequence_order: { type: 'number', example: 1, nullable: true },
              inqueue: { type: 'string', format: 'date-time', nullable: true },
              processing: { type: 'string', format: 'date-time', nullable: true },
              completed: { type: 'string', format: 'date-time', nullable: true },
              pause_time: { type: 'number', example: 120, nullable: true }
            }
          }
        }
      }
    }
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid status parameter or time range',
    type: BadRequestDto,
  })
    async getOrdersByStatus(
    @Query('status') status: string,
    @Query('start_time') startTime?: string,
    @Query('end_time') endTime?: string,
    @Query('module') module: OperationType = OperationType.FLOWOPS
    ): Promise<TaskDetails[]> {
    if (!status) {
      throw new BadRequestException('Status query parameter is required');
    }
    
    // Split comma-separated statuses and trim whitespace
    const statusList = status.split(',').map(s => s.trim()).filter(s => s.length > 0);
    
    if (statusList.length === 0) {
      throw new BadRequestException('At least one valid status must be provided');
    }

    // Validate time parameters if provided
    let startDate: Date | undefined;
    let endDate: Date | undefined;

    if (startTime) {
      startDate = new Date(startTime);
      if (isNaN(startDate.getTime())) {
      throw new BadRequestException('Invalid start_time format. Use ISO 8601 format (e.g., 2025-08-19T09:00:00)');
      }
    }

    if (endTime) {
      endDate = new Date(endTime);
      if (isNaN(endDate.getTime())) {
      throw new BadRequestException('Invalid end_time format. Use ISO 8601 format (e.g., 2025-08-19T17:00:00)');
      }
    }

    if (startDate && endDate && startDate >= endDate) {
      throw new BadRequestException('start_time must be before end_time');
    }
    
    return await this.orchestratorService.getTasksByStatus(statusList, startDate, endDate, module);

  }
  
  @Get('travel-analysis/movements')
  @ApiOperation({
    summary: 'Analyze robot movements between source and destination locations',
    description: 'Returns a list of robot movements filtered by source/destination type, multiple source locations, and time range.',
  })
  @ApiQuery({
    name: 'source_type',
    description: 'Type of the source location (station, waiting_location, inventory, empty_location)',
  })
  @ApiQuery({
    name: 'source_location',
    description: 'One or more source location IDs (comma-separated or multiple query params)',
  })
  @ApiQuery({
    name: 'destination_type',
    description: 'Type of the destination location (station, waiting_location, inventory, empty_location)',
  })
  @ApiQuery({
    name: 'start_time',
    description: 'Optional start time for filtering movements (ISO 8601 format)',
    required: false
  })
  @ApiQuery({
    name: 'end_time',
    description: 'Optional end time for filtering movements (ISO 8601 format)',
    required: false
  })
  @ApiQuery({
    name: 'module',
    description: 'Operation module to filter movements (FLOWOPS or BASEOPS)',
    example: 'FLOWOPS'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Movement analysis completed successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: 'Movement analysis completed' },
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              robot_id: { type: 'string', example: 'ROBOT_001' },
              from_type: { type: 'string', example: 'station' },
              from_location: { type: 'string', example: 'ST001' },
              to_type: { type: 'string', example: 'inventory' },
              to_location: { type: 'string', example: 'R10X23' },
              timestamp: { type: 'string', format: 'date-time', example: '2025-09-04T12:34:56Z' }
            }
          }
        }
      }
    }
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid query parameters',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Invalid source_type value' },
        error: { type: 'string', example: 'Bad Request' },
        statusCode: { type: 'number', example: 400 }
      }
    }
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.FLOWOPS_ADMIN, Role.FLOWOPS_OPERATOR, Role.ADMIN)
  async getTravelAnalysisMovements(
    @Query('source_type') sourceType: string,
    @Query('source_location') sourceLocation: string | string[],
    @Query('destination_type') destinationType: string,
    @Query('start_time') startTime?: string,
    @Query('end_time') endTime?: string,
    @Query('module') module: "FlowOps" | "BaseOps" = "FlowOps"
  ) {
    const validTypes = ['station', 'waiting_location', 'inventory', 'empty_location'];

    if (sourceType && !validTypes.includes(sourceType)) {
      throw new BadRequestException('Invalid source_type value');
    }
    if (destinationType && !validTypes.includes(destinationType)) {
      throw new BadRequestException('Invalid destination_type value');
    }

    let startDate: Date | undefined;
    let endDate: Date | undefined;

    if (startTime) {
      startDate = new Date(startTime);
      if (isNaN(startDate.getTime())) {
        throw new BadRequestException('Invalid start_time format. Use ISO 8601 format (e.g., 2025-09-04T00:00:00Z)');
      }
    }

    if (endTime) {
      endDate = new Date(endTime);
      if (isNaN(endDate.getTime())) {
        throw new BadRequestException('Invalid end_time format. Use ISO 8601 format (e.g., 2025-09-04T23:59:59Z)');
      }
    }

    if (startDate && endDate && startDate >= endDate) {
      throw new BadRequestException('start_time must be before end_time');
    }

    // Normalize sourceLocation to array
    let sourceLocations: string[] = [];
    if (Array.isArray(sourceLocation)) {
      sourceLocations = sourceLocation;
    } else if (typeof sourceLocation === 'string' && sourceLocation.length > 0) {
      // Support comma-separated values
      sourceLocations = sourceLocation.split(',').map(loc => loc.trim()).filter(loc => loc.length > 0);
    }

    return await this.orchestratorService.getTravelAnalysisMovements(
      sourceType,
      sourceLocations,
      destinationType,
      startDate,
      endDate,
      module
    );
  }


  @Put('update-robot')
  @ApiOperation({
    summary: 'Update total robots in system',
    description: 'Updates the total number of robots in the system configuration.',
  })
  @ApiQuery({
    name: 'module',
    description: 'Operation module to update robots (FLOWOPS, BASEOPS or CROSSDOCK)',
    example: 'FLOWOPS'
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        total_robots: { type: 'number', example: 10 }
      },
      required: ['total_robots']
    }
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Total robots updated successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: 'Total robots updated successfully' },
        total_robots: { type: 'number', example: 10 }
      }
    }
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid total_robots parameter',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'total_robots must be a positive number' },
        error: { type: 'string', example: 'Bad Request' },
        statusCode: { type: 'number', example: 400 }
      }
    }
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.FLOWOPS_ADMIN, Role.FLOWOPS_OPERATOR, Role.BASEOPS_ADMIN, Role.CROSSDOCK_ADMIN)
  async updateTotalRobots(@Body('total_robots') totalRobots: number, @Query('module') module: OperationType = OperationType.FLOWOPS) {
    if (!totalRobots || totalRobots <= 0) {
      throw new BadRequestException('total_robots must be a positive number');
    }

    await this.orchestratorService.updateTotalRobots(totalRobots, module);
    
    return {
      success: true,
      message: 'Total robots updated successfully',
      total_robots: totalRobots
    };
  }

  @Get('robots/total')
  @ApiOperation({
    summary: 'Get total number of robots in system',
    description: 'Retrieve the total number of robots configured in the system.',
  })
  @ApiQuery({
    name: 'module',
    description: 'Operation module to get robots (FLOWOPS, BASEOPS or CROSSDOCK)',
    example: 'FLOWOPS'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Total robots retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: 'Total robots retrieved successfully' },
        total_robots: { type: 'number', example: 10 }
      }
    }
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.FLOWOPS_ADMIN, Role.FLOWOPS_OPERATOR, Role.ADMIN)
  async getTotalRobots(@Query('module') module: OperationType = OperationType.FLOWOPS) {
    const totalRobots = await this.orchestratorService.getTotalRobots(module);

    return {
      success: true,
      message: 'Total robots retrieved successfully',
      total_robots: totalRobots
    };
  }
  @Get('robot-status/:robot_id')
  @ApiOperation({
    summary: 'Get robot status by robot ID',
    description: 'Retrieve the current status and details of a specific robot by its ID.',
  })
  @ApiQuery({
    name: 'task_type',
    description: 'Task type to get robot status (e.g. GoodsToPerson)',
    example: 'GoodsToPerson'
  })
  @ApiParam({ name: 'robot_id', description: 'Robot ID', example: 'ROBOT_001' })
    @ApiResponse({
    status: HttpStatus.OK,
    description: 'Robot status retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: 'Robot status retrieved successfully' },
        data: {
          type: 'object',
          properties: {
            current_task: {
              type: 'object',
              properties: {
                created_at: { type: 'string', format: 'date-time', example: '2025-12-24T08:50:05.122Z' },
                updated_at: { type: 'string', format: 'date-time', example: '2025-12-24T08:50:47.835Z' },
                task_id: { type: 'string', format: 'uuid', example: '77c24cf1-0fe4-4a1b-ba8f-e049b9ba2206' },
                display_task_id: { type: 'string', example: '902' },
                batch_id: { type: 'string', example: 'B6566205108' },
                fms_batch_id: { type: 'string', example: 'Batch-20251224142005183' },
                wms_task_id: { type: 'string', nullable: true, example: null },
                origin_location: { type: 'string', example: 'R10X02' },
                priority: { type: 'number', nullable: true, example: null },
                task_type: { type: 'string', example: 'GoodsToPerson' },
                status: { type: 'string', example: 'COMPLETED' },
                move_type: { type: 'string', example: 'InventoryToStation' },
                sequence_order: { type: 'number', example: 1 },
                task_dependency: { type: 'string', nullable: true, example: null },
                robot_id: { type: 'string', example: 'MAIA-001' },
                start_location: {
                  type: 'object',
                  properties: {
                    location_id: { type: 'string', example: 'R10X02' },
                    location_type: { type: 'string', example: 'PALLET' },
                    location_action: { type: 'string', example: 'PICK' },
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
                    location_id: { type: 'string', example: 'ST001' },
                    location_type: { type: 'string', example: 'PALLET' },
                    location_action: { type: 'string', example: 'NOP_PAUSE' },
                    location_attribute: {
                      type: 'object',
                      properties: {
                        attribute_name: { type: 'string', example: 'location_type' },
                        attribute_value: { type: 'string', example: 'station' }
                      }
                    }
                  }
                },
                wait: { type: 'string', nullable: true, example: null },
                cargos: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      cargo_code: { type: 'string', example: '843920174599' },
                      cargo_type: { type: 'string', example: 'PALLET' },
                      cargo_dimension: {
                        type: 'object',
                        properties: {
                          length: { type: 'number', example: 1 },
                          width: { type: 'number', example: 1 },
                          height: { type: 'number', example: 1 }
                        }
                      },
                      cargo_weight: { type: 'number', example: 0 },
                      cargo_attributes: { type: 'object', nullable: true, example: null }
                    }
                  }
                },
                pause_resume_logs: { type: 'array', nullable: true, example: null },
                task_acknowledged: { type: 'string', format: 'date-time', example: '2025-12-24T08:50:06.625Z' },
                inqueue: { type: 'string', format: 'date-time', example: '2025-12-24T08:50:06.683Z' },
                processing: { type: 'string', format: 'date-time', example: '2025-12-24T08:50:07.737Z' },
                completed: { type: 'string', format: 'date-time', example: '2025-12-24T08:50:47.831Z' },
                triggered: { type: 'string', format: 'date-time', nullable: true, example: null },
                message: { type: 'string', nullable: true, example: null },
                is_gtp_cancelled: { type: 'boolean', example: false },
                is_paused: { type: 'boolean', example: false }
              }
            },
            robot_name: { type: 'string', example: 'MAIA-001' },
            inventory: {
              type: 'object',
              properties: {
                created_at: { type: 'string', format: 'date-time', example: '2025-12-11T10:28:01.428Z' },
                updated_at: { type: 'string', format: 'date-time', example: '2025-12-19T09:51:42.252Z' },
                id: { type: 'string', example: 'R10X02' },
                location_name: { type: 'string', example: 'FPS002' },
                isProcessing: { type: 'boolean', example: true },
                barcode_number: { type: 'string', example: '843920174599' },
                status: { type: 'string', example: 'AVAILABLE' },
                holded_by: { type: 'string', nullable: true, example: null },
                is_active: { type: 'boolean', example: true },
                is_empty: { type: 'boolean', example: false },
                is_quarantine: { type: 'boolean', example: false }
              }
            },
            station_info: {
              type: 'object',
              properties: {
                created_at: { type: 'string', format: 'date-time', example: '2025-12-11T10:27:36.314Z' },
                updated_at: { type: 'string', format: 'date-time', example: '2025-12-19T06:36:29.880Z' },
                station_id: { type: 'string', example: 'ST001' },
                location_name: { type: 'string', example: 'Station 1' },
                status: { type: 'string', example: 'OCCUPIED' },
                priority: { type: 'number', example: 1 },
                is_active: { type: 'boolean', example: true },
                holded_by: { type: 'string', format: 'uuid', example: '77c24cf1-0fe4-4a1b-ba8f-e049b9ba2206' }
              }
            },
            gtp_location_mappings: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  order_item_id: { type: 'number', example: 547 },
                  gtp_location_id: { type: 'string', example: 'PL001' },
                  station_id: { type: 'string', example: 'ST001' },
                  station_name: { type: 'string', example: 'Station 1' }
                }
              }
            },
            destination_order_items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  order_item_id: { type: 'number', example: 547 },
                  order_batch_id: { type: 'string', example: 'Batch-1766566088396' },
                  destination_pallet_slot_id: { type: 'string', example: 'PL001' },
                  status: { type: 'string', example: 'IN_PROGRESS' }
                }
              }
            }
          }
        }
      }
    }
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Robot not found',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Robot ROBOT_001 not found' }
      }
    }
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.FLOWOPS_ADMIN, Role.FLOWOPS_OPERATOR, Role.BASEOPS_ADMIN, Role.CROSSDOCK_ADMIN)
  async getRobotStatus(@Param('robot_id') robotId: string, @Query('task_type') task_type: TaskType) {
    const robot = await this.orchestratorService.getRobotStatus(robotId, task_type);
    return robot;
  }

  @Post('trigger-order/:orderId')
  @ApiOperation({
    summary: 'Trigger orchestrator process for a specific order',
    description: 'Manually start the orchestrator process for the given order ID with provided source and Pick Location.',
  })
  @ApiParam({ name: 'orderId', description: 'Order ID', example: '123456' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Orchestrator process triggered for order successfully',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Orchestrator process triggered for order successfully' }
      }
    }
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.FLOWOPS_ADMIN, Role.FLOWOPS_OPERATOR, Role.ADMIN)
  async triggerOrder(
    @Param('orderId') orderId: string,
    @Body('source_location') sourceLocation: string,
    @Body('gtp_location_id') gtpLocationId: string
  ) {
    return await this.orchestratorService.triggerOrderService(orderId, sourceLocation, gtpLocationId);
  }

}
