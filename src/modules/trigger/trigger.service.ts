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

  async triggerStationAction(stationId: string, message_code: MessageCode, robotId?: string) {
    // Find the station from the station ID
    const station = await this.stationRepository.findOne({where: { station_id: stationId },});
    if (!station) {
      throw new NotFoundException(`Station with ID ${stationId} not found`);
    }

    // Check if station is OCCUPIED (not RESERVED)
    // if (station.status !== LocationStatus.OCCUPIED) {
    //   if (station.status === LocationStatus.RESERVED) {
    //     throw new ConflictException(`Can't trigger now - station ${stationId} is reserved`);
    //   }
    //   throw new ConflictException(`Can't trigger - station ${stationId} is not occupied (current status: ${station.status})`);
    // }

    const activities = await this.stationService.getActiveRobotAtStation(stationId);
    for (const activity of activities){
      const robot_id = activity?.robot_id || null;
      if (!robot_id) {
        continue;
      }
      if (robot_id !== robotId) {
        continue;
      }
      // Find the current task holding this station
      const currentTask = await this.taskRepository.findOne({
        where: {
          robot_id: robot_id, 
        },
        order: { created_at: 'DESC' }
      });
      if (!currentTask) {continue;}

      
      currentTask.triggered = new Date();
      currentTask.status = TaskStatus.TRIGERRED;
      await this.taskRepository.save(currentTask);

      await this.loggingService.log(`Station ${stationId} Completed - Task ${currentTask.task_id} status updated to TRIGGERED`,
        currentTask.task_type, currentTask.task_id, null
      );

      await this.orchestratorService.handleTaskCompletion(currentTask, message_code);
    }

    return {
      message: `Station ${stationId} triggered successfully`,
      station: {
        station_id: stationId,
        status: station.status, // Station status remains the same until webhook processes next task
        holded_by: station.holded_by,
      },
      next_task_scheduled: true,
      timestamp: new Date(),
    };
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
}
