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

  @Post('upload')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'operator')
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
          description: 'CSV file with columns: Inv Locations, Product ID, Qty'
        }
      },
      required: ['file']
    }
  })
  @ApiResponse({ 
    status: HttpStatus.OK, 
    description: 'File processed successfully', 
    type: UploadInventoryResponseDto 
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

  @Get('product/:productId')
  @ApiOperation({ 
    summary: 'Get inventory entries by product ID',
    description: 'Retrieve all inventory entries for a specific product.'
  })
  @ApiParam({ name: 'productId', description: 'Product ID', example: 'PRD001' })
  @ApiResponse({ 
    status: HttpStatus.OK, 
    description: 'Inventory entries found for the product',
    type: [InventoryResponseDto]
  })
  @ApiResponse({ 
    status: HttpStatus.NOT_FOUND, 
    description: 'No inventory found for the product',
    type: NotFoundResponseDto
  })
  async findByProductId(@Param('productId') productId: string) {
    return await this.inventoryService.findByProductId(productId);
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

  @Put(':id/quantity')
  @ApiOperation({ summary: 'Update inventory quantity' })
  @ApiParam({ name: 'id', description: 'Inventory ID', example: 'INV001' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        quantity: {
          type: 'number',
          description: 'New quantity value',
          example: 150,
          minimum: 0,
        }
      },
      required: ['quantity']
    }
  })
  @ApiResponse({ status: HttpStatus.OK, description: 'Inventory quantity updated successfully' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Inventory entry not found' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Invalid quantity value' })
  async updateQuantity(@Param('id') id: string, @Body() body: { quantity: number }) {
    return await this.inventoryService.updateQuantity(id, body.quantity);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete an inventory entry' })
  @ApiParam({ name: 'id', description: 'Inventory ID', example: 'INV001' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Inventory deleted successfully' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Inventory entry not found' })
  async remove(@Param('id') id: string) {
    return await this.inventoryService.remove(id);
  }


  // @ApiTags('inventory')
  // @Put(':id/barcode-image')
  // @HttpCode(HttpStatus.OK)
  // @UseGuards(JwtAuthGuard, RolesGuard)
  // @Roles('admin', 'operator')
  // @UseInterceptors(FileInterceptor('barcode_image', {
  //   fileFilter: (req, file, callback) => {
  //     // Only allow image files
  //     if (!file.mimetype.startsWith('image/')) {
  //       return callback(new BadRequestException('Only image files are allowed'), false);
  //     }
  //     callback(null, true);
  //   },
  //   limits: {
  //     fileSize: 5 * 1024 * 1024, // 5MB limit
  //   },
  // }))
  // @ApiOperation({ 
  //   summary: 'Update inventory item with barcode image',
  //   description: 'Upload and store a barcode image for an existing inventory item'
  // })
  // @ApiParam({ 
  //   name: 'id', 
  //   type: 'string', 
  //   description: 'Inventory ID',
  //   example: 'INV001'
  // })
  // @ApiConsumes('multipart/form-data')
  // @ApiResponse({ 
  //   status: 200, 
  //   description: 'Barcode image updated successfully',
  //   type: Inventory
  // })
  // @ApiResponse({ 
  //   status: 400, 
  //   description: 'Bad request - Invalid file or missing file' 
  // })
  // @ApiResponse({ 
  //   status: 404, 
  //   description: 'Inventory item not found' 
  // })
  // async updateBarcodeImage(
  //   @Param('id') inventoryId: string,
  //   @UploadedFile() file: Express.Multer.File,
  // ): Promise<Inventory> {
  //   // Validate file upload
  //   if (!file) {
  //     throw new BadRequestException('Barcode image file is required');
  //   }

  //   // Validate file size (additional check)
  //   if (file.size > 5 * 1024 * 1024) {
  //     throw new BadRequestException('File size must be less than 5MB');
  //   }

  //   // Check if inventory item exists
  //   const existingInventory = await this.inventoryService.findOne(inventoryId);
  //   if (!existingInventory) {
  //     throw new NotFoundException(`Inventory item with ID ${inventoryId} not found`);
  //   }

  //   // Update inventory with barcode image data
  //   const updateData = {
  //     barcode_image: file.buffer,
  //     barcode_image_name: file.originalname,
  //     barcode_image_mimetype: file.mimetype,
  //     barcode_image_size: file.size,
  //   };

  //   const updatedInventory = await this.inventoryService.updateBarcodeImage(
  //     inventoryId, 
  //     updateData
  //   );

  //   return updatedInventory;
  // }

  // @Get(':id/barcode-image')
  // @ApiOperation({ 
  //   summary: 'Get barcode image for inventory item',
  //   description: 'Retrieve the barcode image for a specific inventory item'
  // })
  // @ApiParam({ 
  //   name: 'id', 
  //   type: 'string', 
  //   description: 'Inventory ID',
  //   example: 'INV001'
  // })
  // @ApiResponse({ 
  //   status: 200, 
  //   description: 'Barcode image retrieved successfully'
  // })
  // @ApiResponse({ 
  //   status: 404, 
  //   description: 'Inventory item or barcode image not found' 
  // })
  // async getBarcodeImage(
  //   @Param('id') inventoryId: string,
  //   @Res() res: Response,
  // ): Promise<void> {
  //   // Find inventory item
  //   const inventory = await this.inventoryService.findOne(inventoryId);
  //   if (!inventory) {
  //     throw new NotFoundException(`Inventory item with ID ${inventoryId} not found`);
  //   }

  //   // Check if barcode image exists
  //   if (!inventory.barcode_image) {
  //     throw new NotFoundException(`Barcode image not found for inventory item ${inventoryId}`);
  //   }

  //   // Set response headers
  //   res.set({
  //     'Content-Type': inventory.barcode_image_mimetype || 'image/jpeg',
  //     'Content-Length': inventory.barcode_image_size?.toString() || inventory.barcode_image.length.toString(),
  //     'Content-Disposition': `inline; filename="${inventory.barcode_image_name || `barcode-${inventoryId}.jpg`}"`,
  //     'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
  //   });

  //   // Send the image buffer
  //   res.send(inventory.barcode_image);
  // }
}
