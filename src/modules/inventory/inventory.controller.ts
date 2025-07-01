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
  BadRequestException 
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { InventoryService } from './inventory.service';
import { Inventory } from 'src/entities/inventory.entity';
import { UploadInventoryResponseDto } from './dto/upload-inventory-response.dto';

@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Post()
  async create(@Body() createInventoryDto: Inventory) {
    return await this.inventoryService.create(createInventoryDto);
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
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
  async findAll() {
    return await this.inventoryService.findAll();
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return await this.inventoryService.findOne(id);
  }

  @Get('product/:productId')
  async findByProductId(@Param('productId') productId: string) {
    return await this.inventoryService.findByProductId(productId);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() updateInventoryDto: Inventory) {
    return await this.inventoryService.update(id, updateInventoryDto);
  }

  @Put(':id/quantity')
  async updateQuantity(@Param('id') id: string, @Body() body: { quantity: number }) {
    return await this.inventoryService.updateQuantity(id, body.quantity);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return await this.inventoryService.remove(id);
  }
}
