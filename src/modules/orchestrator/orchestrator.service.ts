import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { OrderItem, OrderItemStatus } from 'src/entities/order-item.entity';
import { Task, TaskType, TaskStatus } from 'src/entities/task.entity';
import { Batch, BatchStatus } from 'src/entities/batch.entity';
import { Inventory } from 'src/entities/inventory.entity';
import { Station, LocationStatus } from 'src/entities/station.entity';
import { WaitingLocation, WaitingLocationStatus } from 'src/entities/waiting-location.entity';
import { GtpLocation } from 'src/entities/gtp-location.entity';
import { StationRequest } from 'src/entities/station-request.entity';
import { ProductRequirement as ProductRequirementEntity } from 'src/entities/product-requirement.entity';
import { Location, LocationType, LocationAction, LocationDimension, LocationAttribute } from 'src/entities/location.entity';
import { Wait, WaitType, WaitStatus, FallbackAction } from 'src/entities/wait.entity';
import { Cargo, CargoDimension, CargoAttribute } from 'src/entities/cargo.entity';
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
    @InjectRepository(WaitingLocation)
    private readonly waitingLocationRepository: Repository<WaitingLocation>,
    @InjectRepository(GtpLocation)
    private readonly gtpLocationRepository: Repository<GtpLocation>,
    @InjectRepository(StationRequest)
    private readonly stationRequestRepository: Repository<StationRequest>,
    @InjectRepository(ProductRequirementEntity)
    private readonly productRequirementRepository: Repository<ProductRequirementEntity>,
    private readonly inventoryService: InventoryService,
    private readonly httpService: HttpService,
  ) {}

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
      for (const requirement of productRequirements) {
        await this.processProductRequirement(requirement.productId);
      }

      // After all batches are created, process first tasks
      await this.processFirstTasks();

      this.logger.log(`Orchestrator process completed successfully`);
      
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

    // Save requirements to database
    await this.saveProductRequirementsToDatabase(requirementMap);

    // Sort by descending total requirement
    return Array.from(requirementMap.values()).sort(
      (a, b) => b.totalRequirement - a.totalRequirement
    );
  }

  private async saveProductRequirementsToDatabase(requirementMap: Map<string, ProductRequirement>): Promise<void> {
    this.logger.log('Saving product requirements to database...');
    
    for (const [productId, requirement] of requirementMap) {
      for (const [stationId, requirementQuantity] of requirement.stationRequirements) {
        // Check if requirement already exists
        const existingRequirement = await this.productRequirementRepository.findOne({
          where: { product_id: productId, station_id: stationId }
        });

        if (existingRequirement) {
          // Update existing requirement
          await this.productRequirementRepository.update(
            { product_id: productId, station_id: stationId },
            { requirement: requirementQuantity }
          );
          this.logger.log(`Updated requirement: Product ${productId} at Station ${stationId} = ${requirementQuantity}`);
        } else {
          // Create new requirement
          const newRequirement = this.productRequirementRepository.create({
            product_id: productId,
            station_id: stationId,
            requirement: requirementQuantity
          });
          await this.productRequirementRepository.save(newRequirement);
          this.logger.log(`Created requirement: Product ${productId} at Station ${stationId} = ${requirementQuantity}`);
        }
      }
    }
  }

  private async processProductRequirement(productId: string) {
    // Step 5: Get all inventories for this product
    const inventories = await this.inventoryService.findAllByProductId(productId);
    
    if (!inventories || inventories.length === 0) {
      this.logger.warn(`No inventories found for product ${productId}`);
      return;
    }

    // Step 6: Read product requirements from database for this product
    const productRequirements = await this.productRequirementRepository.find({
      where: { product_id: productId },
      order: { station_id: 'ASC' }
    });

    if (!productRequirements || productRequirements.length === 0) {
      this.logger.warn(`No product requirements found in database for product ${productId}`);
      return;
    }

    // Get stations sorted by priority (ascending order) 
    const stationIds = productRequirements.map(pr => pr.station_id);
    const sortedStations = await this.getStationsSortedByPriority(stationIds);

    // Step 7: Create separate batch for each inventory with single task to first available station
    // If no station is available, create station requests for all required stations
    for (const inventory of inventories) {
      // Create a separate batch for this inventory
      const batchId = await this.generateBatchId();
      await this.createBatch(batchId, inventory, productId);
      
      // Create only one task to the first available station in priority order
      // If no station is available, create station requests for all required stations
      await this.createSingleTaskToFirstAvailableStation(
        inventory,
        sortedStations,
        batchId
      );
      
      this.logger.log(`Created batch ${batchId} for inventory ${inventory.id} with single task to first available station`);
    }
  }

  private async getStationsSortedByPriority(stationIds: string[]): Promise<Station[]> {
    const stations = await this.stationRepository.find({
      where: stationIds.map(id => ({ station_id: id }))
    });

    // Sort by priority in ascending order (lower priority number = higher priority)
    return stations.sort((a, b) => a.priority - b.priority);
  }

  private async findLastTaskFromSameInventory(inventoryId: string): Promise<number | null> {
    // Find the most recently created batch that starts from the same inventory
    // and is not fully completed
    const batches = await this.batchRepository
      .createQueryBuilder('batch')
      .leftJoinAndSelect('batch.tasks', 'task')
      .where('task.sequence_order = 1') // First task of batch
      .orderBy('batch.created_at', 'DESC')
      .getMany();

    for (const batch of batches) {
      // Check if the first task starts from the same inventory
      const firstTask = batch.tasks?.find(task => task.sequence_order === 1);
      if (firstTask && firstTask.start_location.location_id === inventoryId) {
        // Check if this batch is fully completed
        const allTasks = await this.taskRepository.find({
          where: { batch_id: batch.batch_id }
        });

        const allCompleted = allTasks.every(task => task.status === TaskStatus.COMPLETED);
        
        if (!allCompleted) {
          // Found a non-completed batch, get its last task (highest sequence_order)
          const lastTask = await this.taskRepository.findOne({
            where: { batch_id: batch.batch_id },
            order: { sequence_order: 'DESC' }
          });
          
          if (lastTask) {
            this.logger.log(`Found dependency: New batch should depend on task ${lastTask.task_id} from batch ${batch.batch_id}`);
            return lastTask.task_id;
          }
        }
      }
    }

    return null; // No dependency found
  }

  /**
   * Create a single task to the first available station in priority order.
   * If no station is available, create station requests for all required stations.
   */
  private async createSingleTaskToFirstAvailableStation(
    inventory: Inventory,
    sortedStations: Station[],
    batchId: string
  ): Promise<void> {
    // Find the first available station in priority order
    let targetStation: Station | null = null;
    
    for (const station of sortedStations) {
      // Check if the station is available (not RESERVED or OCCUPIED)
      if (station.status === LocationStatus.AVAILABLE) {
        targetStation = station;
        break; // Take the first available station, don't skip to lower priority
      }
    }

    // Check for cross-batch inventory dependency (if previous batch used same inventory)
    const dependencyTaskId = await this.findLastTaskFromSameInventory(inventory.id);

    if (targetStation) {
      // Station is available - create task immediately
      const taskId = await this.createTask({
        batchId,
        productId: inventory.product_id,
        sourceInventoryId: inventory.id,
        destinationStationId: targetStation.station_id,
        quantity: inventory.quantity, // Move entire available quantity
        taskType: TaskType.GOODS_TO_PERSON,
        sequenceOrder: 1, // First (and only) task in this batch
        taskDependency: dependencyTaskId // May depend on previous batch
      });

      // Remove the fulfilled product requirement from database
      await this.removeProductRequirement(inventory.product_id, targetStation.station_id);

      this.logger.log(`Created single task ${taskId} for batch ${batchId}: inventory ${inventory.id} → station ${targetStation.station_id} (${inventory.quantity} units)`);
    } else {
      // No station is available - create task without station and add station request for first required station only
      this.logger.warn(`No available stations found for batch ${batchId} (inventory ${inventory.id}) - creating station request for first required station`);
      
      // Create a task without a specific destination station (will be assigned when station becomes available)
      const taskId = await this.createTask({
        batchId,
        productId: inventory.product_id,
        sourceInventoryId: inventory.id,
        destinationStationId: sortedStations[0].station_id, // Use first station as placeholder
        quantity: inventory.quantity,
        taskType: TaskType.GOODS_TO_PERSON,
        sequenceOrder: 1,
        taskDependency: dependencyTaskId
      });

      // Get the created task
      const task = await this.taskRepository.findOne({
        where: { task_id: taskId }
      });

      if (task) {
        // Create station request only for the first required station (highest priority)
        const firstStation = sortedStations[0];
        await this.addStationRequest(task, firstStation.station_id);
        this.logger.log(`Added station request for task ${taskId} to station ${firstStation.station_id} (first required station)`);
        
        this.logger.log(`Created task ${taskId} for batch ${batchId} with station request for first station ${firstStation.station_id}`);
      }
    }
  }

  private async createTask(taskData: {
    batchId: string;
    productId: string;
    sourceInventoryId?: string;
    sourceStationId?: string;
    sourceWaitingLocationId?: string;
    destinationStationId?: string;
    destinationInventoryId?: string;
    destinationWaitingLocationId?: string;
    quantity: number;
    taskType: TaskType;
    sequenceOrder: number;
    taskDependency?: number | null;
  }): Promise<number> {
    // Create start location
    const startLocation = this.createLocation(
      taskData.sourceInventoryId || taskData.sourceStationId || taskData.sourceWaitingLocationId!,
      taskData.sourceInventoryId ? 'inventory' : taskData.sourceStationId ? 'station' : 'waiting_location',
      this.getLocationAction(taskData, 'start')
    );

    // Create end location
    const endLocation = this.createLocation(
      taskData.destinationInventoryId || taskData.destinationStationId || taskData.destinationWaitingLocationId!,
      taskData.destinationInventoryId ? 'inventory' : taskData.destinationStationId ? 'station' : 'waiting_location',
      this.getLocationAction(taskData, 'end')
    );

    // Create wait object
    const waitObject = this.createWaitObject();

    // Create cargos array
    const cargosArray = this.createCargoArray(taskData.productId);

    const task = this.taskRepository.create({
      batch_id: taskData.batchId,
      product_id: taskData.productId,
      quantity: taskData.quantity,
      task_type: taskData.taskType,
      sequence_order: taskData.sequenceOrder,
      task_dependency: taskData.taskDependency || undefined,
      status: TaskStatus.PENDING,
      start_location: startLocation,
      end_location: endLocation,
      wait: waitObject,
      cargos: cargosArray
    });

    const savedTask = await this.taskRepository.save(task);
    this.logger.log(`Created task ${savedTask.task_id}: ${taskData.taskType} - ${taskData.quantity} units of ${taskData.productId}${taskData.taskDependency ? ` (depends on task ${taskData.taskDependency})` : ''}`);
    
    return savedTask.task_id;
  }

  private createLocation(
    locationId: string,
    locationType: 'inventory' | 'station' | 'waiting_location',
    locationAction: LocationAction
  ): Location {
    return {
      location_id: locationId,
      location_type: LocationType.ZONE,
      location_action: locationAction,
      location_dimension: { length: 1, height: 1, width: 1 },
      location_attribute: { 
        attribute_name: 'location_type',
        attribute_value: locationType
      }
    };
  }

  private createWaitObject(): Wait {
    return {
      wait_type: WaitType.TRIGGER
    };
  }

  private createCargoArray(productId: string): Cargo[] {
    return [{
      cargo_code: productId,
      cargo_type: 'Pallet',
      cargo_dimension: { length: 1, width: 1, height: 1 },
      cargo_attributes: null,
      cargo_weight: 1
    }];
  }

  private getLocationAction(taskData: any, position: 'start' | 'end'): LocationAction {
    const isInventoryToStation = taskData.sourceInventoryId && taskData.destinationStationId;
    const isStationToStation = taskData.sourceStationId && taskData.destinationStationId;
    const isStationToInventory = taskData.sourceStationId && taskData.destinationInventoryId;
    const isStationToWaiting = taskData.sourceStationId && taskData.destinationWaitingLocationId;
    const isWaitingToStation = taskData.sourceWaitingLocationId && taskData.destinationStationId;

    if (isInventoryToStation || isWaitingToStation) {
      return position === 'start' ? LocationAction.PICK : LocationAction.WAIT;
    } else if (isStationToStation || isStationToWaiting) {
      return position === 'start' ? LocationAction.PICK : LocationAction.WAIT;
    } else if (isStationToInventory) {
      return position === 'start' ? LocationAction.PICK : LocationAction.DROP;
    }

    // Default fallback
    return LocationAction.NOP;
  }

  private async generateBatchId(): Promise<string> {
    const timestamp = Date.now();
    return `B${timestamp.toString().slice(-10)}`;
  }

  private async createBatch(batchId: string, inventory: Inventory, productId: string) {
    const description = `Batch for inventory ${inventory.id} - Product ${productId} (Qty: ${inventory.quantity})`;

    const batch = this.batchRepository.create({
      batch_id: batchId,
      description,
      status: BatchStatus.PENDING,
      total_tasks: 0, // Will be updated as tasks are created
      completed_tasks: 0
    });

    await this.batchRepository.save(batch);
  }

  private async sendBatchToWmsApi(batchId: string) {
    try {
      // Get the batch with all its tasks
      const batch = await this.batchRepository.findOne({
        where: { batch_id: batchId },
        relations: ['tasks']
      });

      if (!batch || !batch.tasks || batch.tasks.length === 0) {
        this.logger.warn(`Batch ${batchId} not found or has no tasks`);
        return;
      }

      // Prepare the request body according to WMS API format
      const requestBody = {
        batch_job_id: batchId,
        batch_priority: 5, // Default priority
        batch_type: 'Discrete', // Default type
        tasks: batch.tasks.map(task => ({
          task_id: task.task_id.toString(),
          task_type: task.task_type,
          task_dependency: task.task_dependency?.toString() || null,
          start_location: task.start_location,
          end_location: task.end_location,
          wait: task.wait,
          cargos: task.cargos
        }))
      };

      // Log the request for reference
      console.log('=== WMS API Request ===');
      console.log('URL: http://localhost:3000/robot-job/cli/tasks');
      console.log('Method: POST');
      console.log('Headers: { authorization: "operator_key" }');
      console.log('Body:', JSON.stringify(requestBody, null, 2));
      console.log('=====================');

      // Send the request to WMS API layer
      const response = await firstValueFrom(
        this.httpService.post('http://localhost:3000/robot-job/cli/tasks', requestBody, {
          headers: {
            'authorization': 'operator_key',
            'Content-Type': 'application/json'
          }
        })
      );

      this.logger.log(`Successfully sent batch ${batchId} to WMS API layer. Response received.`);
      
    } catch (error) {
      this.logger.error(`Failed to send batch ${batchId} to WMS API layer:`, error.message);
      if (error.response) {
        this.logger.error(`Response status: ${error.response.status}`);
        this.logger.error(`Response data:`, error.response.data);
      }
    }
  }

  // Process first tasks of all batches
  private async processFirstTasks(): Promise<void> {
    this.logger.log('Processing first tasks of all batches...');
    
    // Get all first tasks (sequence_order = 1) from inventory to station
    const firstTasks = await this.taskRepository.find({
      where: { 
        sequence_order: 1,
        status: TaskStatus.PENDING 
      },
      order: { created_at: 'ASC' }
    });

    for (const task of firstTasks) {
      // Verify it's inventory to station task
      if (task.start_location?.location_attribute?.attribute_value === 'inventory' &&
          task.end_location?.location_attribute?.attribute_value === 'station') {
        
        const stationId = task.end_location.location_id;
        await this.handleStationRequest(task, stationId);
      }
    }
  }

  private async handleStationRequest(task: Task, stationId: string): Promise<void> {
    // Check if station is available
    const station = await this.stationRepository.findOne({
      where: { station_id: stationId }
    });

    if (!station) {
      this.logger.warn(`Station ${stationId} not found`);
      return;
    }

    if (station.status === LocationStatus.AVAILABLE) {
      // Station is available - reserve it and send task to WMS
      await this.reserveStationAndSendTask(task, station);
    } else {
      // Station is not available - add to request queue
      await this.addStationRequest(task, stationId);
    }
  }

  private async reserveStationAndSendTask(task: Task, station: Station): Promise<void> {
    this.logger.log(`Reserving station ${station.station_id} for task ${task.task_id}`);
    
    // Mark station as reserved and set holded_by to task ID
    await this.stationRepository.update(
      { station_id: station.station_id },
      { 
        status: LocationStatus.RESERVED,
        holded_by: task.task_id
      }
    );

    // Remove the fulfilled product requirement from database
    await this.removeProductRequirement(task.product_id, station.station_id);

    // Send single task to WMS
    await this.sendSingleTaskToWms(task);
  }

  public async addStationRequest(task: Task, stationId: string): Promise<void> {
    this.logger.log(`Adding station request for task ${task.task_id}, station ${stationId}`);
    const existingRequest = await this.stationRequestRepository.findOne({
      where: { task_id: task.task_id, station_id: stationId }
    });

    if (existingRequest) {
      this.logger.warn(`Station request already exists for task ${task.task_id} and station ${stationId}`);
      return;
    }
    
    const stationRequest = this.stationRequestRepository.create({
      task_id: task.task_id,
      station_id: stationId
    });

    await this.stationRequestRepository.save(stationRequest);
  }

  public async sendSingleTaskToWms(task: Task): Promise<void> {
    // Safety check: Only send tasks that are in PENDING status
    if (task.status !== TaskStatus.PENDING) {
      this.logger.warn(`Task ${task.task_id} is not in PENDING status (current: ${task.status}) - skipping WMS send`);
      return;
    }

    try {
      const requestBody = {
        tasks: [{
          task_id: task.task_id.toString(),
          task_type: task.task_type,
          task_dependency: task.task_dependency?.toString() || null,
          start_location: task.start_location,
          end_location: task.end_location,
          wait: task.wait,
          cargos: task.cargos
        }]
      };

      this.logger.log(`Sending single task ${task.task_id} to WMS API`);
      console.log('=== WMS API Single Task Request ===');
      console.log('URL: http://localhost:3000/robot-job/cli/tasks');
      console.log('Method: POST');
      console.log('Headers: { authorization: "operator_key" }');
      console.log('Body:', JSON.stringify(requestBody, null, 2));
      console.log('===================================');

      const response = await firstValueFrom(
        this.httpService.post('http://localhost:3000/robot-job/cli/tasks', requestBody, {
          headers: {
            'authorization': 'operator_key',
            'Content-Type': 'application/json'
          }
        })
      );

      // Mark task as sent to prevent duplicate sending
      await this.taskRepository.update(
        { task_id: task.task_id },
        { status: TaskStatus.ASSIGNED }
      );

      this.logger.log(`Successfully sent task ${task.task_id} to WMS API layer and marked as ASSIGNED`);
      
    } catch (error) {
      this.logger.error(`Failed to send task ${task.task_id} to WMS API layer:`, error.message);
      if (error.response) {
        this.logger.error(`Response status: ${error.response.status}`);
        this.logger.error(`Response data:`, error.response.data);
      }
    }
  }

  // Method to be called from webhook when station becomes available
  async processStationRequests(stationId: string): Promise<void> {
    this.logger.log(`Processing pending requests for station ${stationId}`);
    
    // Get the oldest request for this station (FIFO)
    const oldestRequest = await this.stationRequestRepository.findOne({
      where: { station_id: stationId },
      order: { created_at: 'ASC' },
      relations: ['task']
    });

    if (oldestRequest) {
      // Safety check: Only process if task is still PENDING
      if (oldestRequest.task.status !== TaskStatus.PENDING) {
        this.logger.warn(`Task ${oldestRequest.task.task_id} in station request is not PENDING (current: ${oldestRequest.task.status}) - removing request`);
        await this.stationRequestRepository.remove(oldestRequest);
        
        // Try to process next request recursively
        await this.processStationRequests(stationId);
        return;
      }

      // Remove the request from queue
      await this.stationRequestRepository.remove(oldestRequest);
      
      // Get the station and reserve it
      const station = await this.stationRepository.findOne({
        where: { station_id: stationId }
      });

      if (station && station.status === LocationStatus.AVAILABLE) {
        await this.reserveStationAndSendTask(oldestRequest.task, station);
      } else {
        this.logger.warn(`Station ${stationId} is no longer available when processing request for task ${oldestRequest.task.task_id}`);
        // Also add back to queue if station was expected to be available but isn't
        await this.addStationRequest(oldestRequest.task, stationId);
      }
    }
  }

  // Method to be called from trigger when a task completes at a station
  async handleTaskCompletion(completedTask: Task): Promise<void> {
    // Prevent duplicate processing - only handle TRIGERRED tasks
    if (completedTask.status !== TaskStatus.TRIGERRED) {
      this.logger.warn(`Task ${completedTask.task_id} is not in TRIGERRED status (current: ${completedTask.status}) - skipping completion handling`);
      return;
    }

    this.logger.log(`Handling task completion for task ${completedTask.task_id} at station`);
    
    // Immediately update task status to prevent duplicate processing
    await this.taskRepository.update(
      { task_id: completedTask.task_id },
      { status: TaskStatus.PROCESSING }
    );
    
    try {
      // Get remaining product requirements for this product
      const remainingRequirements = await this.getRemainingProductRequirements(
        completedTask.product_id,
        completedTask.batch_id
      );

      if (remainingRequirements.length > 0) {
        // There are more stations to visit
        await this.createNextStationTask(completedTask, remainingRequirements);
      } else {
        // All stations visited - create task back to inventory
        await this.createReturnToInventoryTask(completedTask);
      }
    } catch (error) {
      this.logger.error(`Error processing next task for ${completedTask.task_id}:`, error.message);
      // Revert task status on error
      await this.taskRepository.update(
        { task_id: completedTask.task_id },
        { status: TaskStatus.TRIGERRED }
      );
      throw error;
    }
  }

  private async getRemainingProductRequirements(productId: string, batchId: string): Promise<ProductRequirementEntity[]> {
    // Get all product requirements for this product
    const allRequirements = await this.productRequirementRepository.find({
      where: { product_id: productId }
    });

    // Get stations with their priority info
    const stationIds = allRequirements.map(req => req.station_id);
    const stations = await this.stationRepository.find({
      where: stationIds.map(id => ({ station_id: id }))
    });

    // Sort requirements by station priority (ascending - lower number = higher priority)
    const sortedRequirements = allRequirements.sort((a, b) => {
      const stationA = stations.find(s => s.station_id === a.station_id);
      const stationB = stations.find(s => s.station_id === b.station_id);
      return (stationA?.priority || 999) - (stationB?.priority || 999);
    });

    return sortedRequirements;
  }

  private async createNextStationTask(completedTask: Task, remainingRequirements: ProductRequirementEntity[]): Promise<void> {
    // Find next available station in priority order
    let nextAvailableStation: Station | null = null;

    for (const requirement of remainingRequirements) {
      const station = await this.stationRepository.findOne({
        where: { station_id: requirement.station_id }
      });

      if (station && station.status === LocationStatus.AVAILABLE) {
        nextAvailableStation = station;
        break;
      }
    }

    const nextSequenceOrder = completedTask.sequence_order + 1;
    
    if (nextAvailableStation) {
      // Reserve the station first
      await this.stationRepository.update(
        { station_id: nextAvailableStation.station_id },
        { 
          status: LocationStatus.RESERVED,
          holded_by: null // Will be set when task is processed
        }
      );

      // Station available - create direct task to station
      const taskId = await this.createTask({
        batchId: completedTask.batch_id,
        productId: completedTask.product_id,
        sourceStationId: completedTask.end_location.location_id,
        destinationStationId: nextAvailableStation.station_id,
        quantity: completedTask.quantity,
        taskType: TaskType.GOODS_TO_PERSON,
        sequenceOrder: nextSequenceOrder,
        taskDependency: completedTask.task_id
      });

      // Get the created task and send to WMS
      const newTask = await this.taskRepository.findOne({
        where: { task_id: taskId }
      });

      if (newTask) {
        // Update station to be held by this task
        await this.stationRepository.update(
          { station_id: nextAvailableStation.station_id },
          { holded_by: newTask.task_id }
        );

        // Send task to WMS
        await this.sendSingleTaskToWms(newTask);
      }

      // Remove the fulfilled requirement
      await this.removeProductRequirement(completedTask.product_id, nextAvailableStation.station_id);

      this.logger.log(`Created next station task ${taskId}: station ${completedTask.end_location.location_id} → station ${nextAvailableStation.station_id} (station reserved and task sent to WMS)`);
    } else {
      // No station available - go to waiting location and create station request
      await this.createWaitingLocationTask(completedTask, remainingRequirements, nextSequenceOrder);
    }
  }

  private async createWaitingLocationTask(
    completedTask: Task, 
    remainingRequirements: ProductRequirementEntity[], 
    sequenceOrder: number
  ): Promise<void> {
    // Find an available waiting location
    const availableWaitingLocation = await this.waitingLocationRepository.findOne({
      where: { status: WaitingLocationStatus.AVAILABLE, is_active: true },
      order: { location_id: 'ASC' } // FIFO selection
    });

    if (!availableWaitingLocation) {
      this.logger.error(`No available waiting location found for task ${completedTask.task_id}`);
      return;
    }

    await this.waitingLocationRepository.update(
      { location_id: availableWaitingLocation.location_id },
      { status: WaitingLocationStatus.RESERVED, holded_by: completedTask.task_id }
    );

    // Create task to waiting location
    const waitingTaskId = await this.createTask({
      batchId: completedTask.batch_id,
      productId: completedTask.product_id,
      sourceStationId: completedTask.end_location.location_id,
      destinationWaitingLocationId: availableWaitingLocation.location_id,
      quantity: completedTask.quantity,
      taskType: TaskType.GOODS_TO_PERSON,
      sequenceOrder: sequenceOrder,
      taskDependency: completedTask.task_id
    });

    // Get the created waiting task
    const waitingTask = await this.taskRepository.findOne({
      where: { task_id: waitingTaskId }
    });

    console.log('Waiting task:', waitingTask);

    if (waitingTask) {
      // Send task to WMS
      await this.sendSingleTaskToWms(waitingTask);

      // Create station request for the first required station (highest priority)
      const firstRequiredStation = remainingRequirements[0];
      // Create additional task from waiting location to requested station
      const stationTaskId = await this.createTask({
        batchId: completedTask.batch_id,
        productId: completedTask.product_id,
        sourceWaitingLocationId: availableWaitingLocation.location_id,
        destinationStationId: firstRequiredStation.station_id,
        quantity: completedTask.quantity,
        taskType: TaskType.GOODS_TO_PERSON,
        sequenceOrder: sequenceOrder + 1,
        taskDependency: waitingTaskId
      });
      const stationTask = await this.taskRepository.findOne({
        where: { task_id: stationTaskId }
      });
      if (stationTask) {
        await this.addStationRequest(stationTask, firstRequiredStation.station_id);
      }

      this.logger.log(`Created waiting location task ${waitingTaskId}: station ${completedTask.end_location.location_id} → waiting location ${availableWaitingLocation.location_id} (task sent to WMS)`);
      this.logger.log(`Added station request for task ${waitingTaskId} to station ${firstRequiredStation.station_id}`);
    }
  }

  private async createReturnToInventoryTask(completedTask: Task): Promise<void> {
    // Get the original inventory location from the first task in this batch
    const firstTask = await this.taskRepository.findOne({
      where: { batch_id: completedTask.batch_id, sequence_order: 1 }
    });

    if (!firstTask) {
      this.logger.error(`Could not find first task for batch ${completedTask.batch_id}`);
      return;
    }

    const originalInventoryId = firstTask.start_location.location_id;
    const nextSequenceOrder = completedTask.sequence_order + 1;

    const returnTaskId = await this.createTask({
      batchId: completedTask.batch_id,
      productId: completedTask.product_id,
      sourceStationId: completedTask.end_location.location_id,
      destinationInventoryId: originalInventoryId,
      quantity: completedTask.quantity,
      taskType: TaskType.GOODS_TO_PERSON, // Use PUTAWAY for returning to inventory
      sequenceOrder: nextSequenceOrder,
      taskDependency: completedTask.task_id
    });

    // Get the created task and send to WMS
    const returnTask = await this.taskRepository.findOne({
      where: { task_id: returnTaskId }
    });

    if (returnTask) {
      await this.sendSingleTaskToWms(returnTask);
    }

    this.logger.log(`Created return to inventory task ${returnTaskId}: station ${completedTask.end_location.location_id} → inventory ${originalInventoryId} (task sent to WMS)`);
  }

  // Method to handle when a waiting location task gets assigned to a station
  async processWaitingLocationToStation(waitingTask: Task, availableStationId: string): Promise<void> {
    this.logger.log(`Processing waiting location task ${waitingTask.task_id} assignment to station ${availableStationId}`);
    
    // Get remaining requirements to determine if this is the last station
    const remainingRequirements = await this.getRemainingProductRequirements(
      waitingTask.product_id,
      waitingTask.batch_id
    );

    const nextSequenceOrder = waitingTask.sequence_order + 1;

    // Create task from waiting location to station
    const taskId = await this.createTask({
      batchId: waitingTask.batch_id,
      productId: waitingTask.product_id,
      sourceWaitingLocationId: waitingTask.end_location.location_id,
      destinationStationId: availableStationId,
      quantity: waitingTask.quantity,
      taskType: TaskType.GOODS_TO_PERSON,
      sequenceOrder: nextSequenceOrder,
      taskDependency: waitingTask.task_id
    });

    // Get the created task and send to WMS
    const newTask = await this.taskRepository.findOne({
      where: { task_id: taskId }
    });

    if (newTask) {
      await this.sendSingleTaskToWms(newTask);
    }

    // Remove the fulfilled requirement
    await this.removeProductRequirement(waitingTask.product_id, availableStationId);

    this.logger.log(`Created task ${taskId}: waiting location ${waitingTask.end_location.location_id} → station ${availableStationId} (task sent to WMS)`);
  }

  private async removeProductRequirement(productId: string, stationId: string): Promise<void> {
    try {
      const result = await this.productRequirementRepository.delete({
        product_id: productId,
        station_id: stationId
      });

      if (result.affected && result.affected > 0) {
        this.logger.log(`Removed fulfilled product requirement: Product ${productId} at Station ${stationId}`);
      } else {
        this.logger.warn(`No product requirement found to remove for Product ${productId} at Station ${stationId}`);
      }
    } catch (error) {
      this.logger.error(`Failed to remove product requirement for Product ${productId} at Station ${stationId}:`, error);
    }
  }

  // Get all waiting locations
  async getAllWaitingLocations() {
    return await this.waitingLocationRepository.find({
      order: { location_id: 'ASC' }
    });
  }

  // Get waiting location by ID
  async getWaitingLocationById(locationId: string) {
    return await this.waitingLocationRepository.findOne({
      where: { location_id: locationId }
    });
  }

  // Manual trigger method for testing
  public async triggerOrchestrator() {
    this.logger.log('Manually triggering orchestrator...');
    await this.processAssignedOrderItems();
  }

  // Get batch status
  public async getBatchStatus(batchId: string) {
    return await this.batchRepository.findOne({
      where: { batch_id: batchId },
      relations: ['tasks']
    });
  }

  // Get all batches
  public async getAllBatches() {
    return await this.batchRepository.find({
      order: { created_at: 'DESC' }
    });
  }

  // Get all product requirements
  public async getAllProductRequirements() {
    return await this.productRequirementRepository.find({
      order: { product_id: 'ASC', station_id: 'ASC' }
    });
  }

  // Get product requirements by product ID
  public async getProductRequirementsByProductId(productId: string) {
    return await this.productRequirementRepository.find({
      where: { product_id: productId },
      order: { station_id: 'ASC' }
    });
  }

  // Get product requirements by station ID  
  public async getProductRequirementsByStationId(stationId: string) {
    return await this.productRequirementRepository.find({
      where: { station_id: stationId },
      order: { product_id: 'ASC' }
    });
  }
}
