import { Injectable, BadRequestException, ForbiddenException, NotFoundException, LoggerService, Inject, forwardRef } from '@nestjs/common';
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
import { Log, ProductRequirement, Station, Task, TaskStatus, TaskType } from 'src/entities';
import { LoggingService } from '../../services/logging.service';
import { ScheduleMapping } from 'src/entities/schedule_mapping.entity';
import { OrchestratorService } from '../orchestrator/orchestrator.service';
import { MOVE_TYPE } from 'src/entities/task.entity';
import { retry } from 'rxjs';
import { InventoryService } from '../inventory/inventory.service';
import { WebhookService } from '../webhook/webhook.service';



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
    @InjectRepository(Station)
    private stationRepository: Repository<Station>,
    @Inject(forwardRef(() => OrchestratorService))
    private readonly orchestrationService: OrchestratorService,
    private readonly loggingService: LoggingService,
    private readonly inventoryService: InventoryService,
    private readonly webhookService: WebhookService,
  ) {}

  async cancelOneOrderItem(OrderItemId: number) {
    const orderItem = await this.orderItemRepository.findOne({ where: { order_item_id: OrderItemId } });
    if (!orderItem) {
      throw new NotFoundException(`Order item with ID ${OrderItemId} not found`);
    }
    orderItem.status = OrderItemStatus.CANCELLED; 
    await this.orderItemRepository.save(orderItem);
  }

  async cancel(taskId ?: string, orderItemId ?: number, reason: 'retry' | 'reassign' | 'back_to_inventory' | 'just_cancel' = 'retry', quarantine_location_id?: string): Promise<void> {
    if (!taskId && !orderItemId) {
      throw new BadRequestException('Either taskId or orderItemId must be provided');
    }
    if (taskId){
        const task = await this.taskRepository.findOne({where: {task_id: taskId}, relations: ['orderItems']});
        if (!task) { throw new NotFoundException(`Task with id ${taskId} not found`); }
        if (reason === 'just_cancel'){
            // cancel the task
            try{
              await this.orchestrationService.CancelTask(task);
            }
            catch { throw new BadRequestException(`Task with id ${taskId} could not be cancelled`); }
            // if the task is moving to station - cancel the task and order and make the inventory unavailable
            const end_type = task.end_location.location_attribute.attribute_value;
            if (end_type === 'station'){
                // cancel the order item
                const source_order_item_id = task.origin_location;
                const orderItems = await this.orderItemRepository.find({where: {source_location_id: source_order_item_id, status: OrderItemStatus.IN_PROGRESS }});
                for (const orderItem of orderItems){
                    orderItem.status = OrderItemStatus.CANCELLED;
                    await this.orderItemRepository.save(orderItem);
                    // remove the product requirement
                    await this.productRequirementRepository.delete({source_location_id: orderItem.source_location_id, station_id: task.end_location.location_id});
                }
            }
            if (!task.processing && task.start_location.location_attribute.attribute_value === 'inventory'){
                // make the inventory available
                await this.inventoryService.setInventoryAvailable(task.origin_location);
                await this.orchestrationService.unmarkSystemAsWaiting();
            }
            else{
                // make the inventory unavailable
                await this.inventoryService.setInventoryUnavailable(task.origin_location);
            }
            await this.orchestrationService.decrementRobotInUse();
            await this.webhookService.updateRobotUsage(task.robot_id, false);
        }
        else if (reason === 'retry'){
          if (task.status === TaskStatus.CANCELLED || task.status === TaskStatus.COMPLETED){
            throw new BadRequestException(`Task with id ${taskId} is already ${task.status} and cannot be retried`);
          }
          // cancel the task
          try{
            await this.orchestrationService.CancelTask(task);
          }
          catch { throw new BadRequestException(`Task with id ${taskId} could not be cancelled`); }
          task.status = TaskStatus.CANCELLED;
          await this.taskRepository.save(task);
          await this.webhookService.handleCancelledUpdateds(task, TaskStatus.CANCELLED);
          return await this.orchestrationService.handleErroneousTask(taskId);
        }
        else if (reason=== 'back_to_inventory'){
          const destionation_location_type = task.end_location.location_attribute.attribute_value;
          if (task.move_type === MOVE_TYPE.INVENTORY_TO_STATION && !task.processing){
            // pickup has not been done yet - throw the exception
            throw new BadRequestException(`Pallet has not been picked up - cannot return to inventory`);
          }
          else if (destionation_location_type === 'inventory'){
            throw new BadRequestException(`Task is already moving to inventory`);
          }
          else {
            // cancel the current task
            try{
              await this.orchestrationService.CancelTask(task);
            }
            catch { throw new BadRequestException(`Task with id ${taskId} could not be cancelled`); }
            task.status = TaskStatus.CANCELLED;
            await this.taskRepository.save(task);
            await this.webhookService.handleCancelledUpdateds(task, TaskStatus.CANCELLED);

            

            // create a new task to move back to inventory
            const [task_id, newTask] = await this.orchestrationService.createTask({
              batchId: task.batch_id,
              originLocation: task.origin_location,
              sourceInventoryId: task.origin_location,
              destinationInventoryId: task.origin_location,
              taskType: TaskType.GOODS_TO_PERSON,
              robotId: task.robot_id,
              move_type: MOVE_TYPE.INVENTORY_TO_INVENTORY,
              sequenceOrder: task.sequence_order+1,
              taskDependency: task.task_id,
            }); 
            if (!newTask){
              throw new BadRequestException(`Could not create task to move back to inventory`);
            }

            // cancel the order Items
            if (destionation_location_type ==='station'){
              const station_id = task.end_location.location_id;
              const orderItems = await this.orderItemRepository.find({where: {source_location_id: task.origin_location, status: OrderItemStatus.IN_PROGRESS }});
              for (const orderItem of orderItems){
                  orderItem.status = OrderItemStatus.CANCELLED;
                  await this.orderItemRepository.save(orderItem);
                  // remove the product requirement
                  await this.productRequirementRepository.delete({source_location_id: orderItem.source_location_id, station_id: station_id});
              }
            }

            if (destionation_location_type === 'empty_location'){
              // release the empty location
              await this.inventoryService.removeInventoryFromEmpty(task.origin_location);
            }


            await this.orchestrationService.sendSingleTaskToWms(newTask);
          }
        }
        else if (reason === 'reassign'){
          if (task.move_type === MOVE_TYPE.INVENTORY_TO_STATION && !task.processing){
            // pickup has not been done yet - throw the exception
            throw new BadRequestException(`Pallet has not been picked up - cannot reassign`);
          }
          if (!quarantine_location_id){
            throw new BadRequestException(`Quarantine Location ID must be provided for reassignment`);
          }
          if (await this.inventoryService.reserveInventory(quarantine_location_id) === false){
            throw new BadRequestException(`Failed to reserve inventory for Quarantine Location ID ${quarantine_location_id}`);
          }
          try{
            await this.orchestrationService.CancelTask(task);
          }
          catch { 
            await this.inventoryService.makeInventoryAvailable(quarantine_location_id);
            throw new BadRequestException(`Task with id ${taskId} could not be cancelled`); 
          }
          await this.inventoryService.makeInventoryProcessing(quarantine_location_id);
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
              await this.cancelOneOrderItem(orderItem.order_item_id);
              await this.loggingService.log(`Incremented retry_reassign_attempts for Order Item ID ${orderItem.order_item_id} due to reassignment`,
                TaskType.GOODS_TO_PERSON, null, orderItem.order_batch_id || '');
            });
            await this.productRequirementRepository.delete({ source_location_id: task.origin_location });
          }
          
          const [newTaskId, newTask] = await this.orchestrationService.createTask({
            batchId: task.batch_id,
            originLocation: task.origin_location,
            sourceQuarantineLocationId: quarantine_location_id,
            destinationQuarantineLocationId: quarantine_location_id,
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
        }
    }
  }

  async precancel(taskId ?: string, orderItemId ?: number, reason: 'retry' | 'reassign' | 'back_to_inventory' | 'just_cancel' = 'retry', quarantine_location_id?: string){
    if (!taskId && !orderItemId) {
      throw new BadRequestException('Either taskId or orderItemId must be provided');
    }
    if (taskId){
        const task = await this.taskRepository.findOne({where: {task_id: taskId}, relations: ['orderItems']});
        if (!task) { throw new NotFoundException(`Task with id ${taskId} not found`); }
        if (reason === 'just_cancel'){
          // no precondition is there for now.
        }
        else if (reason === 'retry'){
          if (task.status === TaskStatus.CANCELLED || task.status === TaskStatus.COMPLETED){
            throw new BadRequestException(`Task with id ${taskId} is already ${task.status} and cannot be retried`);
          }
        }
        else if (reason=== 'back_to_inventory'){
          const destionation_location_type = task.end_location.location_attribute.attribute_value;
          if (task.move_type === MOVE_TYPE.INVENTORY_TO_STATION && !task.processing){
            // pickup has not been done yet - throw the exception
            throw new BadRequestException(`Pallet has not been picked up - cannot return to inventory`);
          }
          else if (destionation_location_type === 'inventory'){
            throw new BadRequestException(`Task is already moving to inventory`);
          }
        }
        else if (reason === 'reassign'){
          if (task.move_type === MOVE_TYPE.INVENTORY_TO_STATION && !task.processing){
            // pickup has not been done yet - throw the exception
            throw new BadRequestException(`Pallet has not been picked up - cannot reassign`);
          }
          if (!quarantine_location_id){
            throw new BadRequestException(`Quarantine Location ID must be provided for reassignment`);
          }
        }
        
      }
    
  }
}