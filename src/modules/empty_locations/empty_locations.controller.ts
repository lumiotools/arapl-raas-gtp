import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { EmptyLocationsService } from './empty_locations.service';
import { CreateEmptyLocationDto } from './dto/create-empty_location.dto';
import { UpdateEmptyLocationDto } from './dto/update-empty_location.dto';
import { JwtAuthGuard } from '../auth/guard/auth.guard';
import { RolesGuard } from '../auth/guard/roles.guard';
import { Roles } from '../auth/guard/roles.decorator';
import { Role } from 'src/entities/user.entity';
import { ApiBody, ApiOperation, ApiParam, ApiResponse } from '@nestjs/swagger';

@Controller('empty-locations')
/**
 * Controller for managing empty locations.
 *
 * Handles CRUD operations and allocation strategy updates for empty locations.
 *
 * ## Path Parameters
 * - `id`: The unique identifier of the empty location.
 * - `allocation_type`: The type of allocation strategy to apply (`ROUND_ROBIN` or `MANUAL`).
 *
 * @module EmptyLocationsController
 */
export class EmptyLocationsController {
  constructor(private readonly emptyLocationsService: EmptyLocationsService) {}

  @Post()
  create(@Body() createEmptyLocationDto: {location_id: string, location_name: string, is_active: boolean, priority: number}) {
    return this.emptyLocationsService.create(createEmptyLocationDto);
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get all empty locations',
    description: 'Retrieves a list of all empty locations.'
  })
  @ApiResponse({
    status: 200,
    description: 'A list of empty locations.',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          location_name: { type: 'string' },
          status: { type: 'string' },
          priority: { type: 'number' },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' },
          location_id: { type: 'string' },
          is_active: { type: 'boolean' },
          current_pallet: { type: 'string', nullable: true, description: 'barcode number of the current pallet at the empty location' }
        }
      }
    }
  })
  async findAll() {
    return await this.emptyLocationsService.findAll();
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get an empty location by ID',
    description: 'Retrieves a single empty location by its unique ID.'
  })
  @ApiResponse({
    status: 200,
    description: 'The empty location with the specified ID.',
    schema: {
      type: 'object',
      properties: {
        location_name: { type: 'string' },
        status: { type: 'string' },
        priority: { type: 'number' },
        created_at: { type: 'string', format: 'date-time' },
        updated_at: { type: 'string', format: 'date-time' },
        location_id: { type: 'string' },
        is_active: { type: 'boolean' },
      }
    }
  })
  async findOne(@Param('id') id: string) {
    return await this.emptyLocationsService.findOne(id);
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Update an empty location',
    description: 'Updates the details of an existing empty location by its ID.'
  })
  @ApiBody({ schema: {type: 'object', properties:{id: { type: 'string' }, location_name: { type: 'string' }, status: { type: 'string' }, priority: { type: 'number' }}} })
  @ApiResponse({
    status: 200,
    description: 'The updated empty location.',
    schema: {
      type: 'object',
      properties: {
        location_name: { type: 'string' },
        status: { type: 'string' },
        priority: { type: 'number' },
        created_at: { type: 'string', format: 'date-time' },
        updated_at: { type: 'string', format: 'date-time' },
        location_id: { type: 'string' },
        is_active: { type: 'boolean' },
      }
    }
  })
  async update(@Param('id') id: string, @Body() updateEmptyLocationDto: {
    id: string,
    location_name: string,
    status: string,
    priority: number
  }) {
    return await this.emptyLocationsService.update(id, updateEmptyLocationDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.emptyLocationsService.remove(id);
  }

  @Patch('/update-allocation/:allocation_type')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.FLOWOPS_ADMIN, Role.FLOWOPS_OPERATOR)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Update empty location allocation strategy',
    description: 'Updates the allocation strategy for empty locations to either ROUND_ROBIN or MANUAL.'
  })
  @ApiParam({
    name: 'allocation_type',
    enum: ['ROUND_ROBIN', 'MANUAL'],
    description: 'Type of allocation strategy to apply'
  })
  @ApiResponse({
    status: 200,
    description: 'The allocation strategy has been successfully updated.',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string' },
        created_at: { type: 'string', format: 'date-time', nullable: true },
        updated_at: { type: 'string', format: 'date-time' },
        id: { type: 'string', format: 'uuid' },
        operation_type: { type: 'string', enum: ['FLOWOPS'] },
        value: {
          type: 'object',
          properties: {
            EMPTY_LOCATION: { type: 'string', enum: ['MANUAL', 'ROUND_ROBIN'] },
            AUTO_START: { type: 'integer' },
            TASK_ALLOCATION_STRATEGY: { type: 'string', enum: ['LOAD_BALANCE'] }
          },
          required: ['EMPTY_LOCATION', 'AUTO_START', 'TASK_ALLOCATION_STRATEGY']
        }
            },
            required: ['created_at', 'updated_at', 'id', 'operation_type', 'value']
      }
    })
  async updateAllocation(
    @Param('allocation_type') allocationType: 'ROUND_ROBIN' | 'MANUAL'
  ) {
    return await this.emptyLocationsService.updateAllocation(
      allocationType
    );
  }
  @Get(':id/active-robot')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.FLOWOPS_ADMIN, Role.FLOWOPS_OPERATOR)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get active robot at empty location',
    description: 'Retrieves the active robot assigned to a specific empty location by its ID.'
  })
  @ApiParam({
    name: 'id',
    description: 'The unique identifier of the empty location'
  })
  @ApiResponse({
    status: 200,
    description: 'The active robot at the specified empty location. If no active robot, only robot_id (null) is returned.',
    schema: {
      oneOf: [
        {
          type: 'object',
          properties: {
            robot_id: { type: 'string' },
            source: { type: 'string', nullable: true },
            status: { type: 'string' },
            completed_time: { type: 'string', format: 'date-time', nullable: true }
          },
          required: ['robot_id', 'source', 'status', 'completed_time']
        },
        {
          type: 'object',
          properties: {
            robot_id: { type: 'null' }
          },
          required: ['robot_id']
        }
      ]
    }
  })
  async getActiveRobot(@Param('id') id: string) {
    return await this.emptyLocationsService.getActiveRobotAtEmptyLocation(id);
  }
}
