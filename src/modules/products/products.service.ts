import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, LessThan, MoreThanOrEqual, Repository } from 'typeorm';
import { Product } from 'src/entities/product.entity';
import { OrderItem } from 'src/entities';

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    @InjectRepository(OrderItem)
    private readonly orderItemRepository: Repository<OrderItem>,
  ) {}

  async create(createProductDto: Product) {
    const existingProduct = await this.productRepository.findOne({ 
      where: { product_id: createProductDto.product_id } 
    });
    
    if (existingProduct) {
      throw new BadRequestException(`Product with id ${createProductDto.product_id} already exists`);
    }
    
    const newProduct = this.productRepository.create(createProductDto);
    return await this.productRepository.save(newProduct);
  }

  async findAll() {
    return await this.productRepository.find();
  }

  async findOne(id: string) {
    const product = await this.productRepository.findOne({ where: { product_id: id } });
    
    if (!product) {
      throw new NotFoundException(`Product with id ${id} not found`);
    }
    
    return product;
  }

  async update(id: string, updateProductDto: Product) {
    const existingProduct = await this.productRepository.findOne({ where: { product_id: id } });
    
    if (!existingProduct) {
      throw new NotFoundException(`Product with id ${id} not found`);
    }
    
    await this.productRepository.update({ product_id: id }, updateProductDto);
    return await this.productRepository.findOne({ where: { product_id: id } });
  }

  async remove(id: string) {
    const existingProduct = await this.productRepository.findOne({ where: { product_id: id } });
    
    if (!existingProduct) {
      throw new NotFoundException(`Product with id ${id} not found`);
    }
    
    await this.productRepository.delete({ product_id: id });
    return { message: `Product with id ${id} has been removed` };
  }

  async getProductOrderReportSummary(start_time: Date | undefined, end_time: Date | undefined) {
      const whereCondition: any = {};
      if (start_time && end_time) {
        whereCondition.created_at = Between(start_time, end_time);
      }
      else if (start_time){
        whereCondition.created_at = MoreThanOrEqual(start_time);
      }
      else if (end_time){
        whereCondition.created_at = LessThan(end_time);
      }
      const orderItems = await this.orderItemRepository.find({
        where: whereCondition,
      });
      const res: any = {};
      for (const item of orderItems) {
        if (!res[item.product_id]) {
          res[item.product_id] = {
            completed: 0,
            in_progress: 0,
            cancelled: 0,
            pending: 0,
            assigned: 0,
            remaining_quantity_to_fulfill: 0,
            total_quantity: 0,
          };
        }
        res[item.product_id][item.status.toLocaleLowerCase()] += 1;
        res[item.product_id].remaining_quantity_to_fulfill += item.remaining_quantity;
        res[item.product_id].total_quantity += item.quantity;
      }

      return res;
  }
}
