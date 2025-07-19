import { Controller, Get, Post, Body, Patch, Param, Delete, HttpStatus, BadRequestException, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBody } from '@nestjs/swagger';
import { ProductsService } from './products.service';
import { Product } from 'src/entities/product.entity';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductResponseDto } from './dto/product-response.dto';
import { 
  SuccessResponseDto, 
  NotFoundResponseDto, 
  ValidationErrorResponseDto, 
  ConflictResponseDto 
} from 'src/common/dto/common-responses.dto';
import { Roles } from '../auth/guard/roles.decorator';
import { JwtAuthGuard } from '../auth/guard/auth.guard';
import { RolesGuard } from '../auth/guard/roles.guard';

@ApiTags('Products')
@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Post()
  @ApiOperation({ 
    summary: 'Create a new product',
    description: 'Create a new product in the catalog. Product ID must be unique.'
  })
  @ApiBody({ type: CreateProductDto })
  @ApiResponse({ 
    status: HttpStatus.CREATED, 
    description: 'Product created successfully',
    type: ProductResponseDto
  })
  @ApiResponse({ 
    status: HttpStatus.BAD_REQUEST, 
    description: 'Invalid input data, validation errors, or product already exists',
    type: ValidationErrorResponseDto
  })
  @ApiResponse({ 
    status: HttpStatus.CONFLICT, 
    description: 'Product with this ID already exists',
    type: ConflictResponseDto
  })
  async create(@Body() createProductDto: CreateProductDto) {
    return await this.productsService.create(createProductDto as any);
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'operator')
  @ApiOperation({ 
    summary: 'Get all products',
    description: 'Retrieve a list of all products in the catalog.'
  })
  @ApiResponse({ 
    status: HttpStatus.OK, 
    description: 'List of all products',
    type: [ProductResponseDto]
  })
  async findAll() {
    return await this.productsService.findAll();
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'operator')
  @ApiOperation({ 
    summary: 'Get a product by ID',
    description: 'Retrieve a specific product by its unique identifier.'
  })
  @ApiParam({ name: 'id', description: 'Product ID', example: 'PRD001' })
  @ApiResponse({ 
    status: HttpStatus.OK, 
    description: 'Product found',
    type: ProductResponseDto
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND, 
    description: 'Product not found',
    type: NotFoundResponseDto
  })
  async findOne(@Param('id') id: string) {
    return await this.productsService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update a product',
    description: 'Update an existing product with new details. Only provided fields will be updated.'
  })
  @ApiParam({ name: 'id', description: 'Product ID', example: 'PRD001' })
  @ApiBody({ type: UpdateProductDto })
  @ApiResponse({ 
    status: HttpStatus.OK, 
    description: 'Product updated successfully',
    type: ProductResponseDto
  })
  @ApiResponse({ 
    status: HttpStatus.NOT_FOUND, 
    description: 'Product not found',
    type: NotFoundResponseDto
  })
  @ApiResponse({ 
    status: HttpStatus.BAD_REQUEST, 
    description: 'Invalid input data or validation errors',
    type: ValidationErrorResponseDto
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'operator')
  async update(@Param('id') id: string, @Body() updateProductDto: UpdateProductDto) {
    // Validate that URL parameter ID matches DTO ID if provided
    if (updateProductDto.product_id && updateProductDto.product_id !== id) {
      throw new BadRequestException(
        `URL parameter ID (${id}) must match the ID in request body (${updateProductDto.product_id})`
      );
    }
    
    return await this.productsService.update(id, updateProductDto as any);
  }

  @Delete(':id')
  @ApiOperation({ 
    summary: 'Delete a product',
    description: 'Remove a product from the catalog. This action cannot be undone and may affect related orders and inventory.'
  })
  @ApiParam({ name: 'id', description: 'Product ID', example: 'PRD001' })
  @ApiResponse({ 
    status: HttpStatus.OK, 
    description: 'Product deleted successfully',
    type: SuccessResponseDto
  })
  @ApiResponse({ 
    status: HttpStatus.NOT_FOUND, 
    description: 'Product not found',
    type: NotFoundResponseDto
  })
  async remove(@Param('id') id: string) {
    return await this.productsService.remove(id);
  }
}
