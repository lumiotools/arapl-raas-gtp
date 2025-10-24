import { Controller, Get, Post, Body, Patch, Param, Delete, HttpStatus, BadRequestException, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBody } from '@nestjs/swagger';
import { GtpService } from './gtp.service';
import { CreateGtpDto } from './dto/create-gtp.dto';
import { UpdateGtpDto } from './dto/update-gtp.dto';
import { GtpLocationResponseDto } from './dto/gtp-response.dto';
import { GtpLocation } from 'src/entities';
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

@ApiTags('GTP Locations')
@Controller('gtp')
export class GtpController {
  constructor(private readonly gtpService: GtpService) {}

  @Post()
  @ApiOperation({ 
    summary: 'Create a new GTP location',
    description: 'Create a new Goods To Person location with the specified details. The GTP location ID must be unique.'
  })
  @ApiBody({ type: CreateGtpDto })
  @ApiResponse({ 
    status: HttpStatus.CREATED, 
    description: 'GTP location created successfully',
    type: GtpLocationResponseDto
  })
  @ApiResponse({ 
    status: HttpStatus.BAD_REQUEST, 
    description: 'Invalid input data or validation errors',
    type: ValidationErrorResponseDto
  })
  @ApiResponse({ 
    status: HttpStatus.CONFLICT, 
    description: 'GTP location with this ID already exists',
    type: ConflictResponseDto
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.FLOWOPS_ADMIN, Role.ADMIN, Role.FLOWOPS_OPERATOR)
  async create(@Body() createGtpDto: CreateGtpDto) {
    return await this.gtpService.create(createGtpDto as any);
  }

  @Get()
  @ApiOperation({ 
    summary: 'Get all GTP locations',
    description: 'Retrieve a list of all Goods To Person locations in the system.'
  })
  @ApiResponse({ 
    status: HttpStatus.OK, 
    description: 'List of all GTP locations',
    type: [GtpLocationResponseDto]
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.FLOWOPS_ADMIN, Role.ADMIN, Role.FLOWOPS_OPERATOR)
  findAll() {
    return this.gtpService.findAll();
  }

  @Get(':id')
  @ApiOperation({ 
    summary: 'Get a GTP location by ID',
    description: 'Retrieve a specific Goods To Person location by its unique identifier.'
  })
  @ApiParam({ name: 'id', description: 'GTP location ID', example: 'GTP001' })
  @ApiResponse({ 
    status: HttpStatus.OK, 
    description: 'GTP location found',
    type: GtpLocationResponseDto
  })
  @ApiResponse({ 
    status: HttpStatus.NOT_FOUND, 
    description: 'GTP location not found',
    type: NotFoundResponseDto
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.FLOWOPS_ADMIN, Role.ADMIN, Role.FLOWOPS_OPERATOR)
  async findOne(@Param('id') id: string) {
    return await this.gtpService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ 
    summary: 'Update a GTP location',
    description: 'Update an existing Goods To Person location with new details. Only provided fields will be updated.'
  })
  @ApiParam({ name: 'id', description: 'GTP location ID', example: 'GTP001' })
  @ApiBody({ type: UpdateGtpDto })
  @ApiResponse({ 
    status: HttpStatus.OK, 
    description: 'GTP location updated successfully',
    type: GtpLocationResponseDto
  })
  @ApiResponse({ 
    status: HttpStatus.NOT_FOUND, 
    description: 'GTP location not found',
    type: NotFoundResponseDto
  })
  @ApiResponse({ 
    status: HttpStatus.BAD_REQUEST, 
    description: 'Invalid input data or validation errors',
    type: ValidationErrorResponseDto
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.FLOWOPS_ADMIN, Role.ADMIN, Role.FLOWOPS_OPERATOR)
  async update(@Param('id') id: string, @Body() updateGtpDto: UpdateGtpDto) {
    // Validate that URL parameter ID matches DTO ID if provided
    if (updateGtpDto.gtp_location_id && updateGtpDto.gtp_location_id !== id) {
      throw new BadRequestException(
        `URL parameter ID (${id}) must match the ID in request body (${updateGtpDto.gtp_location_id})`
      );
    }
    
    return await this.gtpService.update(id, updateGtpDto as any);
  }

  @Delete(':id')
  @ApiOperation({ 
    summary: 'Delete a GTP location',
    description: 'Remove a Goods To Person location from the system. This action cannot be undone.'
  })
  @ApiParam({ name: 'id', description: 'GTP location ID', example: 'GTP001' })
  @ApiResponse({ 
    status: HttpStatus.OK, 
    description: 'GTP location deleted successfully',
    type: SuccessResponseDto
  })
  @ApiResponse({ 
    status: HttpStatus.NOT_FOUND, 
    description: 'GTP location not found',
    type: NotFoundResponseDto
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.FLOWOPS_ADMIN, Role.ADMIN, Role.FLOWOPS_OPERATOR)
  async remove(@Param('id') id: string) {
    return await this.gtpService.remove(id);
  }
}
