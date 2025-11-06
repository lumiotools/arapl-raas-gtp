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
import { InventoryService } from '../inventory/inventory.service';



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
    private readonly loggingService: LoggingService,
    private readonly inventoryService: InventoryService
  ) {}

  async cancelRelatedTasks(orderItem: OrderItem) {
    const task = await this.taskRepository.findOne({
      where: {
        origin_location: orderItem.source_location_id,
        status: In([TaskStatus.INQUEUE, TaskStatus.ASSIGNED, TaskStatus.PENDING])
      },
      order: { created_at: 'DESC' }
    });
    console.log(`orderItem: ${orderItem.order_item_id}, found task: ${task ? task.task_id : 'none'}`);
    console.log(`task status: ${task ? task.status : 'N/A'}`);
    // if (orderItem.retry_reassign_attempts >= 1){
      await this.productRequirementRepository.delete({ source_location_id: orderItem.source_location_id });
    // }
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
    // if (any_retry_exceed){
    await this.productRequirementRepository.delete({ source_location_id: source_location_id });
    // }
    // await this.productRequirementRepository.delete({ source_location_id: source_location_id });
    await this.orchestrationService.CancelTask(task);

  }
  
  async retryOrderByTaskId(taskId: string){
    const task = await this.taskRepository.findOne({ where: { task_id: taskId } });
    if (!task){
      throw new NotFoundException(`Task with ID ${taskId} not found`);
    }
    const nextSequenceTask = await this.taskRepository.findOne({
      where: {
        task_dependency: task.task_id,
        batch_id: task.batch_id,
      },
    });
    if (nextSequenceTask){
      throw new BadRequestException(`Cannot reassign Task ID ${taskId} because a subsequent task (Task ID ${nextSequenceTask.task_id}) exists`);
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
      const requirement = await this.productRequirementRepository.findOne({ where: {
        source_location_id: orderItems[0]?.source_location_id || '',
        station_id: gtpLocations[0].station_id,
      } });
      if (!requirement){
          await this.productRequirementRepository.save({
          source_location_id: orderItems[0]?.source_location_id || '',
          station_id: gtpLocations[0].station_id,
        });
      }
      
    }
    return await this.orchestrationService.handleErroneousTask(taskId);
  }

  async retryOrderItem(orderItemId: number) {
    const orderItem = await this.orderItemRepository.findOne({ where: { order_item_id: orderItemId } });
    if (!orderItem){
      throw new NotFoundException(`Order item with ID ${orderItemId} not found`);
    }
    if (orderItem.status !== OrderItemStatus.CANCELLED){
      throw new BadRequestException(`Order item with ID ${orderItemId} is not in CANCELLED status`);
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
      },
      order: { created_at: 'DESC' }
    });

    const gtpLocation = await this.gtpLocationRepository.findOne({ where: { gtp_location_id: orderItem.destination_pallet_slot_id } });
    if (!gtpLocation){
      throw new NotFoundException(`GTP Location with ID ${orderItem.destination_pallet_slot_id} not found`);
    }
    const requirement = await this.productRequirementRepository.findOne({ where: {
      source_location_id: orderItem.source_location_id,
      station_id: gtpLocation.station_id,
    } });
    if (!requirement){
      await this.productRequirementRepository.save({
        source_location_id: orderItem.source_location_id,
        station_id: await this.gtpLocationRepository.findOne({ where: { gtp_location_id: orderItem.destination_pallet_slot_id } }).then(loc => loc?.station_id || ''),
      });
    }

    if (task && task.status === TaskStatus.CANCELLED){
      await this.orchestrationService.handleErroneousTask(task.task_id);
    }
  }

  async reassignOrderItemLocation(orderItemId: number, quarantineLocationId: string) {
    const orderItem = await this.orderItemRepository.findOne({ where: { order_item_id: orderItemId } });
    if (!orderItem){
      throw new NotFoundException(`Order item with ID ${orderItemId} not found`);
    }

    const source_location_id = orderItem.source_location_id;
    const cancelled_task = await this.taskRepository.findOne({
      where: {
        origin_location: source_location_id,
      },
      order: { created_at: 'DESC' }
    });
    if (!cancelled_task || cancelled_task.status !== TaskStatus.CANCELLED){
      throw new BadRequestException(`Pallet for this order has not been Picked.`);
    }
    if ((cancelled_task.move_type === MOVE_TYPE.INVENTORY_TO_STATION || cancelled_task.move_type === MOVE_TYPE.STATION_TO_STATION) && cancelled_task.inqueue && !cancelled_task.processing && !cancelled_task.completed && !cancelled_task.triggered){
      throw new BadRequestException(`Pallet for this order has not been Picked.`);
    }

    const nextSequenceTask = await this.taskRepository.findOne({
      where: {
        task_dependency: cancelled_task.task_id,
        batch_id: cancelled_task.batch_id,
      },
    });
    if (nextSequenceTask){
      throw new BadRequestException(`Cannot reassign Order Item ID ${orderItemId} because a subsequent task (Task ID ${nextSequenceTask.task_id}) exists`);
    }

    if (await this.inventoryService.reserveInventory(quarantineLocationId) === false){
      throw new BadRequestException(`Failed to reserve inventory for Quarantine Location ID ${quarantineLocationId}`);
    }
    await this.inventoryService.makeInventoryProcessing(quarantineLocationId);

    // make the source location unavailable
    await this.inventoryService.makeInventoryUnavailable(cancelled_task.origin_location);

    const [newTaskId, newTask] = await this.orchestrationService.createTask({
      batchId: cancelled_task.batch_id,
      originLocation: source_location_id,
      sourceQuarantineLocationId: quarantineLocationId,
      destinationQuarantineLocationId: quarantineLocationId,
      taskType: TaskType.GOODS_TO_PERSON,
      robotId: cancelled_task.robot_id,
      move_type: MOVE_TYPE.TO_QUARANTINE,
      sequenceOrder: cancelled_task.sequence_order + 1,
      taskDependency: cancelled_task.task_id,
      cargos: cancelled_task.cargos,
      orderItems: null,
    });

    if (!newTask){
      throw new BadRequestException(`Failed to create new task for Order Item ID ${orderItemId}`);
    }

    await this.orchestrationService.sendSingleTaskToWms(newTask);

    orderItem.retry_reassign_attempts += 1;
    await this.orderItemRepository.save(orderItem);

    await this.loggingService.log(`Reassigned Order Item ID ${orderItem.order_item_id} to quarantine location ID ${quarantineLocationId}`,
      TaskType.GOODS_TO_PERSON, null, orderItem.order_batch_id || '');
    return { newTaskId, newTask  };
  }

  async reassignTaskLocation(taskId: string, quarantineLocationId: string) {
    const task = await this.taskRepository.findOne({ where: { task_id: taskId } });
    if (!task){
      throw new NotFoundException(`Task with ID ${taskId} not found`);
    }
    const nextSequenceTask = await this.taskRepository.findOne({
      where: {
        task_dependency: task.task_id,
        batch_id: task.batch_id,
      },
    });
    if (nextSequenceTask){
      throw new BadRequestException(`Cannot reassign Task ID ${taskId} because a subsequent task (Task ID ${nextSequenceTask.task_id}) exists`);
    }
    if (await this.inventoryService.reserveInventory(quarantineLocationId) === false){
      throw new BadRequestException(`Failed to reserve inventory for Quarantine Location ID ${quarantineLocationId}`);
    }
    await this.inventoryService.makeInventoryProcessing(quarantineLocationId);
    const orderItems = await this.orderItemRepository.find({
      where: {
        source_location_id: task.origin_location,
        status: In([OrderItemStatus.IN_PROGRESS])
      },
    });
    // make the source location unavailable
    await this.inventoryService.makeInventoryUnavailable(task.origin_location);
    if (orderItems.length > 0){
      orderItems.forEach(async (orderItem) => {
        orderItem.retry_reassign_attempts += 1;
        orderItem.status = OrderItemStatus.CANCELLED;
        await this.orderItemRepository.save(orderItem);
        await this.loggingService.log(`Incremented retry_reassign_attempts for Order Item ID ${orderItem.order_item_id} due to reassignment`,
          TaskType.GOODS_TO_PERSON, null, orderItem.order_batch_id || '');
      });
      await this.productRequirementRepository.delete({ source_location_id: task.origin_location });
    }
    const [newTaskId, newTask] = await this.orchestrationService.createTask({
      batchId: task.batch_id,
      originLocation: task.origin_location,
      sourceQuarantineLocationId: quarantineLocationId,
      destinationQuarantineLocationId: quarantineLocationId,
      taskType: TaskType.GOODS_TO_PERSON,
      move_type: MOVE_TYPE.TO_QUARANTINE,
      robotId: task.robot_id,
      sequenceOrder: task.sequence_order + 1,
      taskDependency: task.task_id,
      cargos: task.cargos,
      orderItems: null,
    });
    if (!newTask){
      throw new BadRequestException(`Failed to create new task for Task ID ${taskId}`);
    }
    await this.orchestrationService.sendSingleTaskToWms(newTask);
    return { newTaskId, newTask  };

  }

  async isRetryReassignEnabled(taskId?: string, orderItemId?: number, check_type: 'retry'| 'reassign'='retry'){
    if (check_type === 'reassign' && taskId){
      const task = await this.taskRepository.findOne({ where: { task_id: taskId } });
      if (!task){
        throw new NotFoundException(`Task with ID ${taskId} not found`);
      }
    }
    if (check_type === 'reassign' && orderItemId){
      const orderItem = await this.orderItemRepository.findOne({ where: { order_item_id: orderItemId } });
      if (!orderItem){
        throw new NotFoundException(`Order item with ID ${orderItemId} not found`);
      }

      const source_location_id = orderItem.source_location_id;
      const cancelled_task = await this.taskRepository.findOne({
        where: {
          origin_location: source_location_id,
        },
        order: { created_at: 'DESC' }
      });
      if (!cancelled_task || cancelled_task.status !== TaskStatus.CANCELLED){
        throw new BadRequestException(`Pallet for this order has not been Picked.`);
      }
      if ((cancelled_task.move_type === MOVE_TYPE.INVENTORY_TO_STATION || cancelled_task.move_type === MOVE_TYPE.STATION_TO_STATION) && cancelled_task.inqueue && !cancelled_task.processing && !cancelled_task.completed && !cancelled_task.triggered){
        throw new BadRequestException(`Pallet for this order has not been Picked.`);
      }
    }
    return { success: true };

  }
}
