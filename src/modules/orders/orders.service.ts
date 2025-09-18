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

  async processFile(file: Express.Multer.File, body: any): Promise<UploadResponseDto> {
    console.log(`call process file`);
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
    console.log('calling parse csv');
    return new Promise((resolve, reject) => {
      const results: UploadOrderItemDto[] = [];
      const stream = Readable.from(buffer);

      stream
        .pipe(csv())
        .on('data', (data) => {
          const processedData = {
            ...data,
            destination_location: data['destination_location'],
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
    }));
  }

  private async saveToDatabase(
    data: UploadOrderItemDto[],
    batch_order_id: string | null,
  ): Promise<UploadResponseDto> {
    console.log(`calling save to db`);
    let processedItems = 0;

    if (data.length === 0) {
      throw new BadRequestException('No valid data found in file');
    }

    const firstItem = data[0];
    const requiredColumns = [
      'source_location',
      'destination_location'
    ];
    const missingColumns = requiredColumns.filter((col) => !(col in firstItem));

    if (missingColumns.length > 0) {
      throw new BadRequestException(
        `Missing required columns: ${missingColumns.join(', ')}`,
      );
    }

    for (const order of data) {
      try {
          const orderItem = this.orderItemRepository.create({
            order_batch_id: batch_order_id,
            source_location_id: order['source_location'],
            destination_pallet_slot_id: order['destination_location']
          });

          orderItem.status = OrderItemStatus.ASSIGNED;

          await this.orderItemRepository.save(orderItem);
          processedItems++;
        }catch (error) {
        throw error;
      }
    }

    return {
      success: true,
      message: `Successfully uploaded ${processedItems} order items.`,
      errors: undefined,
    };
  }

  async getAllOrderItems() {
    try {
      // Get all order items with their assigned GTP location details
      const orderItems = await this.orderItemRepository.find({
        relations: ['destinationPalletSlot'],
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



  async getGtpLocationStatus(gtpLocationId: string): Promise<{ status: boolean}> {
    const orderItems = await this.orderItemRepository.find({
      where: { destination_pallet_slot_id: gtpLocationId , status: OrderItemStatus.IN_PROGRESS},
    });
    if (orderItems.length === 0){
      return {
        status: true
      };
    }
    return { status: false };
  }

  // async getOrdersByStatus(statusList: string[], start_time: Date | undefined, end_time: Date | undefined): Promise<OrderItemDetails[]> {
  //   console.log(`start_time: ${start_time}`)
  //   console.log(`Getting orders with status: ${statusList.join(', ')}`);
  //   if (!statusList || statusList.length === 0) {
  //     throw new BadRequestException('Status is required');
  //   }
  //   const results: OrderItemDetails[] = [];
  //   const orderItems : OrderItem[] = [];
  //   const whereCondition: any = {};
  //   if (start_time && end_time) {
  //     whereCondition.created_at = Between(start_time, end_time);
  //   }
  //   else if (start_time){
  //     whereCondition.created_at = MoreThanOrEqual(start_time);
  //   }
  //   else if (end_time){
  //     whereCondition.created_at = LessThan(end_time);
  //   }
  //   console.log(`wherecondition: ${whereCondition}`)
  //   if (statusList.includes('all')){
  //     orderItems.push(...await this.orderItemRepository.find({
  //       where: whereCondition,
  //       relations: ['completedTasks'],
  //     }));
  //   }
  //   if (statusList.includes('pending')){
  //     whereCondition.status = OrderItemStatus.PENDING;
  //     orderItems.push(...await this.orderItemRepository.find({
  //       where: whereCondition,
  //       relations: ['completedTasks'],
  //     }));
  //   }
  //   if (statusList.includes('assigned')){
  //     whereCondition.status = OrderItemStatus.ASSIGNED;
  //     orderItems.push(...await this.orderItemRepository.find({
  //       where: whereCondition,
  //       relations: ['completedTasks'],
  //     }));
  //   }
  //   if (statusList.includes('in_progress')){
  //     whereCondition.status = OrderItemStatus.IN_PROGRESS;
  //     orderItems.push(...await this.orderItemRepository.find({
  //       where: whereCondition,
  //       relations: ['completedTasks'],
  //     }));
  //   }
  //   if (statusList.includes('completed')){
  //     whereCondition.status = OrderItemStatus.COMPLETED;
  //     orderItems.push(...await this.orderItemRepository.find({
  //       where: whereCondition,
  //       relations: ['completedTasks'],
  //     }));
  //   }
  //   if (statusList.includes('cancelled')){
  //     whereCondition.status = OrderItemStatus.CANCELLED;
  //     orderItems.push(...await this.orderItemRepository.find({
  //       where: whereCondition,
  //       relations: ['completedTasks'],
  //     }));
  //   }
  //   if (orderItems.length === 0) {
  //     return [] as OrderItemDetails[];
  //   }
  //   for (const order of orderItems) {
  //     const completedTasks = order.completedTasks || 0;
  //     const robotIds = Array.isArray(completedTasks) 
  //       ? Array.from(new Set(completedTasks.map(task => task.robot_id).filter(id => id))) 
  //       : [];
      
  //     let totalUnloadingTime = 0;
  //     let wait_time = 0;
  //     for (const task of completedTasks){
  //       if (!task.triggered || !task.completed) continue;
  //       let unloading_time = Math.floor((Number(task.triggered) - Number(task.completed)) / 1000);
  //       totalUnloadingTime += unloading_time;

  //       const batch_id = task.batch_id || '-';
  //       const current_sequence_number = task.sequence_order;
  //       const previous_task_of_orders = await this.taskRepository.find({
  //         where: { 
  //           batch_id: batch_id, 
  //           sequence_order: LessThan(current_sequence_number)
  //         }
  //       });
  //       for (const previousTask of previous_task_of_orders) {
  //         if (previousTask.created_at < order.created_at){continue;}
  //         if (previousTask.end_location.location_attribute.attribute_value=='waiting_location') {
  //           if (previousTask.completed) {
  //             // Find the next task in sequence order
  //             const nextTask = await this.taskRepository.findOne({
  //               where: { 
  //                 batch_id: batch_id, 
  //                 sequence_order: previousTask.sequence_order + 1
  //               }
  //             });
              
  //             if (nextTask && nextTask.processing) {
  //               const waitingTime = Math.floor((Number(nextTask.processing) - Number(previousTask.completed)) / 1000);
  //               wait_time += waitingTime;
  //             }
  //           }
  //         }
  //       }
  //     }
  //     let station_id = '-';
  //     // find assigned gtp location
  //     const assigned_gtp_location = order.destination_pallet_slot_id;
  //     if (assigned_gtp_location){
  //       const gtp_location = await this.gtpLocationRepository.findOne({
  //         where: { gtp_location_id: assigned_gtp_location }
  //       });
  //       station_id = gtp_location?.station_id || '-';
  //     }
  //     // fetch start and end time
  //     let start_time = order.created_at ? new Date(order.created_at) : undefined;
  //     let end_time: Date | undefined = undefined;
  //     if (order.status == OrderItemStatus.COMPLETED || order.status == OrderItemStatus.CANCELLED){
  //       end_time = order.updated_at ? new Date(order.updated_at) : undefined;
  //     }
  //     results.push({
  //       license_plate_id: order.license_plate_id,
  //       order_id: order.order_id,
  //       product_id: order.product_id,
  //       quantity: order.quantity,
  //       remaining_quantity: order.remaining_quantity,
  //       status: order.status,
  //       assigned_gtp_location: order.destination_pallet_slot_id,
  //       created_at: order.created_at,
  //       updated_at: order.updated_at,
  //       robot_ids: robotIds,
  //       total_unloading_time: totalUnloadingTime,
  //       station_id: station_id,
  //       start_time: start_time,
  //       end_time: end_time,
  //       wait_time: wait_time
  //     });
  //   }
  //   return results;
  // }

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
      const gtpLocation = orderItem.destinationPalletSlot;
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

  async getSourceByGtpLocation(gtpLocationId: string): Promise<any> {
    const orderItems = await this.orderItemRepository.find({
      where: { destination_pallet_slot_id: gtpLocationId,
        status: In([OrderItemStatus.ASSIGNED, OrderItemStatus.IN_PROGRESS, OrderItemStatus.COMPLETED, OrderItemStatus.CANCELLED])
      },
    });
    let sourceLocationStats = {};
    for (const orderItem of orderItems) {
      const sourceLocationId = orderItem.source_location_id;
      if (!sourceLocationStats[sourceLocationId]) {
        sourceLocationStats[sourceLocationId] = {};
      }
      if (!sourceLocationStats[sourceLocationId]['totalOrder']){sourceLocationStats[sourceLocationId]['totalOrder'] = 0;}
      if (!sourceLocationStats[sourceLocationId]['completed']){sourceLocationStats[sourceLocationId]['completed'] = 0;}
      sourceLocationStats[sourceLocationId][orderItem.order_item_id.toString()] = {
        status: orderItem.status,
      };
      if (orderItem.status == OrderItemStatus.COMPLETED){ sourceLocationStats[sourceLocationId]['completed'] += 1; }
      sourceLocationStats[sourceLocationId]['totalOrder'] += 1;
    }
    return sourceLocationStats;
  }
}
