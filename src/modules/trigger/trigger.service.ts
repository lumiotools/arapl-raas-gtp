import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { Station, LocationStatus } from '../../entities/station.entity';
import { WaitingLocation, WaitingLocationStatus } from '../../entities/waiting-location.entity';
import { Task, TaskStatus } from '../../entities/task.entity';
import { StationRequest } from '../../entities/station-request.entity';
import { OrchestratorService } from '../orchestrator/orchestrator.service';
import { Inventory } from 'src/entities';
import { LoggingService } from '../../services/logging.service';

@Injectable()
export class TriggerService {
  constructor(
    @InjectRepository(Station)
    private readonly stationRepository: Repository<Station>,
    @InjectRepository(Task)
    private readonly taskRepository: Repository<Task>,
    @InjectRepository(WaitingLocation)
    private readonly waitingLocationRepository: Repository<WaitingLocation>,
    @InjectRepository(StationRequest)
    private readonly stationRequestRepository: Repository<StationRequest>,
    @InjectRepository(Inventory)
    private readonly inventoryRepository: Repository<Inventory>,
    private readonly orchestratorService: OrchestratorService,
    private readonly loggingService: LoggingService,
    private readonly httpService: HttpService,
  ) {}

  async triggerStationAction(stationId: string) {
    // Find the station
    const station = await this.stationRepository.findOne({
      where: { station_id: stationId },
    });

    if (!station) {
      throw new NotFoundException(`Station with ID ${stationId} not found`);
    }

    // Check if station is OCCUPIED (not RESERVED)
    if (station.status !== LocationStatus.OCCUPIED) {
      if (station.status === LocationStatus.RESERVED) {
        throw new ConflictException(`Can't trigger now - station ${stationId} is reserved`);
      }
      throw new ConflictException(`Can't trigger - station ${stationId} is not occupied (current status: ${station.status})`);
    }

    // Find the task that is holding this station
    if (!station.holded_by) {
      throw new NotFoundException(`No task is currently holding station ${stationId}`);
    }

    const currentTask = await this.taskRepository.findOne({
      where: { task_id: station.holded_by },
    });

    if (!currentTask) {
      throw new NotFoundException(`No task found holding station ${stationId}`);
    }

    // Update task status to TRIGGERED
    await this.taskRepository.update(
      { task_id: currentTask.task_id },
      { status: TaskStatus.TRIGERRED }
    );

    currentTask.status = TaskStatus.TRIGERRED;

    // Log trigger action
    await this.loggingService.log(`Station ${stationId} triggered successfully - Task ${currentTask.task_id} status updated to TRIGGERED`);

    // Note: Station will become available when webhook receives PROCESSING status
    // for the next task that has this station as source location

    // Find and process the next task in sequence
    await this.processNextTask(currentTask);

    // Free the robot holding this station
    if (currentTask.robot_id) {
      await this.freeRobot(currentTask.robot_id);
    }

    return {
      message: `Station ${stationId} triggered successfully`,
      triggered_task: {
        task_id: currentTask.task_id,
        batch_id: currentTask.batch_id,
        product_id: currentTask.product_id,
        previous_status: 'COMPLETED',
        new_status: 'TRIGGERED',
      },
      station: {
        station_id: stationId,
        status: station.status, // Station status remains the same until webhook processes next task
        holded_by: station.holded_by,
      },
      next_task_scheduled: true,
      timestamp: new Date(),
    };
  }

  private async processNextTask(completedTask: Task): Promise<void> {
    try {
      // Check if the completed task was at a station and handle station workflow
      if (completedTask.end_location?.location_attribute?.attribute_value === 'station') {
        console.log(`Task ${completedTask.task_id} completed at station - checking for next required stations`);
        await this.orchestratorService.handleTaskCompletion(completedTask);
        return; // Exit early - orchestrator handles the rest
      }

      // Handle existing logic for other cases (non-station endpoints)
      // This is for legacy workflows or non-product-requirement based tasks
      // Find the next sequence task in the same batch
      const nextTask = await this.taskRepository.findOne({
        where: { 
          batch_id: completedTask.batch_id,
          sequence_order: completedTask.sequence_order + 1,
          status: TaskStatus.PENDING
        }
      });

      if (nextTask) {
        console.log(`Found next task ${nextTask.task_id} (sequence ${nextTask.sequence_order}) in batch ${completedTask.batch_id}`);
        
        const destinationLocation = nextTask.end_location;
        
        if (destinationLocation?.location_attribute?.attribute_value === 'inventory') {
          // Destination is inventory - send directly to WMS
          console.log(`Next task ${nextTask.task_id} destination is inventory - sending directly to WMS`);
          await this.orchestratorService.sendSingleTaskToWms(nextTask);
        } else if (destinationLocation?.location_attribute?.attribute_value === 'station') {
          // Destination is station - check availability
          const stationId = destinationLocation.location_id;
          await this.handleNextTaskStationRequest(nextTask, stationId);
        } else if (destinationLocation?.location_attribute?.attribute_value === 'waiting_location') {
          // Destination is waiting location - send directly to WMS
          console.log(`Next task ${nextTask.task_id} destination is waiting location - sending directly to WMS`);
          await this.orchestratorService.sendSingleTaskToWms(nextTask);
        }
      } else {
        // No next task - batch might be completed
        console.log(`No next task found for batch ${completedTask.batch_id}`);
      }
    } catch (error) {
      console.error(`Error processing next task for ${completedTask.task_id}:`, error.message);
    }
  }

