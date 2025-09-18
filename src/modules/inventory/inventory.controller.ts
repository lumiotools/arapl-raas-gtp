import { 
  Controller, 
  Get, 
  Post, 
  Body, 
  Patch, 
  Param, 
  Delete, 
  Put, 
  UseInterceptors, 
  UploadedFile, 
  BadRequestException,
  HttpStatus, 
  HttpCode,
  NotFoundException,
  Res,
  UseGuards
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBody, ApiConsumes } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { InventoryService } from './inventory.service';
import { Inventory } from 'src/entities/inventory.entity';
import { UploadInventoryResponseDto } from './dto/upload-inventory-response.dto';
import { CreateInventoryDto } from './dto/create-inventory.dto';
import { UpdateInventoryDto } from './dto/update-inventory.dto';
import { InventoryResponseDto } from './dto/inventory-response.dto';
import { Response } from 'express';
import { 
  SuccessResponseDto, 
  NotFoundResponseDto, 
  ValidationErrorResponseDto, 
  ConflictResponseDto 
} from 'src/common/dto/common-responses.dto';
import { JwtAuthGuard } from '../auth/guard/auth.guard';
import { RolesGuard } from '../auth/guard/roles.guard';
import { Roles } from '../auth/guard/roles.decorator';

@ApiTags('Inventory')
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Post()
  @ApiOperation({ 
    summary: 'Create a new inventory entry',
    description: 'Create a new inventory entry for a product. Inventory ID must be unique and product must exist.'
  })
  @ApiBody({ type: CreateInventoryDto })
  @ApiResponse({ 
    status: HttpStatus.CREATED, 
    description: 'Inventory created successfully',
    type: InventoryResponseDto
  })
  @ApiResponse({ 
    status: HttpStatus.BAD_REQUEST, 
    description: 'Invalid input data, validation errors, or inventory already exists',
    type: ValidationErrorResponseDto
  })
  @ApiResponse({ 
    status: HttpStatus.NOT_FOUND, 
    description: 'Product not found',
    type: NotFoundResponseDto
  })
  @ApiResponse({ 
    status: HttpStatus.CONFLICT, 
    description: 'Inventory with this ID already exists',
    type: ConflictResponseDto
  })
  async create(@Body() createInventoryDto: CreateInventoryDto) {
    return await this.inventoryService.create(createInventoryDto as any);
  }

  @Get()
  @ApiOperation({ 
    summary: 'Get all inventory entries',
    description: 'Retrieve a list of all inventory entries in the system.'
  })
  @ApiResponse({ 
    status: HttpStatus.OK, 
    description: 'List of all inventory entries',
    type: [InventoryResponseDto]
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'operator')
  async findAll() {
    return await this.inventoryService.findAll();
  }

  @Get(':id')
  @ApiOperation({ 
    summary: 'Get an inventory entry by ID',
    description: 'Retrieve a specific inventory entry by its unique identifier.'
  })
  @ApiParam({ name: 'id', description: 'Inventory ID', example: 'INV001' })
  @ApiResponse({ 
    status: HttpStatus.OK, 
    description: 'Inventory entry found',
    type: InventoryResponseDto
  })
  @ApiResponse({ 
    status: HttpStatus.NOT_FOUND, 
    description: 'Inventory entry not found',
    type: NotFoundResponseDto
  })
  async findOne(@Param('id') id: string) {
    return await this.inventoryService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ 
    summary: 'Update an inventory entry',
    description: 'Update an existing inventory entry with new details. Only provided fields will be updated.'
  })
  @ApiParam({ name: 'id', description: 'Inventory ID', example: 'INV001' })
  @ApiBody({ type: UpdateInventoryDto })
  @ApiResponse({ 
    status: HttpStatus.OK, 
    description: 'Inventory updated successfully',
    type: InventoryResponseDto
  })
  @ApiResponse({ 
    status: HttpStatus.NOT_FOUND, 
    description: 'Inventory entry not found',
    type: NotFoundResponseDto
  })
  @ApiResponse({ 
    status: HttpStatus.BAD_REQUEST, 
    description: 'Invalid input data or validation errors',
    type: ValidationErrorResponseDto
  })
  async update(@Param('id') id: string, @Body() updateInventoryDto: UpdateInventoryDto) {
    // Validate that URL parameter ID matches DTO ID if provided
    if (updateInventoryDto.id && updateInventoryDto.id !== id) {
      throw new BadRequestException(
        `URL parameter ID (${id}) must match the ID in request body (${updateInventoryDto.id})`
      );
    }
    
    return await this.inventoryService.update(id, updateInventoryDto as any);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete an inventory entry' })
  @ApiParam({ name: 'id', description: 'Inventory ID', example: 'INV001' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Inventory deleted successfully' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Inventory entry not found' })
  async remove(@Param('id') id: string) {
    return await this.inventoryService.remove(id);
  }

  @Get(':id/active-robot')
  @ApiOperation({
    summary: 'Get the active robot at a station',
    description: 'Retrieve the currently active robot assigned to the specified inventory.'
  })
  @ApiParam({ name: 'id', description: 'Inventory ID', example: 'INV001' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Active robot at the inventory',
    schema: {
      example: {
        robot_id: 'RB001',
        status: 'active',
        assigned_inventory: 'INV001',
        // ...other robot fields
      }
    }
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Inventory or active robot not found',
    type: NotFoundResponseDto
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'operator')
  async getActiveRobot(@Param('id') id: string) {
    return await this.inventoryService.getActiveRobotAtInventory(id);
  }
}
