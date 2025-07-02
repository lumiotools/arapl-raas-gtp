import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OrderItem, OrderItemStatus } from 'src/entities/order-item.entity';
import { Task, TaskType, TaskStatus } from 'src/entities/task.entity';
import { Batch, BatchStatus } from 'src/entities/batch.entity';
import { Inventory } from 'src/entities/inventory.entity';
import { Station } from 'src/entities/station.entity';
import { GtpLocation } from 'src/entities/gtp-location.entity';
import { InventoryService } from '../inventory/inventory.service';

interface ProductRequirement {
  productId: string;
  totalRequirement: number;
  stationRequirements: Map<string, number>;
}

@Injectable()
export class OrchestratorService {
  private readonly logger = new Logger(OrchestratorService.name);

  constructor(
    @InjectRepository(OrderItem)
    private readonly orderItemRepository: Repository<OrderItem>,
    @InjectRepository(Task)
    private readonly taskRepository: Repository<Task>,
    @InjectRepository(Batch)
    private readonly batchRepository: Repository<Batch>,
    @InjectRepository(Inventory)
    private readonly inventoryRepository: Repository<Inventory>,
    @InjectRepository(Station)
    private readonly stationRepository: Repository<Station>,
    @InjectRepository(GtpLocation)
    private readonly gtpLocationRepository: Repository<GtpLocation>,
    private readonly inventoryService: InventoryService,
  ) {}

  // Run every 30 seconds
  @Cron('*/30 * * * * *')
  async processAssignedOrderItems() {
    this.logger.log('Starting orchestrator process...');
    
    try {
      // Step 1 & 2: Get assigned order items and change status to in-progress
      const assignedItems = await this.getAndUpdateAssignedItems();
      
      if (assignedItems.length === 0) {
        this.logger.log('No assigned order items found');
        return;
      }

      this.logger.log(`Found ${assignedItems.length} assigned order items`);

      // Step 3 & 4: Calculate product requirements and sort by descending order
      const productRequirements = await this.calculateProductRequirements(assignedItems);
      
      // Step 5-9: Process each product and create tasks
      const batchId = await this.generateBatchId();
      await this.createBatch(batchId, productRequirements);

      for (const requirement of productRequirements) {
        await this.processProductRequirement(requirement, batchId);
      }

      this.logger.log(`Orchestrator process completed. Created batch: ${batchId}`);
      
    } catch (error) {
      this.logger.error('Error in orchestrator process:', error);
    }
  }

  private async getAndUpdateAssignedItems(): Promise<OrderItem[]> {
    const assignedItems = await this.orderItemRepository.find({
      where: { status: OrderItemStatus.ASSIGNED },
      relations: ['assignedGtpLocation', 'assignedGtpLocation.station']
    });

    // Update status to IN_PROGRESS
    if (assignedItems.length > 0) {
      await this.orderItemRepository.update(
        { status: OrderItemStatus.ASSIGNED },
        { status: OrderItemStatus.IN_PROGRESS }
      );
    }

    return assignedItems;
  }

  private async calculateProductRequirements(orderItems: OrderItem[]): Promise<ProductRequirement[]> {
    const requirementMap = new Map<string, ProductRequirement>();

    for (const item of orderItems) {
      const productId = item.product_id;
      const stationId = item.assignedGtpLocation?.station_id;
      
      if (!stationId) {
        this.logger.warn(`Order item ${item.order_item_id} has no station assigned`);
        continue;
      }

      if (!requirementMap.has(productId)) {
        requirementMap.set(productId, {
          productId,
          totalRequirement: 0,
          stationRequirements: new Map<string, number>()
        });
      }

      const requirement = requirementMap.get(productId)!;
      requirement.totalRequirement += item.quantity;
      
      const currentStationReq = requirement.stationRequirements.get(stationId) || 0;
      requirement.stationRequirements.set(stationId, currentStationReq + item.quantity);
    }

    // Sort by descending total requirement
    return Array.from(requirementMap.values()).sort(
      (a, b) => b.totalRequirement - a.totalRequirement
    );
  }

  private async processProductRequirement(requirement: ProductRequirement, batchId: string) {
    // Step 5: Get all inventories for this product
    const inventories = await this.inventoryService.findAllByProductId(requirement.productId);
    
    if (!inventories || inventories.length === 0) {
      this.logger.warn(`No inventories found for product ${requirement.productId}`);
      return;
    }

    // Step 6: Find minimum number of inventories to satisfy total requirement
    const selectedInventories = this.findMinimalInventories(inventories, requirement.totalRequirement);
    
    if (selectedInventories.length === 0) {
      this.logger.warn(`Insufficient inventory for product ${requirement.productId}`);
      return;
    }

    // Step 7: Get stations sorted by priority (ascending order)
    const sortedStations = await this.getStationsSortedByPriority(Array.from(requirement.stationRequirements.keys()));

    // Step 8: Create batch tasks for each inventory
    let sequenceOrder = 1;
    const remainingRequirements = new Map(requirement.stationRequirements);

    for (const inventory of selectedInventories) {
      sequenceOrder = await this.createBatchTasksForInventory(
        inventory,
        sortedStations,
        remainingRequirements,
        batchId,
        sequenceOrder
      );
    }
  }

  private findMinimalInventories(inventories: Inventory[], totalRequirement: number): Inventory[] {
    // Sort inventories by quantity (descending) to use greedy approach
    const sortedInventories = inventories
      .filter(inv => inv.quantity > 0)
      .sort((a, b) => b.quantity - a.quantity);

    const selected: Inventory[] = [];
    let remainingRequirement = totalRequirement;

    for (const inventory of sortedInventories) {
      if (remainingRequirement <= 0) break;

      selected.push(inventory);
      remainingRequirement -= inventory.quantity;
    }

    if (remainingRequirement > 0) {
      this.logger.warn(`Insufficient total inventory. Missing: ${remainingRequirement} units`);
    }

    return selected;
  }

