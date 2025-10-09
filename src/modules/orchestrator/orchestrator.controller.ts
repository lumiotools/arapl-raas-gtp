import { Controller, Get, Post, Param, HttpStatus, NotFoundException, Put, UseGuards, Query, BadRequestException, HttpCode, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
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
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.FLOWOPS_ADMIN, Role.FLOWOPS_OPERATOR)
  async triggerOrchestrator() {
    return await this.orchestratorService.writeInDatabase();
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
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.FLOWOPS_ADMIN, Role.FLOWOPS_OPERATOR)
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
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.FLOWOPS_ADMIN, Role.FLOWOPS_OPERATOR)
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
  @Roles(Role.FLOWOPS_ADMIN, Role.FLOWOPS_OPERATOR, Role.BASEOPS_ADMIN)
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
  @ApiParam({ name: 'taskId', description: 'Task ID', example: '123' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Successfully retrieved the task',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: 'Task 123 retrieved successfully' },
        data: {
          type: 'object',
          properties: {
            task_id: { type: 'number', example: 123 },
            batch_id: { type: 'string', example: 'B1641234567' },
            product_id: { type: 'string', example: 'PROD001' },
            quantity: { type: 'number', example: 10 },
            task_type: { type: 'string', example: 'GOODS_TO_PERSON' },
            sequence_order: { type: 'number', example: 1 },
            task_dependency: { type: 'number', example: null },
            status: { type: 'string', example: 'COMPLETED' },
            robot_id: { type: 'string', example: 'ROBOT_001' },
            start_location: { type: 'string', example: 'INV_LOC_001' },
            end_location: { type: 'string', example: 'STATION_A' },
            created_at: { type: 'string', example: '2024-01-15T10:30:00Z' },
            updated_at: { type: 'string', example: '2024-01-15T11:00:00Z' }
          }
        }
      }
    }
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Task not found',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Task with ID 123 not found' },
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

  @Get('tasks/:taskId')
  @ApiOperation({
    summary: 'Get task by task ID',
    description: 'Retrieve detailed information about a specific task using its task ID.',
  })
  @ApiParam({
    name: 'taskId',
    type: 'string',
    description: 'The unique identifier of the task',
    example: '123'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Task retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        task_id: { type: 'number', example: 123 },
        batch_id: { type: 'number', example: 1 },
        product_id: { type: 'string', example: 'P001' },
        from_location_id: { type: 'string', example: 'L001' },
        to_location_id: { type: 'string', example: 'S001' },
        quantity: { type: 'number', example: 5 },
        status: { type: 'string', example: 'PENDING', enum: ['PENDING', 'IN_PROGRESS', 'COMPLETED'] },
        priority: { type: 'number', example: 1 },
        created_at: { type: 'string', format: 'date-time', example: '2024-01-01T00:00:00.000Z' },
        updated_at: { type: 'string', format: 'date-time', example: '2024-01-01T00:00:00.000Z' }
      }
    }
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Task not found',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Task with ID 123 not found' },
        error: { type: 'string', example: 'Not Found' },
        statusCode: { type: 'number', example: 404 }
      }
    }
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid task ID format',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Invalid task ID format' },
        error: { type: 'string', example: 'Bad Request' },
        statusCode: { type: 'number', example: 400 }
      }
    }
  })
  async getTaskById(@Param('taskId') taskId: string) {
    return await this.orchestratorService.getTaskbyID(taskId);
  }

  @Put('product-requirements/pause')
  @ApiOperation({
    summary: 'Pause all product requirements',
    description: 'Sets the isPause attribute of all entries in the product_requirement table to true.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'All product requirements paused successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: 'All product requirements paused successfully' },
        affected: { type: 'number', example: 42 }
      }
    }
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.FLOWOPS_ADMIN, Role.FLOWOPS_OPERATOR)
  async pauseAllProductRequirements() {
    const result = await this.orchestratorService.pauseAllProductRequirements();
    return {
      success: true,
      message: 'All product requirements paused successfully',
      affected: result.affected
    };
  }

  @Put('product-requirements/cancel')
  @ApiOperation({
    summary: 'Cancel all product requirements',
    description: 'Sets the isCancel attribute of all entries in the product_requirement table to true.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'All product requirements Cancelled successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: 'All product requirements cancelled successfully' },
        affected: { type: 'number', example: 42 }
      }
    }
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.FLOWOPS_ADMIN, Role.FLOWOPS_OPERATOR)
  async cancelAllProductRequirements() {
    const result = await this.orchestratorService.cancelAllProductRequirements();
    return {
      success: true,
      message: 'All product requirements cancelled successfully',
      affected: result.affected
    };
  }

  @Put('product-requirements/resume')
  @ApiOperation({
    summary: 'Resume all product requirements',
    description: 'Sets the isPause attribute of all entries in the product_requirement table to true.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'All product requirements paused successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: 'All product requirements paused successfully' },
        affected: { type: 'number', example: 42 }
      }
    }
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.FLOWOPS_ADMIN, Role.FLOWOPS_OPERATOR)
  async ResumeAllProductRequirements() {
    const result = await this.orchestratorService.resumeAllProductRequirements();
    return {
      success: true,
      message: 'All product requirements paused successfully',
      affected: result.affected
    };
  }

  @Get('predicted-robots')
  @ApiOperation({
    summary: 'Get predicted robots',
    description: 'Returns a list of predicted robots based on current system state or requirements.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'List of predicted robots',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          robot_id: { type: 'string', example: 'ROBOT_001' },
          prediction_score: { type: 'number', example: 0.95 },
          status: { type: 'string', example: 'AVAILABLE' }
        }
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
  @Roles(Role.FLOWOPS_ADMIN, Role.FLOWOPS_OPERATOR)
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
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Initial configuration set successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: 'Initial configuration set successfully' },
        data: {
          type: 'object',
          properties: {
            robots_initialized: { type: 'number', example: 5 },
            locations_mapped: { type: 'number', example: 20 },
            configurations_set: { type: 'number', example: 10 }
          }
        }
      }
    }
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Failed to set initial configuration',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: false },
        message: { type: 'string', example: 'Failed to set initial configuration' },
        error: { type: 'string', example: 'Database connection error' }
      }
    }
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.FLOWOPS_ADMIN)
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
    description: 'List of tasks assigned to the robot',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          task_id: { type: 'number', example: 123 },
          batch_id: { type: 'string', example: 'B1641234567' },
          product_id: { type: 'string', example: 'PROD001' },
          quantity: { type: 'number', example: 10 },
          task_type: { type: 'string', example: 'GOODS_TO_PERSON' },
          sequence_order: { type: 'number', example: 1 },
          status: { type: 'string', example: 'IN_PROGRESS' },
          start_location: { type: 'string', example: 'INV_LOC_001' },
          end_location: { type: 'string', example: 'STATION_A' },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' }
        }
      }
    }
  })
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
    @ApiResponse({
      status: HttpStatus.OK,
      description: 'Robot report generated successfully',
      schema: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          message: { type: 'string', example: 'Robot report generated successfully' },
          data: {
            type: 'object',
            properties: {
              total_robots: { type: 'number', example: 10 },
              active_robots: { type: 'number', example: 8 },
              idle_robots: { type: 'number', example: 2 },
              robots: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    robot_id: { type: 'string', example: 'ROBOT_001' },
                    status: { type: 'string', example: 'ACTIVE' },
                    current_task_id: { type: 'number', example: 123 },
                    location: { type: 'string', example: 'ZONE_A' },
                    battery_level: { type: 'number', example: 85 },
                    tasks_completed: { type: 'number', example: 15 },
                    tasks_pending: { type: 'number', example: 3 },
                    last_activity: { type: 'string', format: 'date-time' }
                  }
                }
              }
            }
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
    @Roles(Role.FLOWOPS_ADMIN, Role.FLOWOPS_OPERATOR, Role.BASEOPS_ADMIN)
    async getRobotReport(
      @Query('start_time') startTime?: string,
      @Query('end_time') endTime?: string,
      @Query('module') module: "FlowOps" | "BaseOps" = "FlowOps"
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
    description: 'Generate a report of all robot movements within the specified time range.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Movement report generated successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: 'Movement report generated successfully' },
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              robot_id: { type: 'string', example: 'ROBOT_001' },
              movements: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    from_location: { type: 'string', example: 'ZONE_A' },
                    to_location: { type: 'string', example: 'ZONE_B' },
                    timestamp: { type: 'string', format: 'date-time', example: '2024-01-15T10:30:00Z' }
                  }
                }
              }
            }
          }
        }
      }
    }
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid date format',
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
  @Roles(Role.FLOWOPS_ADMIN, Role.FLOWOPS_OPERATOR, Role.BASEOPS_ADMIN)
  async getMovementReport(
    @Query('start_time') startTime?: string,
    @Query('end_time') endTime?: string,
    @Query('module') module: "FlowOps" | "BaseOps" = "FlowOps"
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
    @Roles(Role.FLOWOPS_ADMIN, Role.FLOWOPS_OPERATOR, Role.BASEOPS_ADMIN)
    @ApiOperation({
    summary: 'Get orders by status and time range',
    description: 'Retrieve all orders filtered by their status and optionally by time range. Multiple statuses can be provided as comma-separated values.',
    })
    @ApiResponse({
    status: HttpStatus.OK,
    description: 'Successfully retrieved orders by status and time range',
    schema: {
      type: 'object',
      properties: {
      success: { type: 'boolean', example: true },
      message: { type: 'string', example: 'Found 5 orders with status PENDING, COMPLETED' },
      data: {
        type: 'array',
        items: {
        type: 'object',
        properties: {
          order_id: { type: 'string', example: 'ORD001' },
          status: { type: 'string', example: 'PENDING' },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' }
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
    @Query('module') module: "FlowOps" | "BaseOps" = "FlowOps"
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
  @Roles(Role.FLOWOPS_ADMIN, Role.FLOWOPS_OPERATOR)
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
  @Roles(Role.FLOWOPS_ADMIN, Role.FLOWOPS_OPERATOR, Role.BASEOPS_ADMIN)
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
  @Roles(Role.FLOWOPS_ADMIN, Role.FLOWOPS_OPERATOR)
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
  @ApiParam({ name: 'robot_id', description: 'Robot ID', example: 'ROBOT_001' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Robot status retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        robot_id: { type: 'string', example: 'ROBOT_001' },
        status: { type: 'string', example: 'AVAILABLE' },
        location: { type: 'string', example: 'ZONE_A' },
        battery_level: { type: 'number', example: 85 },
        last_active: { type: 'string', format: 'date-time', example: '2024-01-15T10:30:00Z' }
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
  @Roles(Role.FLOWOPS_ADMIN, Role.FLOWOPS_OPERATOR, Role.BASEOPS_ADMIN)
  async getRobotStatus(@Param('robot_id') robotId: string, @Query('task_type') task_type: TaskType) {
    const robot = await this.orchestratorService.getRobotStatus(robotId, task_type);
    return robot;
  }

  @Post('trigger-order/:orderId')
  @ApiOperation({
    summary: 'Trigger orchestrator process for a specific order',
    description: 'Manually start the orchestrator process for the given order ID with provided source and GTP location.',
  })
  @ApiParam({ name: 'orderId', description: 'Order ID', example: 'ORD123456' })
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
  @Roles('admin', 'operator')
  async triggerOrder(
    @Param('orderId') orderId: string,
    @Body('source_location') sourceLocation: string,
    @Body('gtp_location_id') gtpLocationId: string
  ) {
    return await this.orchestratorService.triggerOrderService(orderId, sourceLocation, gtpLocationId);
  }

}
