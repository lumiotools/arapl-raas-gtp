import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBody } from '@nestjs/swagger';
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

@ApiTags('Stations')
@Controller('stations')
export class StationsController {
  constructor(private readonly stationsService: StationsService) {}

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
  async create(@Body() createStationDto: CreateStationDto) {
    return await this.stationsService.create(createStationDto);
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
  async update(@Param('id') id: string, @Body() updateStationDto: UpdateStationDto) {
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
  async remove(@Param('id') id: string) {
    return await this.stationsService.remove(id);
  }
}
