import { Module } from '@nestjs/common';
import { ProductsService } from './products.service';
import { ProductsController } from './products.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Product } from 'src/entities/product.entity';
import { User } from 'src/entities/user.entity';
import { OrderItem } from 'src/entities';

@Module({
  imports: [TypeOrmModule.forFeature([Product,User,OrderItem])],
  controllers: [ProductsController],
  providers: [ProductsService],
})
export class ProductsModule {}
