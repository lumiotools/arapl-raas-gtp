import { Injectable, ConflictException, NotFoundException, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { Station, LocationStatus } from '../../entities/station.entity';
import { Task, TaskStatus } from '../../entities/task.entity';
import { OrchestratorService } from '../orchestrator/orchestrator.service';
import { LoggingService } from '../../services/logging.service';
import { MessageCode } from './trigger.controller';

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
  ) {}

  async triggerStationAction(stationId: string, dropped_quantity: number, message_code: MessageCode) {
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

    // Find the task that is holding this station
    if (!station.holded_by) {
      throw new NotFoundException(`No task is currently holding station ${stationId}`);
    }
    // find the task that is holding the station
    const currentTask = await this.taskRepository.findOne({where: { task_id: station.holded_by },});
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
    await this.loggingService.log(`Station ${stationId} triggered - Task ${currentTask.task_id} status updated to TRIGGERED`);

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