  private async handleNextTaskStationRequest(nextTask: Task, stationId: string): Promise<void> {
    const station = await this.stationRepository.findOne({
      where: { station_id: stationId }
    });

    if (!station) {
      console.warn(`Station ${stationId} not found for next task ${nextTask.task_id}`);
      return;
    }

    if (station.status === LocationStatus.AVAILABLE) {
      // Station is available - reserve it and send task to WMS
      console.log(`Station ${stationId} is available for next task ${nextTask.task_id} - reserving and sending to WMS`);
      
      await this.stationRepository.update(
        { station_id: stationId },
        { 
          status: LocationStatus.RESERVED,
          holded_by: nextTask.task_id
        }
      );

      await this.orchestratorService.sendSingleTaskToWms(nextTask);
    } else {
      // Station is not available - add to request queue
      console.log(`Station ${stationId} is not available for next task ${nextTask.task_id} - adding to request queue`);
      await this.orchestratorService.addStationRequest(nextTask, stationId);
    }
  }

  async getStationStatus(stationId: string) {
    const station = await this.stationRepository.findOne({
      where: { station_id: stationId },
    });

    if (!station) {
      throw new NotFoundException(`Station with ID ${stationId} not found`);
    }

    return {
      message: `Status retrieved for station ${stationId}`,
      station: {
        station_id: station.station_id,
        station_name: station.station_name,
        status: station.status,
        holded_by: station.holded_by,
        priority: station.priority,
        is_active: station.is_active,
        created_at: station.created_at,
        updated_at: station.updated_at,
      },
      timestamp: new Date(),
    };
  }

  async skipStationAction(stationId: string) {
    // Find the station
    const station = await this.stationRepository.findOne({
      where: { station_id: stationId },
    });

    if (!station) {
      throw new NotFoundException(`Station with ID ${stationId} not found`);
    }

    // Check if station is OCCUPIED (not RESERVED)
    if (station.status !== LocationStatus.OCCUPIED) {
      if (station.status === LocationStatus.RESERVED) {
        throw new ConflictException(`Can't skip now - station ${stationId} is reserved`);
      }
      throw new ConflictException(`Can't skip - station ${stationId} is not occupied (current status: ${station.status})`);
    }

    // Find the task that is holding this station
    if (!station.holded_by) {
      throw new NotFoundException(`No task is currently holding station ${stationId}`);
    }

    const currentTask = await this.taskRepository.findOne({
      where: { task_id: station.holded_by },
    });

    if (!currentTask) {
      throw new NotFoundException(`No task found holding station ${stationId}`);
    }

    // Mark current task as TRIGGERED (skipped)
    await this.taskRepository.update(
      { task_id: currentTask.task_id },
      { status: TaskStatus.TRIGERRED }
    );

    currentTask.status = TaskStatus.TRIGERRED;

    // Log skip action
    await this.loggingService.log(`Station ${stationId} skipped - Task ${currentTask.task_id} marked as TRIGGERED without processing (quantity preserved: ${currentTask.quantity})`);

    // Create next task with same quantity (no quantity drop occurred)
    const nextTaskResult = await this.createNextTaskForSkip(currentTask);

    // Free the robot holding this station
    if (currentTask.robot_id) {
      await this.freeRobot(currentTask.robot_id);
    }

    return {
      message: `Station ${stationId} skipped successfully`,
      skipped_task: {
        task_id: currentTask.task_id,
        batch_id: currentTask.batch_id,
        product_id: currentTask.product_id,
        previous_status: 'COMPLETED',
        new_status: 'TRIGGERED',
        quantity: currentTask.quantity,
        skipped_station: stationId
      },
      next_task: nextTaskResult,
      station: {
        station_id: stationId,
        status: station.status,
        message: 'Station remains occupied until next task starts processing'
      },
      timestamp: new Date(),
    };
  }

  private async createNextTaskForSkip(currentTask: Task) {
    try {
      // For skip operations, call orchestrator with isSkipOperation=true
      // This preserves full quantity and doesn't update product requirements
      await this.orchestratorService.handleTaskCompletion(currentTask, true);

      await this.loggingService.log(`Skip operation completed for task ${currentTask.task_id} - orchestrator handled next task creation with full quantity ${currentTask.quantity} (no product requirements updated)`);

      // Return a generic response since orchestrator handles the actual task creation
      return {
        task_id: 'TBD', // Will be created by orchestrator
        destination: 'TBD', // Will be determined by orchestrator
        quantity: currentTask.quantity,
        status: 'PENDING',
        type: 'ORCHESTRATOR_MANAGED',
        note: 'Next task creation handled by orchestrator service with preserved quantity'
      };
    } catch (error) {
      await this.loggingService.log(`Error in skip operation for task ${currentTask.task_id}: ${error.message}`);
      throw error;
    }
  }

  // Method to free robot by calling the external endpoint
  private async freeRobot(robotId: string): Promise<void> {
    if (!robotId) {
      await this.loggingService.log('Cannot free robot: robot_id is null or empty');
      return;
    }

    try {
      const response = await this.httpService.post('http://localhost:3000/orchestrator/robot/set-available', {
        robot_id: robotId
      }).toPromise();

      if (response && response.data) {
        await this.loggingService.log(`Robot ${robotId} freed successfully: ${response.data.message || 'Robot set to available'}`);
      } else {
        await this.loggingService.log(`Robot ${robotId} freed successfully`);
      }
    } catch (error) {
      await this.loggingService.log(`Failed to free robot ${robotId}: ${error.message}`);
      // Don't throw error to avoid breaking the main process
    }
  }
}
