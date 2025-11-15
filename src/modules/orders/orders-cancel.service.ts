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

  async cancel(taskId ?: string, orderItemId ?: number, reason: 'retry' | 'reassign' | 'back_to_inventory' | 'just_cancel' = 'retry'): Promise<void> {
    if (!taskId && !orderItemId) {
      throw new BadRequestException('Either taskId or orderItemId must be provided');
    }
    if (taskId){
        const task = await this.taskRepository.findOne({where: {task_id: taskId}, relations: ['orderItems']});
        if (!task) { throw new NotFoundException(`Task with id ${taskId} not found`); }
        if (reason === 'just_cancel'){
            // cancel the task
            await this.orchestrationService.CancelTask(task);
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
    }
  }
}