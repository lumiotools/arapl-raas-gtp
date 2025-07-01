import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from 'src/entities/product.entity';

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
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
}