  private async getStationsSortedByPriority(stationIds: string[]): Promise<Station[]> {
    const stations = await this.stationRepository.find({
      where: stationIds.map(id => ({ station_id: id }))
    });

    // Sort by priority in ascending order (lower priority number = higher priority)
    return stations.sort((a, b) => a.priority - b.priority);
  }

  private async createBatchTasksForInventory(
    inventory: Inventory,
    sortedStations: Station[],
    remainingRequirements: Map<string, number>,
    batchId: string,
    startSequenceOrder: number
  ): Promise<number> {
    let sequenceOrder = startSequenceOrder;
    let availableQuantity = inventory.quantity;
    let lastLocation = `inventory:${inventory.id}`; // Track current location
    const inventoryUpdates: number[] = []; // Track quantity changes for final update

    // Create path: inventory → station1 → station2 → ... → stationN → inventory
    for (const station of sortedStations) {
      const stationRequirement = remainingRequirements.get(station.station_id) || 0;
      
      if (stationRequirement <= 0 || availableQuantity <= 0) {
        continue; // Skip if station doesn't need anything or inventory is empty
      }

      const deliveryQuantity = Math.min(availableQuantity, stationRequirement);

      // Create task to move from current location to this station
      if (lastLocation.startsWith('inventory:')) {
        // Task: inventory → station
        await this.createTask({
          batchId,
          productId: inventory.product_id,
          sourceInventoryId: inventory.id,
          destinationStationId: station.station_id,
          quantity: availableQuantity, // Move entire available quantity
          taskType: TaskType.INVENTORY_TO_STATION,
          sequenceOrder: sequenceOrder++
        });
      } else {
        // Task: previous station → current station
        const previousStationId = lastLocation.replace('station:', '');
        await this.createTask({
          batchId,
          productId: inventory.product_id,
          sourceStationId: previousStationId,
          destinationStationId: station.station_id,
          quantity: availableQuantity,
          taskType: TaskType.STATION_TO_STATION,
          sequenceOrder: sequenceOrder++
        });
      }

      // Update quantities
      availableQuantity -= deliveryQuantity;
      remainingRequirements.set(station.station_id, stationRequirement - deliveryQuantity);
      lastLocation = `station:${station.station_id}`;

      this.logger.log(`Inventory ${inventory.id} delivers ${deliveryQuantity} to station ${station.station_id}`);
    }

    // Return remaining quantity to inventory if not at inventory
    if (!lastLocation.startsWith('inventory:') && availableQuantity >= 0) {
      const sourceStationId = lastLocation.replace('station:', '');
      await this.createTask({
        batchId,
        productId: inventory.product_id,
        sourceStationId: sourceStationId,
        destinationInventoryId: inventory.id,
        quantity: availableQuantity,
        taskType: TaskType.STATION_TO_INVENTORY,
        sequenceOrder: sequenceOrder++
      });
    }

    // Update inventory quantity in database
    const finalQuantity = availableQuantity;
    await this.inventoryRepository.update(
      { id: inventory.id },
      { quantity: finalQuantity }
    );

    this.logger.log(`Inventory ${inventory.id} final quantity: ${finalQuantity}`);
    return sequenceOrder;
  }

  private async createTask(taskData: {
    batchId: string;
    productId: string;
    sourceInventoryId?: string;
    sourceStationId?: string;
    destinationStationId?: string;
    destinationInventoryId?: string;
    quantity: number;
    taskType: TaskType;
    sequenceOrder: number;
  }) {
    const task = this.taskRepository.create({
      batch_id: taskData.batchId,
      product_id: taskData.productId,
      source_inventory_id: taskData.sourceInventoryId,
      source_station_id: taskData.sourceStationId,
      destination_station_id: taskData.destinationStationId,
      destination_inventory_id: taskData.destinationInventoryId,
      quantity: taskData.quantity,
      task_type: taskData.taskType,
      sequence_order: taskData.sequenceOrder,
      status: TaskStatus.PENDING
    });

    await this.taskRepository.save(task);
    this.logger.log(`Created task: ${taskData.taskType} - ${taskData.quantity} units of ${taskData.productId}`);
  }

  private async generateBatchId(): Promise<string> {
    const timestamp = Date.now();
    return `B${timestamp.toString().slice(-10)}`;
  }

  private async createBatch(batchId: string, requirements: ProductRequirement[]) {
    const totalProducts = requirements.length;
    const description = `Batch for ${totalProducts} products: ${requirements.map(r => r.productId).join(', ')}`;

    const batch = this.batchRepository.create({
      batch_id: batchId,
      description,
      status: BatchStatus.PENDING,
      total_tasks: 0, // Will be updated as tasks are created
      completed_tasks: 0
    });

    await this.batchRepository.save(batch);
  }

  // Manual trigger method for testing
  async triggerOrchestrator() {
    this.logger.log('Manually triggering orchestrator...');
    await this.processAssignedOrderItems();
  }

  // Get batch status
  async getBatchStatus(batchId: string) {
    return await this.batchRepository.findOne({
      where: { batch_id: batchId },
      relations: ['tasks']
    });
  }

  // Get all batches
  async getAllBatches() {
    return await this.batchRepository.find({
      order: { created_at: 'DESC' }
    });
  }
}
