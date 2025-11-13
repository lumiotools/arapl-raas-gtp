import { Injectable, ConflictException, NotFoundException, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { Station, LocationStatus } from '../../entities/station.entity';
import { Task, TaskStatus } from '../../entities/task.entity';
import { OrchestratorService } from '../orchestrator/orchestrator.service';
import { LoggingService } from '../../services/logging.service';
import { MessageCode } from './trigger.controller';
import { StationsService } from '../stations/stations.service';

@Injectable()
export class TriggerService {
  constructor(
    @InjectRepository(Station)
    private readonly stationRepository: Repository<Station>,
    @InjectRepository(Task)
    private readonly taskRepository: Repository<Task>,

    @Inject(forwardRef(() => OrchestratorService))
    private readonly orchestratorService: OrchestratorService,
    private readonly loggingService: LoggingService,
    private readonly httpService: HttpService,
    private readonly stationService: StationsService,
  ) {}

  async triggerStationAction(stationId: string, message_code: MessageCode) {
    // Find the station from the station ID
    const station = await this.stationRepository.findOne({where: { station_id: stationId },});
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

    const activity = await this.stationService.getActiveRobotAtStation(stationId);
    const robot_id = activity?.robot_id || null;
    if (!robot_id) {
      throw new ConflictException(`No robot found at occupied station ${stationId}`);
    }
    // Find the current task holding this station
    const currentTask = await this.taskRepository.findOne({
      where: {
        robot_id: robot_id, 
      },
      order: { created_at: 'DESC' }
    });
    if (!currentTask) {throw new NotFoundException(`No task found holding station ${stationId}`);}

    // check if task is already triggered.
    if (currentTask && currentTask.status === TaskStatus.TRIGERRED) {
      throw new ConflictException(`Task ${currentTask.task_id} is already triggered`);
    }
    // Update task status to TRIGGERED
    await this.taskRepository.update(
      { task_id: currentTask.task_id },
      { 
        status: TaskStatus.TRIGERRED,
        triggered: new Date(),
      }
    );
    currentTask.triggered = currentTask.triggered || new Date();
    currentTask.status = TaskStatus.TRIGERRED;

    // Log trigger action
    await this.loggingService.log(`Station ${stationId} Completed - Task ${currentTask.task_id} status updated to TRIGGERED`,
      currentTask.task_type, currentTask.task_id, null
    );

    await this.processNextTask(currentTask, message_code);

    // Free the robot holding this station
    // if (currentTask.robot_id) {
    //   await this.freeRobot(currentTask.robot_id);
    // }

    return {
      message: `Station ${stationId} triggered successfully`,
      triggered_task: {
        task_id: currentTask.task_id,
        batch_id: currentTask.batch_id,
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

  private async processNextTask(completedTask: Task, message_code: MessageCode): Promise<void> {
    try {
      // Check if the completed task was at a station and handle station workflow
      if (completedTask.end_location?.location_attribute?.attribute_value === 'station') {
        await this.orchestratorService.handleTaskCompletion(completedTask, message_code);
        return;
      }
    } catch (error) {
      console.error(`Error processing next task for ${completedTask.task_id}:`, error.message);
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
        station_name: station.location_name,
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

  // Method to free robot by calling the external endpoint
//   private async freeRobot(robotId: string): Promise<void> {
//     if (!robotId) {
//       // await this.loggingService.log('Cannot free robot: robot_id is null or empty');
//       return;
//     }
//     try {
//       const response = await this.httpService.post(`${process.env.WMS_BASE_URL}/orchestrator/robot/set-available`, {
//         robot_id: robotId
//       }).toPromise();

//       if (response && response.data) {
//         // await this.loggingService.log(`Robot ${robotId} freed successfully: ${response.data.message || 'Robot set to available'}`);
//       } else {
//         // await this.loggingService.log(`Robot ${robotId} freed successfully`);
//       }
//     } catch (error) {
//       // await this.loggingService.log(`Failed to free robot ${robotId}: ${error.message}`);
//       // Don't throw error to avoid breaking the main process
//     }
//   }
}
