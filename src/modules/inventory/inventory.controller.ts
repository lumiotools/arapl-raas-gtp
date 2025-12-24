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
import { Role } from 'src/entities/user.entity';

@ApiTags('Inventory')
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) { }

  @Get()
  @ApiOperation({
    summary: 'Get all inventory entries',
    description: 'Retrieve a list of all inventory entries in the system.'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'List of all inventory entries',
    schema: {
      example: [
        {
          created_at: "2025-12-11T10:28:01.437Z",
          updated_at: "2025-12-19T09:57:33.351Z",
          id: "R10X01",
          location_name: "FPS004",
          isProcessing: false,
          barcode_number: "843920174601",
          status: "AVAILABLE",
          holded_by: null,
          is_active: true,
          is_empty: false,
          is_quarantine: false,
          is_at_empty_location: false,
          empty_location_id: null,
          pallet_id: null
        }
      ]
    }
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.FLOWOPS_ADMIN, Role.FLOWOPS_OPERATOR, Role.ADMIN)
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
    schema: {
      example: {
        created_at: "2025-12-11T10:28:01.437Z",
        updated_at: "2025-12-19T09:57:33.351Z",
        id: "R10X01",
        location_name: "FPS004",
        isProcessing: false,
        barcode_number: "843920174601",
        status: "AVAILABLE",
        holded_by: null,
        is_active: true,
        is_empty: false,
        is_quarantine: false,
      }
    }
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
  @ApiBody({ schema: { type: 'object', properties: { id: { type: 'string', example: 'INV001', maxLength: 10 }, barcode_number: { type: 'string', example: '1234567890123', maxLength: 20 }, isProcessing: { type: 'boolean', example: true }, is_active: { type: 'boolean', example: true }, is_empty: { type: 'boolean', example: false }, is_quarantine: { type: 'boolean', example: false }, status: { type: 'string', example: 'AVAILABLE' } }, required: ['id', 'product_id', 'quantity', 'defective_quantity', 'missing_quantity', 'barcode_number', 'isProcessing'] } })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Inventory entry found',
    schema: {
      example: {
        created_at: "2025-12-11T10:28:01.437Z",
        updated_at: "2025-12-19T09:57:33.351Z",
        id: "R10X01",
        location_name: "FPS004",
        isProcessing: false,
        barcode_number: "843920174601",
        status: "AVAILABLE",
        holded_by: null,
        is_active: true,
        is_empty: false,
        is_quarantine: false,
      }
    }
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
  @Post('upload')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.FLOWOPS_ADMIN, Role.FLOWOPS_OPERATOR, Role.ADMIN)
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({
    summary: 'Upload inventory data from CSV file',
    description: 'Bulk upload inventory data from a CSV file. Supports upsert logic - updates existing entries or creates new ones.'
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'CSV file with columns: Inv Locations, barcode_number'
        }
      },
      required: ['file']
    }
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'File processed successfully',
    schema: {
      example: {
        message: "Inventory upload completed",
        successful: 10,
        failed: 2,
        errors: [
          "Row 3: Invalid barcode",
          "Row 7: Location not found"
        ]
      },
      properties: {
        message: { type: 'string', example: 'Inventory upload completed' },
        successful: { type: 'number', example: 10 },
        failed: { type: 'number', example: 2 },
        errors: { type: 'array', items: { type: 'string' }, example: ["Row 3: Invalid barcode", "Row 7: Location not found"] }
      }
    }
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid file format or processing error',
    type: ValidationErrorResponseDto
  })
  async uploadInventory(@UploadedFile() file: Express.Multer.File): Promise<UploadInventoryResponseDto> {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    const allowedExtensions = ['csv'];
    const fileExtension = file.originalname.split('.').pop()?.toLowerCase();

    if (!fileExtension || !allowedExtensions.includes(fileExtension)) {
      throw new BadRequestException('Invalid file format. Please upload a CSV file (.csv)');
    }

    return await this.inventoryService.processInventoryFile(file);
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
        source: 'INV001',
      }
    }
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Inventory or active robot not found',
    type: NotFoundResponseDto
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.FLOWOPS_ADMIN, Role.FLOWOPS_OPERATOR, Role.ADMIN)
  async getActiveRobot(@Param('id') id: string) {
    return await this.inventoryService.getActiveRobotAtInventory(id);
  }
}
