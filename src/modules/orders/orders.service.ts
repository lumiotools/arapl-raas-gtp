import { Injectable, BadRequestException, ForbiddenException, NotFoundException, LoggerService } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, In, LessThan, Between, MoreThanOrEqual } from 'typeorm';
import * as XLSX from 'xlsx';
import * as csv from 'csv-parser';
import { Readable } from 'stream';
import { OrderItem, OrderItemStatus } from '../../entities/order-item.entity';
import { Product } from '../../entities/product.entity';
import { GtpLocation } from '../../entities/gtp-location.entity';
import {
  UploadOrderItemDto,
  ProcessedOrderItemDto,
  UploadResponseDto,
} from './dto/upload-order.dto';
import { Log, Task } from 'src/entities';
import { LoggingService } from '../../services/logging.service';
import { ScheduleMapping } from 'src/entities/schedule_mapping.entity';

interface LicensePlateStats{
  license_plate_id: string;
  completion_percentage ?: number;
  status ?: OrderItemStatus;
}
export interface OrderItemDetails{
  license_plate_id: string;
  order_id: string;
  product_id: string;
  quantity: number;
  remaining_quantity: number;
  status: OrderItemStatus;
  assigned_gtp_location: string | null;
  created_at?: Date;
  updated_at?: Date;
  robot_ids?: string[];
  total_unloading_time?: number;
  station_id ?: string;
  start_time?: Date;
  end_time?: Date;
  wait_time?: number;
}

