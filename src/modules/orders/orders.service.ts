import { Injectable, BadRequestException, ForbiddenException, NotFoundException, LoggerService } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
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
import { Log } from 'src/entities';
import { LoggingService } from '../../services/logging.service';

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

    private readonly loggingService: LoggingService

  ) {}

  async processFile(file: Express.Multer.File, body: any): Promise<UploadResponseDto> {
    const fileExtension = this.getFileExtension(file.originalname);
    let data: UploadOrderItemDto[] = [];
    let batch_order_id: string | null = body?.batch_order_id || null;

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

      return await this.saveToDatabase(data, batch_order_id);
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
    batch_order_id: string | null,
  ): Promise<UploadResponseDto> {
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

        await this.loggingService.log(`Order ${orderId}: Creating new Order.`);
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
          await this.loggingService.log(`Order ${orderId}: Creating new OrderItem for product ${item['Product Id']}, quantity ${item['Qty']}.`);
          const orderItem = this.orderItemRepository.create({
            order_id: orderId,
            product_id: item['Product Id'],
            quantity: item['Qty'],
            remaining_quantity: item['Qty'],
            license_plate_id: item['License Plate ID'],
            status: OrderItemStatus.PENDING,
            order_batch_id: batch_order_id,
          });

          await this.orderItemRepository.save(orderItem);
          processedItems++;
        }
      } catch (error) {
        throw error;
      }
    }

    return {
      success: true,
      message: `Successfully uploaded ${processedItems} order items.`,
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
              { order_item_id: orderItem.order_item_id, status: OrderItemStatus.PENDING },
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

  async getAvailableLicensePlates() {
    try {
      // Find all order items where assigned_gtp_location is null
      const orderItems = await this.orderItemRepository.find({
        where: { 
          assigned_gtp_location: IsNull() 
        },
        select: ['license_plate_id']
      });

      // Extract unique license plate IDs and filter out nulls
      const licensePlateIds = orderItems
        .map(item => item.license_plate_id)
        .filter(lpId => lpId !== null && lpId !== undefined)
        .filter((lpId, index, arr) => arr.indexOf(lpId) === index); // Remove duplicates

      return {
        success: true,
        message: `Found ${licensePlateIds.length} available license plates`,
        data: licensePlateIds
      };
    } catch (error) {
      throw new BadRequestException(`Failed to get available license plates: ${error.message}`);
    }
  }

  async mapLicensePlateToGtpLocation(licensePlateId: string, gtpLocationId: string) {
    try {
      // Validate that the GTP location exists
      const gtpLocation = await this.gtpLocationRepository.findOne({
        where: { gtp_location_id: gtpLocationId }
      });

      if (!gtpLocation) {
        throw new BadRequestException(`GTP Location ${gtpLocationId} does not exist`);
      }

      // Check if the GTP location is already assigned to a different license plate
      const existingAssignment = await this.orderItemRepository.findOne({
        where: { 
          assigned_gtp_location: gtpLocationId,
          status: OrderItemStatus.ASSIGNED
        },
        select: ['license_plate_id']
      });

      if (existingAssignment && existingAssignment.license_plate_id !== licensePlateId) {
        throw new ForbiddenException(`GTP Location ${gtpLocationId} is already assigned to license plate ${existingAssignment.license_plate_id}`);
      }

      // Find order items with the given license_plate_id
      const orderItems = await this.orderItemRepository.find({
        where: { 
          license_plate_id: licensePlateId
        }
      });

      if (orderItems.length === 0) {
        throw new BadRequestException(`No order items found with license plate ${licensePlateId}`);
      }

      // Update all matching order items
      const updateResult = await this.orderItemRepository.update(
        { 
          license_plate_id: licensePlateId,
          status: OrderItemStatus.PENDING  // Ensure we only update items that are pending
        },
        { 
          assigned_gtp_location: gtpLocationId,
          status: OrderItemStatus.ASSIGNED
        }
      );

      return {
        success: true,
        message: `Successfully mapped license plate ${licensePlateId} to GTP location ${gtpLocationId} for ${updateResult.affected} order items`,
        data: {
          licensePlateId,
          gtpLocationId,
          affectedItems: updateResult.affected
        }
      };
    } catch (error) {
      throw new BadRequestException(`Failed to map license plate to GTP location: ${error.message}`);
    }
  }

  async getAllOrderItems() {
    try {
      // Get all order items with their assigned GTP location details
      const orderItems = await this.orderItemRepository.find({
        relations: ['assignedGtpLocation', 'assignedGtpLocation.station'],
        order: { created_at: 'DESC' }
      });

      return {
        success: true,
        message: `Found ${orderItems.length} order items`,
        data: orderItems
      };
    } catch (error) {
      throw new BadRequestException(`Failed to get order items: ${error.message}`);
    }
  }

  async removeLicensePlateMapping(licensePlateId: string) {
    try {
      // Find order items with the given license_plate_id
      const orderItems = await this.orderItemRepository.find({
        where: { 
          license_plate_id: licensePlateId
        },
        select: ['order_item_id', 'license_plate_id', 'assigned_gtp_location', 'status']
      });

      if (orderItems.length === 0) {
        throw new NotFoundException(`No order items found with license plate ${licensePlateId}`);
      }

      // Check if any order item has a GTP location assigned
      const itemsWithGtpLocation = orderItems.filter(item => item.assigned_gtp_location !== null);
      if (itemsWithGtpLocation.length === 0) {
        throw new NotFoundException(`No GTP location mapping exists for license plate ${licensePlateId}`);
      }

      // Check if all items with GTP location are in ASSIGNED status
      const nonAssignedItems = itemsWithGtpLocation.filter(item => item.status !== OrderItemStatus.ASSIGNED);
      if (nonAssignedItems.length > 0) {
        throw new BadRequestException(`Cannot remove mapping: Order items with license plate ${licensePlateId} are not in ASSIGNED status`);
      }

      // Store the previous GTP location for response
      const previousGtpLocationId = itemsWithGtpLocation[0].assigned_gtp_location;

      // Update all matching order items - set GTP location to null and status back to PENDING
      const updateResult = await this.orderItemRepository.update(
        { 
          license_plate_id: licensePlateId,
          assigned_gtp_location: previousGtpLocationId as string,
        },
        { 
          assigned_gtp_location: null,
          status: OrderItemStatus.PENDING
        }
      );

      return {
        success: true,
        message: `Successfully removed GTP location mapping for license plate ${licensePlateId}. ${updateResult.affected} order items updated.`,
        data: {
          licensePlateId,
          previousGtpLocationId,
          affectedItems: updateResult.affected
        }
      };
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(`Failed to remove license plate mapping: ${error.message}`);
    }
  }
}
