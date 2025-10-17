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
import { Log, Task, TaskType } from 'src/entities';
import { LoggingService } from '../../services/logging.service';
import { ScheduleMapping } from 'src/entities/schedule_mapping.entity';

interface LicensePlateStats{
  license_plate_id: string;
  completion_percentage ?: number;
  status ?: OrderItemStatus;
}

export interface OrderItemDetails{
  order_item_id: number;
  order_batch_id: string;
  source_location_id: string;
  destination_station_id: string;
  total_unloading_time: number;
  robot_ids: string[];
  status: OrderItemStatus;
  start_time: Date | undefined;
  end_time: Date | undefined;
  created_at ?: Date;
  updated_at ?: Date;
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

  async processFile(file: Express.Multer.File, body: any, upload_mode: 'merge' | 'transit'): Promise<UploadResponseDto> {
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
      return await this.saveToDatabase(data, batch_order_id, upload_mode);
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
    upload_mode: 'merge' | 'transit'
  ): Promise<UploadResponseDto> {
    console.log(`calling save to db`);
    let processedItems = 0;

    if (data.length === 0) {
      throw new BadRequestException('No valid data found in file');
    }

    const firstItem = data[0];
    console.log(`calling save to db`);
    const requiredColumns = [
      'source_location',
      'destination_location'
    ];
    console.log(`calling save to db`);
    const missingColumns = requiredColumns.filter((col) => !(col in firstItem));
    console.log(`calling save to db`);
    if (missingColumns.length > 0) {
      throw new BadRequestException(
        `Missing required columns: ${missingColumns.join(', ')}`,
      );
    }
    console.log(`calling save to db`);

    for (const order of data) {
      try {
          const orderItem = this.orderItemRepository.create({
            order_batch_id: batch_order_id,
            source_location_id: order['source_location'],
            destination_pallet_slot_id: order['destination_location']
          });
          orderItem.status = OrderItemStatus.ASSIGNED;
          if (upload_mode['upload_mode'] === 'merge'){
            const existingOrderItem = await this.orderItemRepository.findOne({
              where: {
                source_location_id: orderItem.source_location_id,
                destination_pallet_slot_id: orderItem.destination_pallet_slot_id,
                status: In([OrderItemStatus.ASSIGNED, OrderItemStatus.IN_PROGRESS])
              },
              order: { created_at: 'ASC' }
            });
            if (existingOrderItem){
              if (existingOrderItem.status === OrderItemStatus.IN_PROGRESS){
                orderItem.status = OrderItemStatus.IN_PROGRESS;
              }
              orderItem.merged_order_item_id = existingOrderItem.merged_order_item_id ? existingOrderItem.merged_order_item_id : existingOrderItem.order_item_id;
            }
            
          }
          await this.loggingService.log(`New Order Item: Batch ID: ${orderItem.order_batch_id}, Source ${orderItem.source_location_id}, Destination ${orderItem.destination_pallet_slot_id}, upload mode: ${upload_mode['upload_mode']}`,
            TaskType.GOODS_TO_PERSON, null, orderItem.order_batch_id);
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
        order: { created_at: 'DESC', updated_at: 'DESC' }
      }));
    }
    if (statusList.includes('pending')){
      whereCondition.status = OrderItemStatus.PENDING;
      orderItems.push(...await this.orderItemRepository.find({
        where: whereCondition,
        relations: ['completedTasks'],
        order: { created_at: 'DESC', updated_at: 'DESC' }
      }));
    }
    if (statusList.includes('assigned')){
      whereCondition.status = OrderItemStatus.ASSIGNED;
      orderItems.push(...await this.orderItemRepository.find({
        where: whereCondition,
        relations: ['completedTasks'],
        order: { created_at: 'DESC', updated_at: 'DESC' }
      }));
    }
    if (statusList.includes('in_progress')){
      whereCondition.status = OrderItemStatus.IN_PROGRESS;
      orderItems.push(...await this.orderItemRepository.find({
        where: whereCondition,
        relations: ['completedTasks'],
        order: { created_at: 'DESC', updated_at: 'DESC' }
      }));
    }
    if (statusList.includes('completed')){
      whereCondition.status = OrderItemStatus.COMPLETED;
      orderItems.push(...await this.orderItemRepository.find({
        where: whereCondition,
        relations: ['completedTasks'],
        order: { created_at: 'DESC', updated_at: 'DESC' }
      }));
    }
    if (statusList.includes('cancelled')){
      whereCondition.status = OrderItemStatus.CANCELLED;
      orderItems.push(...await this.orderItemRepository.find({
        where: whereCondition,
        relations: ['completedTasks'],
        order: { created_at: 'DESC', updated_at: 'DESC' }
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
      }
      let station_id = '-';
      // find assigned gtp location
      const assigned_gtp_location = order.destination_pallet_slot_id;
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
        order_item_id: order.order_item_id,
        order_batch_id: order.order_batch_id || '',
        source_location_id: order.source_location_id,
        destination_station_id: station_id,
        status: order.status,
        robot_ids: robotIds,
        total_unloading_time: totalUnloadingTime,
        start_time: start_time,
        end_time: end_time,
        created_at: order.created_at,
        updated_at: order.updated_at
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
      relations: ['destinationPalletSlot'],
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
        status: In([OrderItemStatus.ASSIGNED, OrderItemStatus.IN_PROGRESS, OrderItemStatus.COMPLETED, OrderItemStatus.CANCELLED]),
      },
      order: { created_at: 'DESC' },
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
        merged_order_item_id: orderItem.merged_order_item_id
      };
      if (orderItem.status == OrderItemStatus.COMPLETED){ sourceLocationStats[sourceLocationId]['completed'] += 1; }
      sourceLocationStats[sourceLocationId]['totalOrder'] += 1;
    }
    return sourceLocationStats;
  }

  async getCompletedTasksForOrderItems(order_item_ids: number[]) {
    const res = {};
    const orderItems = await this.orderItemRepository.find({
      where: { order_item_id: In(order_item_ids) },
      relations: ['completedTasks'],
    });
    for (const orderItem of orderItems) {
      if (!res[orderItem.order_item_id]){
        res[orderItem.order_item_id] = [];
      }
      for (const task of orderItem.completedTasks){
        res[orderItem.order_item_id].push(task.task_id);
      }
    }
    return res;
  }

  async cancelOrderItem(orderItemId: number, isGroup?: boolean) {
    if (isGroup){
      const orderItem = await this.orderItemRepository.findOne({ where: { order_item_id: orderItemId } });
      const groupedOrderItems = await this.orderItemRepository.find({
        where: { merged_order_item_id: orderItemId, status: In([OrderItemStatus.ASSIGNED, OrderItemStatus.PENDING]) }
      });
      if (!orderItem){
        throw new NotFoundException(`Order item with ID ${orderItemId} not found`);
      }
      for (const item of groupedOrderItems){
        item.status = OrderItemStatus.CANCELLED;
        await this.orderItemRepository.save(item);
        await this.loggingService.log(`Order Item ID ${item.order_item_id} cancelled (grouped)`,
          TaskType.GOODS_TO_PERSON, null, item.order_batch_id || '');
      }
      orderItem.status = OrderItemStatus.CANCELLED;
      await this.orderItemRepository.save(orderItem);
      await this.loggingService.log(`Order Item ID ${orderItem.order_item_id} cancelled`,
        TaskType.GOODS_TO_PERSON, null, orderItem.order_batch_id || '');
      return { success: true, message: `Order item ID ${orderItemId} and its grouped items cancelled` };
    }
    const orderItem = await this.orderItemRepository.findOne({ where: { order_item_id: orderItemId } });
    if (!orderItem){
      throw new NotFoundException(`Order item with ID ${orderItemId} not found`);
    }
    if (orderItem.status === OrderItemStatus.COMPLETED || orderItem.status === OrderItemStatus.CANCELLED){
      throw new BadRequestException(`Cannot cancel order item with status ${orderItem.status}`);
    }
    orderItem.status = OrderItemStatus.CANCELLED;
    await this.orderItemRepository.save(orderItem);
    await this.loggingService.log(`Order Item ID ${orderItem.order_item_id} cancelled`,
      TaskType.GOODS_TO_PERSON, null, orderItem.order_batch_id || '');
    return { success: true, message: `Order item ID ${orderItemId} cancelled` };

  }
}
