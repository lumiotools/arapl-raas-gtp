import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Station, LocationStatus } from '../../entities/station.entity';
import { WaitingLocation, WaitingLocationStatus } from '../../entities/waiting-location.entity';
import { Task, TaskStatus } from '../../entities/task.entity';
import { StationRequest } from '../../entities/station-request.entity';
import { OrchestratorService } from '../orchestrator/orchestrator.service';

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
    private readonly orchestratorService: OrchestratorService,
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

    // Note: Station will become available when webhook receives PROCESSING status
    // for the next task that has this station as source location

    // Find and process the next task in sequence
    await this.processNextTask(currentTask);

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

  async triggerWaitingLocationAction(waitingLocationId: string) {
    // Find the waiting location
    const waitingLocation = await this.waitingLocationRepository.findOne({
      where: { location_id: waitingLocationId },
    });

    if (!waitingLocation) {
      throw new NotFoundException(`Waiting location with ID ${waitingLocationId} not found`);
    }

    // Check if waiting location is OCCUPIED
    if (waitingLocation.status !== WaitingLocationStatus.OCCUPIED) {
      if (waitingLocation.status === WaitingLocationStatus.RESERVED) {
        throw new ConflictException(`Can't trigger now - waiting location ${waitingLocationId} is reserved`);
      }
      throw new ConflictException(`Can't trigger - waiting location ${waitingLocationId} is not occupied (current status: ${waitingLocation.status})`);
    }

    // Find the task that is holding this waiting location
    if (!waitingLocation.holded_by) {
      throw new NotFoundException(`No task is currently holding waiting location ${waitingLocationId}`);
    }

    const currentTask = await this.taskRepository.findOne({
      where: { task_id: waitingLocation.holded_by },
    });

    if (!currentTask) {
      throw new NotFoundException(`No task found holding waiting location ${waitingLocationId}`);
    }

    // Update task status to TRIGGERED
    await this.taskRepository.update(
      { task_id: currentTask.task_id },
      { status: TaskStatus.TRIGERRED }
    );

    // Process station requests for this waiting task
    await this.processWaitingLocationStationRequests(currentTask);

    return {
      message: `Waiting location ${waitingLocationId} triggered successfully`,
      triggered_task: {
        task_id: currentTask.task_id,
        batch_id: currentTask.batch_id,
        product_id: currentTask.product_id,
        previous_status: 'COMPLETED',
        new_status: 'TRIGGERED',
      },
      waiting_location: {
        location_id: waitingLocationId,
        status: waitingLocation.status,
        holded_by: waitingLocation.holded_by,
      },
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

  private async processWaitingLocationStationRequests(waitingTask: Task): Promise<void> {
    // Get station requests for this task
    const stationRequests = await this.stationRequestRepository.find({
      where: { task_id: waitingTask.task_id },
      order: { created_at: 'ASC' }
    });

    if (stationRequests.length === 0) {
      console.log(`No station requests found for waiting task ${waitingTask.task_id}`);
      return;
    }

    // Process each station request to see if any station is now available
    for (const request of stationRequests) {
      const station = await this.stationRepository.findOne({
        where: { station_id: request.station_id }
      });

      if (station && station.status === LocationStatus.AVAILABLE) {
        // Station is available - create task from waiting location to station
        console.log(`Station ${station.station_id} is available for waiting task ${waitingTask.task_id}`);
        
        // Reserve the station
        await this.stationRepository.update(
          { station_id: station.station_id },
          { 
            status: LocationStatus.RESERVED,
            holded_by: null // Will be set by the new task
          }
        );

        // Remove the station request
        await this.stationRequestRepository.remove(request);

        // Create task from waiting location to station
        await this.orchestratorService.processWaitingLocationToStation(waitingTask, station.station_id);
        
        break; // Only process one station at a time
      }
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
}
