import { Controller, Get, Post, Body, Patch, Param, Delete, HttpStatus, BadRequestException, UseGuards, HttpCode } from '@nestjs/common';
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

@ApiTags('Pick Locations')
@Controller('gtp')
export class GtpController {
  constructor(private readonly gtpService: GtpService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ 
    summary: 'Create a new Pick Location',
    description: 'Create a new Goods To Person location with the specified details. The Pick Location ID must be unique.'
  })
  @ApiBody({ type: CreateGtpDto })
  @ApiResponse({ 
    status: HttpStatus.CREATED, 
    description: 'Pick Location created successfully',
    type: GtpLocationResponseDto
  })
  @ApiResponse({ 
    status: HttpStatus.BAD_REQUEST, 
    description: 'Invalid input data or validation errors',
    type: ValidationErrorResponseDto
  })
  @ApiResponse({ 
    status: HttpStatus.CONFLICT, 
    description: 'Pick Location with this ID already exists',
    type: ConflictResponseDto
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.FLOWOPS_ADMIN, Role.ADMIN, Role.FLOWOPS_OPERATOR)
  async create(@Body() createGtpDto: CreateGtpDto) {
    return await this.gtpService.create(createGtpDto as any);
  }

  @Get()
  @ApiOperation({ 
    summary: 'Get all Pick Locations',
    description: 'Retrieve a list of all Pick Locations in the system.'
  })
  @ApiResponse({ 
    status: HttpStatus.OK, 
    description: 'List of all Pick Locations',
    type: [GtpLocationResponseDto]
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.FLOWOPS_ADMIN, Role.ADMIN, Role.FLOWOPS_OPERATOR)
  findAll() {
    return this.gtpService.findAll();
  }

  @Get(':id')
  @ApiOperation({ 
    summary: 'Get a Pick Location by ID',
    description: 'Retrieve a specific Pick Location by its unique identifier.'
  })
  @ApiParam({ name: 'id', description: 'Pick Location ID', example: 'GTP001' })
  @ApiResponse({ 
    status: HttpStatus.OK, 
    description: 'Pick Location found',
    type: GtpLocationResponseDto
  })
  @ApiResponse({ 
    status: HttpStatus.NOT_FOUND, 
    description: 'Pick Location not found',
    type: NotFoundResponseDto
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.FLOWOPS_ADMIN, Role.ADMIN, Role.FLOWOPS_OPERATOR)
  async findOne(@Param('id') id: string) {
    return await this.gtpService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ 
    summary: 'Update a Pick Location',
    description: 'Update an existing Pick Location with new details. Only provided fields will be updated.'
  })
  @ApiParam({ name: 'id', description: 'Pick Location ID', example: 'GTP001' })
  @ApiBody({ type: UpdateGtpDto })
  @ApiResponse({ 
    status: HttpStatus.OK, 
    description: 'Pick Location updated successfully',
    type: GtpLocationResponseDto
  })
  @ApiResponse({ 
    status: HttpStatus.NOT_FOUND, 
    description: 'Pick Location not found',
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
    summary: 'Delete a Pick Location',
    description: 'Remove a Pick Location from the system. This action cannot be undone.'
  })
  @ApiParam({ name: 'id', description: 'Pick Location ID', example: 'GTP001' })
  @ApiResponse({ 
    status: HttpStatus.OK, 
    description: 'Pick Location deleted successfully',
    type: SuccessResponseDto
  })
  @ApiResponse({ 
    status: HttpStatus.NOT_FOUND, 
    description: 'Pick Location not found',
    type: NotFoundResponseDto
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.FLOWOPS_ADMIN, Role.ADMIN, Role.FLOWOPS_OPERATOR)
  async remove(@Param('id') id: string) {
    return await this.gtpService.remove(id);
  }
}