@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(OrderItem)
    private orderItemRepository: Repository<OrderItem>,
    @InjectRepository(Product)
    private productRepository: Repository<Product>,
    @InjectRepository(GtpLocation)
    private gtpLocationRepository: Repository<GtpLocation>,
    @InjectRepository(ScheduleMapping)
    private scheduleMappingRepository: Repository<ScheduleMapping>,
    @InjectRepository(Task)
    private taskRepository: Repository<Task>,
    private readonly loggingService: LoggingService
  ) {}

  async processScheduleMappingFile(file: Express.Multer.File): Promise<{ success: boolean; message: string; errors?: string[] }> {
    const results: { success: boolean; message: string; errors?: string[] } = {
      success: true,
      message: '',
      errors: [],
    };
    try {
      const csvData = file.buffer.toString('utf8');
      const lines = csvData.split('\n').filter(line => line.trim());
      if (lines.length === 0) {
        throw new BadRequestException('CSV file is empty');
      }
      // Parse header
      const headers = lines[0].split(',').map(h => h.trim());
      const expectedHeaders = ['GTP Location', 'License Plate ID'];
      if (!expectedHeaders.every(header => headers.includes(header))) {
        throw new BadRequestException(`Invalid CSV format. Expected headers: ${expectedHeaders.join(', ')}`);
      }
      let created = 0;
      // Process each row (skip header)
      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map(v => v.trim());
        if (values.length < 2) {
          results.errors?.push(`Row ${i + 1}: Invalid number of columns`);
          continue;
        }
        const gtpLocationId = values[0];
        const licensePlateId = values[1];
        if (!gtpLocationId || !licensePlateId) {
          results.errors?.push(`Row ${i + 1}: Missing required fields (GTP Location or License Plate ID)`);
          continue;
        }
        try {
          // const mapping = this.scheduleMappingRepository.create({
          //   gtp_location_id: gtpLocationId,
          //   license_plate_id: licensePlateId,
          // });
          // await this.scheduleMappingRepository.save(mapping);
          const orderItems = await this.orderItemRepository.find({
            where: {
              license_plate_id: licensePlateId,
              status: OrderItemStatus.PENDING,
              assigned_gtp_location: IsNull(),
            }
          })
          if (!orderItems || orderItems.length == 0){continue;}
          for (const orderItem of orderItems) {
            orderItem.assigned_gtp_location = gtpLocationId;
            orderItem.status = OrderItemStatus.ASSIGNED;
            await this.orderItemRepository.save(orderItem);
          }
          created++;
        } catch (error) {
          results.errors?.push(`Row ${i + 1}: ${error.message}`);
        }
      }
      results.success = results.errors?.length === 0;
      results.message = `Successfully uploaded ${created} schedule mappings.`;
      return results;
    } catch (error) {
      throw new BadRequestException(`Failed to process schedule mapping CSV file: ${error.message}`);
    }
  }

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
          assigned_gtp_location: IsNull() ,
          status: In([OrderItemStatus.PENDING, OrderItemStatus.ASSIGNED])
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
      // const existingAssignment = await this.orderItemRepository.findOne({
      //   where: { 
      //     assigned_gtp_location: gtpLocationId,
      //     status: OrderItemStatus.ASSIGNED
      //   },
      //   select: ['license_plate_id']
      // });

      // if (existingAssignment && existingAssignment.license_plate_id !== licensePlateId) {
      //   throw new ForbiddenException(`GTP Location ${gtpLocationId} is already assigned to license plate ${existingAssignment.license_plate_id}`);
      // }
      console.log(`Finding order items for license plate ${licensePlateId}`);
      // Find order items with the given license_plate_id
      const orderItems = await this.orderItemRepository.find({
        where: { 
          license_plate_id: licensePlateId,
          status: OrderItemStatus.PENDING
        }
      });
      console.log(`OrderItems: ${JSON.stringify(orderItems)}`);

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
      // const nonAssignedItems = itemsWithGtpLocation.filter(item => item.status !== OrderItemStatus.ASSIGNED);
      // if (nonAssignedItems.length > 0) {
      //   throw new BadRequestException(`Cannot remove mapping: Order items with license plate ${licensePlateId} are not in ASSIGNED status`);
      // }

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

  async getCompletedTasksForOrderItems(orderItemIds: number[]): Promise<Record<string, string[]>> {
    try {
      if (!Array.isArray(orderItemIds) || orderItemIds.length === 0) {
        throw new BadRequestException('Invalid order item IDs provided');
      }
      // Find all order items with the given IDs
      const orderItems = await this.orderItemRepository.find({
        where: { order_item_id: In(orderItemIds) },
        relations: ['completedTasks'],
      });
      if (orderItems.length === 0) {
        throw new NotFoundException(`No order items found with the provided IDs: ${orderItemIds.join(', ')}`);
      }
      // Build a map of order_id -> array of completed task IDs
      const result: Record<string, string[]> = {};
      for (const orderItem of orderItems) {
        const orderId = orderItem.order_id;
        if (!result[orderId]) {
          result[orderId] = [];
        }
        const completedTaskIds = (orderItem.completedTasks || []).map(task => task.task_id);
        result[orderId].push(...completedTaskIds);
      }
      // Remove duplicates in each array
      for (const key in result) {
        result[key] = Array.from(new Set(result[key]));
      }
      return result;
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(`Failed to get completed tasks for order items: ${error.message}`);
    }
  }

  async calculateCompletionPercentage(orderItems: OrderItem[], licensePlateId: string): Promise<number> {
    if (!Array.isArray(orderItems) || orderItems.length === 0) {
      return 0;
    }
    let relevantOrderItems = orderItems.filter(item => item.license_plate_id === licensePlateId);
    // Filter out order items if all items for the same order_id are either COMPLETED or CANCELLED
    const orderIds = Array.from(new Set(relevantOrderItems.map(item => item.order_id)));
    const filteredOrderIds: string[] = [];

    for (const orderId of orderIds) {
      const orderItemsForOrder = relevantOrderItems.filter(item => item.order_id === orderId);
      const hasNonCompletedCancelled = orderItemsForOrder.some(item => 
        item.status !== OrderItemStatus.COMPLETED && item.status !== OrderItemStatus.CANCELLED
      );
      
      if (hasNonCompletedCancelled) {
        filteredOrderIds.push(orderId);
      }
    }
    if (filteredOrderIds.length === 0){
      return 100;
    }

    relevantOrderItems = relevantOrderItems.filter(item => filteredOrderIds.includes(item.order_id));
    const requiredQuantity = relevantOrderItems.reduce((sum, item) => sum + item.quantity, 0);
    const remainingQuantity = relevantOrderItems.reduce((sum, item) => sum + item.remaining_quantity, 0);
    const satisfiedQuantity = requiredQuantity - remainingQuantity;

    return Math.round((satisfiedQuantity / requiredQuantity) * 100);
  }

  async getOrderItemStatus(orderItems: OrderItem[], licensePlateId: string): Promise<OrderItemStatus> {
    if (!Array.isArray(orderItems) || orderItems.length === 0) {
      return OrderItemStatus.PENDING;
    }
    const relevantOrderItems = orderItems.filter(item => item.license_plate_id === licensePlateId);
    if (relevantOrderItems.length === 0) {
      return OrderItemStatus.PENDING;
    }
    const inProgressCount = relevantOrderItems.filter(item => item.status === OrderItemStatus.IN_PROGRESS).length;
    if (inProgressCount > 0) {
      return OrderItemStatus.IN_PROGRESS;
    }
    const assignedCount = relevantOrderItems.filter(item => item.status === OrderItemStatus.ASSIGNED).length;
    if (assignedCount > 0) {
      return OrderItemStatus.ASSIGNED;
    }
    const completedCount = relevantOrderItems.filter(item => item.status === OrderItemStatus.COMPLETED).length;
    if (completedCount > 0) {
      return OrderItemStatus.COMPLETED;
    }
    const cancelledCount = relevantOrderItems.filter(item => item.status === OrderItemStatus.CANCELLED).length;
    if (cancelledCount > 0) {
      return OrderItemStatus.CANCELLED;
    }
    return OrderItemStatus.PENDING;
  }

  async getLicensePlatesByGtpLocation(gtpLocationId:string):Promise<any>{
    try {
      if (!gtpLocationId) {
        throw new BadRequestException('GTP Location ID is required');
      }
      const res = {
        'license_plate_objs': [] as LicensePlateStats[],
        'lp_count': 0
      };
      const orders = await this.orderItemRepository.find({
        where: { assigned_gtp_location: gtpLocationId },
      });
      const licensePlates = Array.from(new Set(orders.map(order => order.license_plate_id)));
      const assigned_in_progress_orders = orders.filter(order => order.status === OrderItemStatus.IN_PROGRESS || order.status === OrderItemStatus.ASSIGNED);
      // Count the number of unique order_id in assigned_in_progress_orders
      res.lp_count = new Set(assigned_in_progress_orders.map(order => order.license_plate_id)).size;``
      for (const licensePlate of licensePlates) {
        const orderItems = orders.filter(order => order.license_plate_id === licensePlate);
        res.license_plate_objs.push({
          license_plate_id: licensePlate,
          completion_percentage: await this.calculateCompletionPercentage(orderItems, licensePlate),
          status: await this.getOrderItemStatus(orderItems, licensePlate)
        });
      }
      return res;

    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(`Failed to get license plates by GTP location: ${error.message}`);
    }
  }

  async getGtpLocationStatus(gtpLocationId: string): Promise<{ status: boolean}> {
    const orderItems = await this.orderItemRepository.find({
      where: { assigned_gtp_location: gtpLocationId , status: OrderItemStatus.IN_PROGRESS},
    });
    if (orderItems.length === 0){
      return {
        status: true
      };
    }
    return { status: false };
  }

  async getOrdersByStatus(statusList: string[], start_time: Date | undefined, end_time: Date | undefined): Promise<OrderItemDetails[]> {
    console.log(`start_time: ${start_time}`)
    console.log(`Getting orders with status: ${statusList.join(', ')}`);
    if (!statusList || statusList.length === 0) {
      throw new BadRequestException('Status is required');
    }
    const results: OrderItemDetails[] = [];
    const orderItems : OrderItem[] = [];
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
    console.log(`wherecondition: ${whereCondition}`)
    if (statusList.includes('all')){
      orderItems.push(...await this.orderItemRepository.find({
        where: whereCondition,
        relations: ['completedTasks'],
      }));
    }
    if (statusList.includes('pending')){
      whereCondition.status = OrderItemStatus.PENDING;
      orderItems.push(...await this.orderItemRepository.find({
        where: whereCondition,
        relations: ['completedTasks'],
      }));
    }
    if (statusList.includes('assigned')){
      whereCondition.status = OrderItemStatus.ASSIGNED;
      orderItems.push(...await this.orderItemRepository.find({
        where: whereCondition,
        relations: ['completedTasks'],
      }));
    }
    if (statusList.includes('in_progress')){
      whereCondition.status = OrderItemStatus.IN_PROGRESS;
      orderItems.push(...await this.orderItemRepository.find({
        where: whereCondition,
        relations: ['completedTasks'],
      }));
    }
    if (statusList.includes('completed')){
      whereCondition.status = OrderItemStatus.COMPLETED;
      orderItems.push(...await this.orderItemRepository.find({
        where: whereCondition,
        relations: ['completedTasks'],
      }));
    }
    if (statusList.includes('cancelled')){
      whereCondition.status = OrderItemStatus.CANCELLED;
      orderItems.push(...await this.orderItemRepository.find({
        where: whereCondition,
        relations: ['completedTasks'],
      }));
    }
    if (orderItems.length === 0) {
      return [] as OrderItemDetails[];
    }
    for (const order of orderItems) {
      const completedTasks = order.completedTasks || 0;
      const robotIds = Array.isArray(completedTasks) 
        ? Array.from(new Set(completedTasks.map(task => task.robot_id).filter(id => id))) 
        : [];
      
      let totalUnloadingTime = 0;
      let wait_time = 0;
      for (const task of completedTasks){
        if (!task.triggered || !task.completed) continue;
        let unloading_time = Math.floor((Number(task.triggered) - Number(task.completed)) / 1000);
        totalUnloadingTime += unloading_time;

        const batch_id = task.batch_id || '-';
        const current_sequence_number = task.sequence_order;
        const previous_task_of_orders = await this.taskRepository.find({
          where: { 
            batch_id: batch_id, 
            sequence_order: LessThan(current_sequence_number)
          }
        });
        for (const previousTask of previous_task_of_orders) {
          if (previousTask.created_at < order.created_at){continue;}
          if (previousTask.end_location.location_attribute.attribute_value=='waiting_location') {
            if (previousTask.completed) {
              // Find the next task in sequence order
              const nextTask = await this.taskRepository.findOne({
                where: { 
                  batch_id: batch_id, 
                  sequence_order: previousTask.sequence_order + 1
                }
              });
              
              if (nextTask && nextTask.processing) {
                const waitingTime = Math.floor((Number(nextTask.processing) - Number(previousTask.completed)) / 1000);
                wait_time += waitingTime;
              }
            }
          }
        }
      }
      let station_id = '-';
      // find assigned gtp location
      const assigned_gtp_location = order.assigned_gtp_location;
      if (assigned_gtp_location){
        const gtp_location = await this.gtpLocationRepository.findOne({
          where: { gtp_location_id: assigned_gtp_location }
        });
        station_id = gtp_location?.station_id || '-';
      }
      // fetch start and end time
      let start_time = order.created_at ? new Date(order.created_at) : undefined;
      let end_time: Date | undefined = undefined;
      if (order.status == OrderItemStatus.COMPLETED || order.status == OrderItemStatus.CANCELLED){
        end_time = order.updated_at ? new Date(order.updated_at) : undefined;
      }
      results.push({
        license_plate_id: order.license_plate_id,
        order_id: order.order_id,
        product_id: order.product_id,
        quantity: order.quantity,
        remaining_quantity: order.remaining_quantity,
        status: order.status,
        assigned_gtp_location: order.assigned_gtp_location,
        created_at: order.created_at,
        updated_at: order.updated_at,
        robot_ids: robotIds,
        total_unloading_time: totalUnloadingTime,
        station_id: station_id,
        start_time: start_time,
        end_time: end_time,
        wait_time: wait_time
      });
    }
    return results;
  }

  async getStationReportSummary(start_time: Date | undefined, end_time: Date | undefined): Promise<any>{
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
      relations: ['assignedGtpLocation'],
    });
    const res: any = {};
    for (const orderItem of orderItems) {
      const gtpLocation = orderItem.assignedGtpLocation;
      if (gtpLocation) {
        const stationId = gtpLocation.station_id;
        if (!stationId) {continue;}
        if (!res[stationId]) {
          res[stationId] = {
            completed: 0,
            in_progress: 0,
            cancelled: 0,
            pending: 0,
            assigned: 0
          };
        }
        res[stationId][orderItem.status.toLowerCase()]++;
      }
    }
    return res;
  }

  async cancelOrderItemsByLicensePlate(licensePlateId: string, is_group?: boolean){
    if (is_group){
      const orderItems = await this.orderItemRepository.find({
        where: { license_plate_id: licensePlateId, status: In([OrderItemStatus.PENDING, OrderItemStatus.ASSIGNED]) }
      });
      if (orderItems.length === 0){
        throw new NotFoundException(`No PENDING or ASSIGNED order items found with license plate ${licensePlateId}`);
      }
      for (const orderItem of orderItems) {
        orderItem.status = OrderItemStatus.CANCELLED;
        await this.orderItemRepository.save(orderItem);
      }
      return { success: true, message: `Cancelled ${orderItems.length} order items with license plate ${licensePlateId}` };
    }
  }
}
