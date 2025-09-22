import { Module } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { InventoryController } from './inventory.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Inventory } from 'src/entities/inventory.entity';
import { Product } from 'src/entities/product.entity';
import { ProductRequirement } from 'src/entities/product-requirement.entity';
import { User } from 'src/entities/user.entity';
import { Task } from 'src/entities';

@Module({
  imports: [TypeOrmModule.forFeature([Inventory, Product, ProductRequirement, User, Task])],
  controllers: [InventoryController],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
