import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, HttpStatus, HttpCode } from '@nestjs/common';
import { WaitingLocationService } from './waiting_location.service';
import { CreateWaitingLocationDto } from './dto/create-waiting_location.dto';
import { UpdateWaitingLocationDto } from './dto/update-waiting_location.dto';
import { JwtAuthGuard } from '../auth/guard/auth.guard';
import { RolesGuard } from '../auth/guard/roles.guard';
import { Roles } from '../auth/guard/roles.decorator';
import { ApiBody, ApiOperation, ApiParam, ApiResponse } from '@nestjs/swagger';
import { NotFoundResponseDto } from 'src/common/dto/common-responses.dto';
import { Role } from 'src/entities/user.entity';

@Controller('waiting-location')
export class WaitingLocationController {
  constructor(private readonly waitingLocationService: WaitingLocationService) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.FLOWOPS_ADMIN)
  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get all waiting locations',
    description: 'Retrieve a list of all waiting locations in the system.'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'List of all waiting locations',
    schema: {
      example: [
        {
          created_at: '2025-12-11T10:27:36.344Z',
          updated_at: '2025-12-11T10:27:36.344Z',
          location_id: 'WA0101',
          location_name: 'Wait 1',
          status: 'AVAILABLE',
          is_active: false,
          holded_by: null,
          type: 'STATION_TO_STATION'
        }
      ]
    }
  })
  async findAll() {
    return await this.waitingLocationService.findAll();
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.FLOWOPS_ADMIN)
  @ApiOperation({
    summary: 'Get a waiting location by ID',
    description: 'Retrieve the details of a specific waiting location using its unique ID.'
  })
  @ApiParam({ name: 'id', description: 'Waiting Location ID', example: 'WA0101' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Waiting location details',
    schema: {
      example: {
        created_at: '2025-12-11T10:27:36.344Z',
        updated_at: '2025-12-11T10:27:36.344Z',
        location_id: 'WA0101',
        location_name: 'Wait 1',
        status: 'AVAILABLE',
        is_active: false,
        holded_by: null,
        type: 'STATION_TO_STATION'
      }
    }
  })
  async findOne(@Param('id') id: string) {
    return await this.waitingLocationService.findOne(id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.FLOWOPS_ADMIN)
  @ApiOperation({
    summary: 'Update a waiting location',
    description: 'Update the details of an existing waiting location by its ID.'
  })
  @ApiParam({ name: 'id', description: 'Waiting Location ID', example: 'WA0101' })
  @ApiBody({ type: UpdateWaitingLocationDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'The updated waiting location.',
    schema: {
      example: {
        created_at: '2025-12-11T10:27:36.344Z',
        updated_at: '2025-12-19T09:57:33.351Z',
        location_id: 'WA0101',
        location_name: 'Wait 1',
        status: 'AVAILABLE',
        is_active: false,
        holded_by: null,
        type: 'STATION_TO_STATION'
      }
    }
  })
  async update(@Param('id') id: string, @Body() updateWaitingLocationDto: UpdateWaitingLocationDto) {
    return await this.waitingLocationService.update(id, updateWaitingLocationDto);
  }
  @Get(':id/active-robot')
  @ApiOperation({
    summary: 'Get the active robot at a waiting location',
    description: 'Retrieve the currently active robot assigned to the specified waiting location.'
  })
  @ApiParam({ name: 'id', description: 'Waiting Location ID', example: 'WA0101' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Active robot at the waiting location. If no robot is present, robot_id is null and other fields are omitted.',
    schema: {
      example: {
        // when a robot is present
        robot_id: 'RB001',
        source: 'ST001',
        status: 'active',
        completed_time: '2025-12-19T09:57:33.351Z'
        // when no robot is present:
        // { robot_id: null }
      }
    }
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Station or active robot not found',
    type: NotFoundResponseDto
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.FLOWOPS_ADMIN, Role.FLOWOPS_OPERATOR)
  async getActiveRobot(@Param('id') id: string) {
    return await this.waitingLocationService.getActiveRobotAtWaiting(id);
  }
}
