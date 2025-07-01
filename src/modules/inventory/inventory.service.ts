import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateInventoryDto } from './dto/create-inventory.dto';
import { UpdateInventoryDto } from './dto/update-inventory.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Inventory } from 'src/entities/inventory.entity';
import { Product } from 'src/entities/product.entity';
import { UploadInventoryResponseDto } from './dto/upload-inventory-response.dto';

@Injectable()
export class InventoryService {
  constructor(
    @InjectRepository(Inventory)
    private readonly inventoryRepository: Repository<Inventory>,
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
  ) {}

  async create(createInventoryDto: Inventory) {
    // Check if product_id exists in Product repository
    const product = await this.productRepository.findOne({ 
      where: { product_id: createInventoryDto.product_id } 
    });
    
    if (!product) {
      throw new NotFoundException(`Product with id ${createInventoryDto.product_id} not found`);
    }

    // Check if inventory already exists for this product
    const existingInventory = await this.inventoryRepository.findOne({ 
      where: { id: createInventoryDto.id } 
    });
    
    if (existingInventory) {
      throw new BadRequestException(`Inventory with id ${existingInventory.id} already exists`);
    }

    const newInventory = this.inventoryRepository.create(createInventoryDto);
    return await this.inventoryRepository.save(newInventory);
  }

  async findAll() {
    return await this.inventoryRepository.find({
      relations: ['product']
    });
  }

  async findOne(id: string) {
    const inventory = await this.inventoryRepository.findOne({ 
      where: { id },
      relations: ['product']
    });
    
    if (!inventory) {
      throw new NotFoundException(`Inventory with id ${id} not found`);
    }
    
    return inventory;
  }

  async findByProductId(productId: string) {
    const inventory = await this.inventoryRepository.findOne({ 
      where: { product_id: productId },
      relations: ['product']
    });
    
    if (!inventory) {
      throw new NotFoundException(`Inventory for product ${productId} not found`);
    }
    
    return inventory;
  }

  async update(id: string, updateInventoryDto: Inventory) {
    const existingInventory = await this.inventoryRepository.findOne({ where: { id } });
    
    if (!existingInventory) {
      throw new NotFoundException(`Inventory with id ${id} not found`);
    }

    // If product_id is being updated, check if the new product exists
    if (updateInventoryDto.product_id && updateInventoryDto.product_id !== existingInventory.product_id) {
      const product = await this.productRepository.findOne({ 
        where: { product_id: updateInventoryDto.product_id } 
      });
      
      if (!product) {
        throw new NotFoundException(`Product with id ${updateInventoryDto.product_id} not found`);
      }
    }

    await this.inventoryRepository.update(id, updateInventoryDto);
    if (updateInventoryDto.id) {
      id = updateInventoryDto.id;
    }

    return await this.inventoryRepository.findOne({ 
      where: { id: id },
      relations: ['product']
    });
  }

  async remove(id: string) {
    const existingInventory = await this.inventoryRepository.findOne({ where: { id } });
    
    if (!existingInventory) {
      throw new NotFoundException(`Inventory with id ${id} not found`);
    }
    
    await this.inventoryRepository.delete(id);
    return { message: `Inventory with id ${id} has been removed` };
  }

  async updateQuantity(id: string, quantity: number) {
    const existingInventory = await this.inventoryRepository.findOne({ where: { id } });
    
    if (!existingInventory) {
      throw new NotFoundException(`Inventory with id ${id} not found`);
    }

    if (quantity < 0) {
      throw new BadRequestException('Quantity cannot be negative');
    }

    await this.inventoryRepository.update(id, { quantity });
    return await this.inventoryRepository.findOne({ 
      where: { id },
      relations: ['product']
    });
  }

  async processInventoryFile(file: Express.Multer.File): Promise<UploadInventoryResponseDto> {
    try {
      const csvData = file.buffer.toString('utf8');
      const lines = csvData.split('\n').filter(line => line.trim());
      
      if (lines.length === 0) {
        throw new BadRequestException('CSV file is empty');
      }

      // Parse header
      const headers = lines[0].split(',').map(h => h.trim());
      const expectedHeaders = ['Inv Locations', 'Product ID', 'Qty'];
      
      // Validate headers
      if (!expectedHeaders.every(header => headers.includes(header))) {
        throw new BadRequestException(`Invalid CSV format. Expected headers: ${expectedHeaders.join(', ')}`);
      }

      const results = {
        successful: 0,
        failed: 0,
        errors: [] as string[]
      };

      // Process each row (skip header)
      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map(v => v.trim());
        
        if (values.length < 3) {
          results.failed++;
          results.errors.push(`Row ${i + 1}: Invalid number of columns`);
          continue;
        }

        const invLocation = values[0]; // Inv Locations
        const productId = values[1];   // Product ID
        const qty = parseInt(values[2]); // Qty

        if (!invLocation || !productId || isNaN(qty)) {
          results.failed++;
          results.errors.push(`Row ${i + 1}: Missing required fields (Inv Locations, Product ID, or Qty)`);
          continue;
        }

        try {
          // Try to update existing inventory first
          const existingInventory = await this.inventoryRepository.findOne({ 
            where: { id: invLocation } 
          });

          if (existingInventory) {
            // Update existing inventory
            const inventoryData = {
              product_id: productId,
              quantity: qty
            } as Inventory;

            await this.update(invLocation, inventoryData);
            results.successful++;
          } else {
            // Create new inventory entry if it doesn't exist
            const inventoryData = {
              id: invLocation,
              product_id: productId,
              quantity: qty
            } as Inventory;

            await this.create(inventoryData);
            results.successful++;
          }
        } catch (error) {
          results.failed++;
          results.errors.push(`Row ${i + 1}: ${error.message}`);
        }
      }

      return {
        message: `Processed ${results.successful + results.failed} rows`,
        successful: results.successful,
        failed: results.failed,
        errors: results.errors
      };

    } catch (error) {
      throw new BadRequestException(`Failed to process CSV file: ${error.message}`);
    }
  }
}
