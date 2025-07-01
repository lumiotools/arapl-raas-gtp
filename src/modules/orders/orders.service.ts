import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as XLSX from 'xlsx';
import * as csv from 'csv-parser';
import { Readable } from 'stream';
import { Order, OrderStatus } from '../../entities/order.entity';
import { OrderItem, OrderItemStatus } from '../../entities/order-item.entity';
import { Product } from '../../entities/product.entity';
import { GtpLocation } from '../../entities/gtp-location.entity';
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
    @InjectRepository(GtpLocation)
    private gtpLocationRepository: Repository<GtpLocation>,
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

    if (data.length === 0) {
      throw new BadRequestException('No valid data found in file');
    }

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

    const orderGroups = this.groupByOrderId(data);

    for (const [orderId, items] of orderGroups) {
      try {
        if (!orderId || orderId.trim() === '') {
          throw new BadRequestException('Invalid Order ID found in data');
        }

        const existingOrder = await this.orderRepository.findOne({
          where: { order_id: orderId },
        });

        if (existingOrder) {
          let hasNewItems = false;

          for (const item of items) {
            const existingOrderItem = await this.orderItemRepository.findOne({
              where: {
                order_id: orderId,
                product_id: item['Product Id'],
                license_plate_id: item['License Plate ID'],
              },
            });

            if (!existingOrderItem) {
              hasNewItems = true;
              break;
            }
          }

          if (!hasNewItems) {
            skippedOrders.add(orderId);
            continue;
          }
        } else {
          const order = this.orderRepository.create({
            order_id: orderId,
            order_date: new Date(),
            total_items: items.reduce((sum, item) => sum + item['Qty'], 0),
            order_status: OrderStatus.PENDING,
          });
          await this.orderRepository.save(order);
          processedOrders.add(orderId);
        }

        for (const item of items) {
          if (
            !item['Product Id'] ||
            !item['License Plate ID'] ||
            !item['Qty']
          ) {
            throw new BadRequestException(
              `Invalid item data for order ${orderId}: missing required fields`,
            );
          }

          const existingOrderItem = await this.orderItemRepository.findOne({
            where: {
              order_id: orderId,
              product_id: item['Product Id'],
              license_plate_id: item['License Plate ID'],
            },
          });

          if (existingOrderItem) {
            continue;
          }

          const product = await this.productRepository.findOne({
            where: { product_id: item['Product Id'] },
          });

          if (!product) {
            throw new BadRequestException(
              `Product ${item['Product Id']} not found`,
            );
          }

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
        errors: undefined,
      };
    }

    return {
      success: true,
      message: `Successfully processed ${processedOrders.size} orders and ${processedItems} items`,
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

  async processAssignmentsFile(file: Express.Multer.File): Promise<UploadResponseDto> {
    try {
      const csvData = file.buffer.toString('utf8');
      const lines = csvData.split('\n').filter(line => line.trim());
      
      if (lines.length === 0) {
        throw new BadRequestException('CSV file is empty');
      }

      // Parse header
      const headers = lines[0].split(',').map(h => h.trim());
      const expectedHeaders = ['GTP Location', 'LP ID', 'Stop ID'];
      
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

        const gtpLocation = values[0]; // GTP Location
        const lpId = values[1];        // LP ID (License Plate ID)
        const stopId = values[2];      // Stop ID (not used for now)

        if (!gtpLocation || !lpId) {
          results.failed++;
          results.errors.push(`Row ${i + 1}: Missing required fields (GTP Location or LP ID)`);
          continue;
        }

        try {
          // Validate that GTP Location exists
          const gtpLocationEntity = await this.gtpLocationRepository.findOne({ 
            where: { gtp_location_id: gtpLocation } 
          });

          if (!gtpLocationEntity) {
            results.failed++;
            results.errors.push(`Row ${i + 1}: GTP Location ${gtpLocation} does not exist`);
            continue;
          }

          // Find order items with matching license plate ID
          const orderItems = await this.orderItemRepository.find({
            where: { license_plate_id: lpId }
          });

          if (orderItems.length === 0) {
            results.failed++;
            results.errors.push(`Row ${i + 1}: No order items found with License Plate ID ${lpId}`);
            continue;
          }

          // Update all matching order items with the GTP location
          for (const orderItem of orderItems) {
            await this.orderItemRepository.update(
              { order_item_id: orderItem.order_item_id },
              { 
                assigned_gtp_location: gtpLocation,
                status: OrderItemStatus.ASSIGNED 
              }
            );
          }

          results.successful++;

        } catch (error) {
          results.failed++;
          results.errors.push(`Row ${i + 1}: ${error.message}`);
        }
      }

      return {
        success: results.failed === 0,
        message: `Processed ${results.successful + results.failed} assignments`,
        errors: results.errors.length > 0 ? results.errors : undefined
      };

    } catch (error) {
      throw new BadRequestException(`Failed to process assignments CSV file: ${error.message}`);
    }
  }
}
