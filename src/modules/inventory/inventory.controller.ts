import { Controller, Get, Post, Body, Patch, Param, Delete, Put } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { Inventory } from 'src/entities/inventory.entity';

@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Post()
  async create(@Body() createInventoryDto: Inventory) {
    return await this.inventoryService.create(createInventoryDto);
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
