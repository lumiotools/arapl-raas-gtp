import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  HttpStatus,
  BadRequestException,
  UseGuards,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBody, ApiQuery } from '@nestjs/swagger';
import { StationsService } from './stations.service';
import { CreateStationDto } from './dto/create-station.dto';
import { UpdateStationDto } from './dto/update-station.dto';
import { StationResponseDto } from './dto/station-response.dto';
import {
  SuccessResponseDto,
  NotFoundResponseDto,
  ValidationErrorResponseDto,
  ConflictResponseDto
} from 'src/common/dto/common-responses.dto';
import { Roles } from '../auth/guard/roles.decorator';
import { JwtAuthGuard } from '../auth/guard/auth.guard';
import { RolesGuard } from '../auth/guard/roles.guard';
import { Role } from 'src/entities/user.entity';

@ApiTags('Stations')
@Controller('stations')
export class StationsController {
  constructor(private readonly stationsService: StationsService) { }

  @Post()
  @ApiOperation({
    summary: 'Create a new station',
    description: 'Create a new station with the specified details. Station ID must be unique.'
  })
  @ApiBody({ type: CreateStationDto })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Station created successfully',
    type: StationResponseDto
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid input data or validation errors',
    type: ValidationErrorResponseDto
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'Station with this ID already exists',
    type: ConflictResponseDto
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.FLOWOPS_ADMIN)
  async create(@Body() createStationDto: CreateStationDto) {
    return await this.stationsService.create(createStationDto);
  }
  @Get('unloading-times')
  @ApiOperation({
    summary: 'Get unloading times for all stations',
    description: 'Retrieve the unloading times for all stations in the system within the specified time range.'
  })
  @ApiQuery({ name: 'start_time', required: false, description: 'Start time in ISO 8601 format (e.g., 2025-08-19T09:00:00)' })
  @ApiQuery({ name: 'end_time', required: false, description: 'End time in ISO 8601 format (e.g., 2025-08-19T17:00:00)' })
  @ApiQuery({ name: 'module', required: false, description: 'Module to filter by (FlowOps or BaseOps)', enum: ['FlowOps', 'BaseOps'], example: 'FlowOps' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Unloading times for all stations',
    schema: {
      example: {
        "ST001": {
          "unloading_time": [165, 10, 344, 154, 52, 11, 51, 180, 12]
        }
      }
    }
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.FLOWOPS_ADMIN, Role.FLOWOPS_OPERATOR)
  async getUnloadingTimes(
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
    return await this.stationsService.getUnloadingTimes(startDate, endDate, module);
  }
  @Get()
  @ApiOperation({
    summary: 'Get all stations',
    description: 'Retrieve a list of all stations in the system with their associated GTP locations.'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'List of all stations',
    type: [StationResponseDto]
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.FLOWOPS_ADMIN, Role.FLOWOPS_OPERATOR)
  async findAll() {
    return await this.stationsService.findAll();
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get a station by ID',
    description: 'Retrieve a specific station by its unique identifier.'
  })
  @ApiParam({ name: 'id', description: 'Station ID', example: 'ST001' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Station found',
    type: StationResponseDto
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Station not found',
    type: NotFoundResponseDto
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.FLOWOPS_ADMIN, Role.FLOWOPS_OPERATOR)
  async findOne(@Param('id') id: string) {
    const station = await this.stationsService.findOne(id);
    return station;
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update a station',
    description: 'Update an existing station with new details. Only provided fields will be updated.'
  })
  @ApiParam({ name: 'id', description: 'Station ID', example: 'ST001' })
  @ApiBody({ type: UpdateStationDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Station updated successfully',
    type: StationResponseDto
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Station not found',
    type: NotFoundResponseDto
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid input data or validation errors',
    type: ValidationErrorResponseDto
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.FLOWOPS_ADMIN)
  async update(@Param('id') id: string, @Body() updateStationDto: UpdateStationDto) {
    // Validate that URL parameter ID matches DTO ID if provided
    if (updateStationDto.station_id && updateStationDto.station_id !== id) {
      throw new BadRequestException(
        `URL parameter ID (${id}) must match the ID in request body (${updateStationDto.station_id})`
      );
    }

    return await this.stationsService.update(id, updateStationDto);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Delete a station',
    description: 'Remove a station from the system. This action cannot be undone and will affect associated GTP locations.'
  })
  @ApiParam({ name: 'id', description: 'Station ID', example: 'ST001' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Station deleted successfully',
    type: SuccessResponseDto
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Station not found',
    type: NotFoundResponseDto
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.FLOWOPS_ADMIN)
  async remove(@Param('id') id: string) {
    return await this.stationsService.remove(id);
  }

  @Get(':id/active-robot')
  @ApiOperation({
    summary: 'Get the active robot at a station',
    description: 'Retrieve the currently active robot assigned to the specified station.'
  })
  @ApiParam({ name: 'id', description: 'Station ID', example: 'ST001' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Active robot at the station. If no robot is available, response will contain only robot_id: null.',
    schema: {
      oneOf: [
        {
          example: {
            robot_name: 'RoboOne',
            robot_id: 'RB001',
            source: 'LOC123',
            status: 'active',
            source_location_id: 'LOC123'
          }
        },
        {
          example: {
            robot_id: null
          }
        }
      ]
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
    return await this.stationsService.getActiveRobotAtStation(id);
  }
}
