import { Injectable, BadRequestException, ForbiddenException, NotFoundException, LoggerService } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, In, LessThan, Between, MoreThanOrEqual, Not } from 'typeorm';
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
import { Log, ProductRequirement, Task, TaskStatus, TaskType } from 'src/entities';
import { LoggingService } from '../../services/logging.service';
import { ScheduleMapping } from 'src/entities/schedule_mapping.entity';
import { OrchestratorService } from '../orchestrator/orchestrator.service';
import { MOVE_TYPE } from 'src/entities/task.entity';
import { retry } from 'rxjs';



@Injectable()
export class OrdersCancelService {
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
    @InjectRepository(ProductRequirement)
    private productRequirementRepository: Repository<ProductRequirement>,
    private readonly orchestrationService: OrchestratorService,
    private readonly loggingService: LoggingService
  ) {}

  async cancelRelatedTasks(orderItem: OrderItem) {
    const task = await this.taskRepository.findOne({
      where: {
        origin_location: orderItem.source_location_id,
        move_type: MOVE_TYPE.INVENTORY_TO_STATION
      },
      order: { created_at: 'DESC' }
    });
    console.log(`orderItem: ${orderItem.order_item_id}, found task: ${task ? task.task_id : 'none'}`);
    console.log(`task status: ${task ? task.status : 'N/A'}`);
    if (task && (task.status === TaskStatus.CANCELLED || task.status === TaskStatus.COMPLETED || task.status === TaskStatus.PROCESSING)){
      throw new BadRequestException(`Cannot cancel tasks with status ${task.status}`);
    }
    if (orderItem.retry_reassign_attempts >= 1){
      await this.productRequirementRepository.delete({ source_location_id: orderItem.source_location_id });
    }
    if (!task){return;}
    await this.orchestrationService.decrementRobotInUse();
    await this.loggingService.log(`Cancelling Task ID ${task.task_id} related to Order Item ID ${orderItem.order_item_id}`,
      TaskType.GOODS_TO_PERSON, null, orderItem.order_batch_id || '');
    await this.orchestrationService.CancelTask(task);
  }

  async cancelOrderItem(orderItemId: number, isGroup?: boolean) {
    if (isGroup){
      const orderItem = await this.orderItemRepository.findOne({ where: { order_item_id: orderItemId } });
      const groupedOrderItems = await this.orderItemRepository.find({
        where: { merged_order_item_id: orderItemId, status: In([OrderItemStatus.ASSIGNED, OrderItemStatus.PENDING, OrderItemStatus.IN_PROGRESS]) }
      });
      if (!orderItem){
        throw new NotFoundException(`Order item with ID ${orderItemId} not found`);
      }
      try{
        if (orderItem.status === OrderItemStatus.IN_PROGRESS){
          await this.cancelRelatedTasks(orderItem);
        }
      }
      catch (error){
        return { success: false, message: `Failed to cancel related tasks for Order Item ID ${orderItemId}: ${error.message}` };
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

  async cancelOrderByTaskId(taskId: string){
    const task = await this.taskRepository.findOne({ where: { task_id: taskId } });
    if (!task){
      throw new NotFoundException(`Task with ID ${taskId} not found`);
    }
    if (task.status === TaskStatus.CANCELLED || task.status === TaskStatus.COMPLETED){
      throw new BadRequestException(`Cannot cancel task with status ${task.status}`);
    }

    const source_location_id = task?.origin_location;
    const orderItems = await this.orderItemRepository.find({
      where: {
        source_location_id: source_location_id,
        status: In([OrderItemStatus.IN_PROGRESS])
      },
    });
    let any_retry_exceed = false;
    for (const orderItem of orderItems){
      if (orderItem.retry_reassign_attempts >= 1){
        any_retry_exceed = true;
      }
      orderItem.status = OrderItemStatus.CANCELLED;
      await this.orderItemRepository.save(orderItem);
      await this.loggingService.log(`Order Item ID ${orderItem.order_item_id} cancelled (via task ID ${taskId})`,
        TaskType.GOODS_TO_PERSON, null, orderItem.order_batch_id || '');
    }
    // await this.orchestrationService.decrementRobotInUse();
    if (any_retry_exceed){
      await this.productRequirementRepository.delete({ source_location_id: source_location_id });
    }
    // await this.productRequirementRepository.delete({ source_location_id: source_location_id });
    await this.orchestrationService.CancelTask(task);

  }
  
  async retryOrderByTaskId(taskId: string){
    const task = await this.taskRepository.findOne({ where: { task_id: taskId } });
    if (!task){
      throw new NotFoundException(`Task with ID ${taskId} not found`);
    }
    if (task.move_type === MOVE_TYPE.INVENTORY_TO_STATION
      || task.move_type === MOVE_TYPE.STATION_TO_STATION
      || task.move_type === MOVE_TYPE.WAITING_LOCATION_TO_STATION
    ){
      const gtpLocations = await this.gtpLocationRepository.find({where: {station_id: task.end_location.location_id}});
      if (gtpLocations.length === 0){
        throw new NotFoundException(`No GTP Locations found for station ID ${task.end_location.location_id}`);
      }
      const orderItems = await this.orderItemRepository.find({
        where: {
          source_location_id: task.origin_location,
          status: OrderItemStatus.IN_PROGRESS,
          destination_pallet_slot_id: In(gtpLocations.map(loc => loc.gtp_location_id)),
        },
      });
      if (orderItems.length === 0){
        throw new NotFoundException(`No Order Items found in PROGRESS for source location ID ${task.origin_location} at station ID ${task.end_location.location_id}`);
      }
    }
    return await this.orchestrationService.handleErroneousTask(taskId);
  }

  async retryOrderItem(orderItemId: number) {
    const orderItem = await this.orderItemRepository.findOne({ where: { order_item_id: orderItemId } });
    if (!orderItem){
      throw new NotFoundException(`Order item with ID ${orderItemId} not found`);
    }
    const cancelledOrderItems = await this.orderItemRepository.find({
      where: { merged_order_item_id: orderItem.merged_order_item_id || orderItemId , status: OrderItemStatus.CANCELLED }
    });

    for (const item of cancelledOrderItems){
      item.status = OrderItemStatus.IN_PROGRESS;
      item.retry_reassign_attempts += 1;
      await this.orderItemRepository.save(item);
      await this.loggingService.log(`Order Item ID ${item.order_item_id} set to IN_PROGRESS for retry`,
        TaskType.GOODS_TO_PERSON, null, item.order_batch_id || '');
    }

    orderItem.status = OrderItemStatus.IN_PROGRESS;
    orderItem.retry_reassign_attempts += 1;
    await this.orderItemRepository.save(orderItem);
    await this.loggingService.log(`Order Item ID ${orderItem.order_item_id} set to IN_PROGRESS for retry`,
      TaskType.GOODS_TO_PERSON, null, orderItem.order_batch_id || '');

    const task = await this.taskRepository.findOne({
      where: {
        origin_location: orderItem.source_location_id,
        status: TaskStatus.CANCELLED,
      },
      order: { created_at: 'DESC' }
    });

    if (task){
      await this.orchestrationService.handleErroneousTask(task.task_id);
    }
    else{
      const gtpLocations = await this.gtpLocationRepository.find({where: { gtp_location_id: orderItem.destination_pallet_slot_id }});
      if (gtpLocations.length === 0){
        throw new NotFoundException(`No GTP Locations found for location ID ${orderItem.destination_pallet_slot_id}`);
      }
      await this.productRequirementRepository.save({
        source_location_id: orderItem.source_location_id,
        station_id: gtpLocations[0].station_id,
      });
    }
  }
}
