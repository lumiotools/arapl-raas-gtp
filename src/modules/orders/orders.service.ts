import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as XLSX from 'xlsx';
import * as csv from 'csv-parser';
import { Readable } from 'stream';
import { Order, OrderStatus } from '../../entities/order.entity';
import { OrderItem, OrderItemStatus } from '../../entities/order-item.entity';
import { Product } from '../../entities/product.entity';
import {
  UploadOrderItemDto,
  ProcessedOrderItemDto,
  UploadResponseDto,
} from './dto/upload-order.dto';

@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(Order)
    private orderRepository: Repository<Order>,
    @InjectRepository(OrderItem)
    private orderItemRepository: Repository<OrderItem>,
    @InjectRepository(Product)
    private productRepository: Repository<Product>,
  ) {}

  async processFile(file: Express.Multer.File): Promise<UploadResponseDto> {
    const fileExtension = this.getFileExtension(file.originalname);
    let data: UploadOrderItemDto[] = [];

    try {
      if (fileExtension === 'csv') {
        data = await this.parseCSV(file.buffer);
      } else if (['xlsx', 'xls'].includes(fileExtension)) {
        data = await this.parseExcel(file.buffer);
      } else {
        throw new BadRequestException(
          'Unsupported file format. Please upload CSV or Excel files.',
        );
      }

      return await this.saveToDatabase(data);
    } catch (error) {
      throw new BadRequestException(`Error processing file: ${error.message}`);
    }
  }

  private getFileExtension(filename: string): string {
    return filename.split('.').pop()?.toLowerCase() || '';
  }

  private async parseCSV(buffer: Buffer): Promise<UploadOrderItemDto[]> {
    return new Promise((resolve, reject) => {
      const results: UploadOrderItemDto[] = [];
      const stream = Readable.from(buffer);

      stream
        .pipe(csv())
        .on('data', (data) => {
          // Convert string quantity to number
          const processedData = {
            ...data,
            Qty: parseInt(data['Qty'], 10),
          };
          results.push(processedData);
        })
        .on('end', () => resolve(results))
        .on('error', reject);
    });
  }

  private async parseExcel(buffer: Buffer): Promise<UploadOrderItemDto[]> {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);

    return data.map((row: any) => ({
      ...row,
      Qty: parseInt(row['Qty'], 10),
    }));
  }

  private async saveToDatabase(
    data: UploadOrderItemDto[],
  ): Promise<UploadResponseDto> {
    const processedOrders = new Set<string>();
    const skippedOrders = new Set<string>();
    let processedItems = 0;

    // Validate data structure first
    if (data.length === 0) {
      throw new BadRequestException('No valid data found in file');
    }

    // Check if required columns exist
    const firstItem = data[0];
    const requiredColumns = [
      'Order ID',
      'Product Id',
      'Qty',
      'License Plate ID',
    ];
    const missingColumns = requiredColumns.filter((col) => !(col in firstItem));

    if (missingColumns.length > 0) {
      throw new BadRequestException(
        `Missing required columns: ${missingColumns.join(', ')}`,
      );
    }

    // Group items by order ID
    const orderGroups = this.groupByOrderId(data);

    for (const [orderId, items] of orderGroups) {
      try {
        // Validate order ID
        if (!orderId || orderId.trim() === '') {
          throw new BadRequestException('Invalid Order ID found in data');
        }

        // Check if order already exists
        const existingOrder = await this.orderRepository.findOne({
          where: { order_id: orderId },
        });

        if (existingOrder) {
          // Skip this order completely if it already exists
          skippedOrders.add(orderId);
          continue;
        }

        // Create new order
        const order = this.orderRepository.create({
          order_id: orderId,
          order_date: new Date(),
          total_items: items.reduce((sum, item) => sum + item['Qty'], 0),
          order_status: OrderStatus.PENDING,
        });
        await this.orderRepository.save(order);
        processedOrders.add(orderId);

        // Process order items only for new orders
        for (const item of items) {
          // Validate item data - throw error immediately for wrong data
          if (
            !item['Product Id'] ||
            !item['License Plate ID'] ||
            !item['Qty']
          ) {
            throw new BadRequestException(
              `Invalid item data for order ${orderId}: missing required fields`,
            );
          }

          // Check if product exists - throw error immediately
          const product = await this.productRepository.findOne({
            where: { product_id: item['Product Id'] },
          });

          if (!product) {
            throw new BadRequestException(
              `Product ${item['Product Id']} not found`,
            );
          }

          // Create order item
          const orderItem = this.orderItemRepository.create({
            order_id: orderId,
            product_id: item['Product Id'],
            quantity: item['Qty'],
            license_plate_id: item['License Plate ID'],
            status: OrderItemStatus.PENDING,
          });

          await this.orderItemRepository.save(orderItem);
          processedItems++;
        }
      } catch (error) {
        throw error;
      }
    }

    if (processedOrders.size === 0 && skippedOrders.size > 0) {
      return {
        success: true,
        message: `All ${skippedOrders.size} orders already exist`,
        processedOrders: 0,
        processedItems: 0,
        errors: undefined,
      };
    }

    return {
      success: true,
      message: `Successfully processed ${processedOrders.size} orders and ${processedItems} items`,
      processedOrders: processedOrders.size,
      processedItems,
      errors: undefined,
    };
  }

  private groupByOrderId(
    data: UploadOrderItemDto[],
  ): Map<string, UploadOrderItemDto[]> {
    const groups = new Map<string, UploadOrderItemDto[]>();

    for (const item of data) {
      const orderId = item['Order ID'];
      if (!groups.has(orderId)) {
        groups.set(orderId, []);
      }
      groups.get(orderId)!.push(item);
    }

    return groups;
  }
}
