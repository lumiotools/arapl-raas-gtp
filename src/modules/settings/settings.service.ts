import { Inject, Injectable } from '@nestjs/common';
import { CreateSettingDto } from './dto/create-setting.dto';
import { UpdateSettingDto } from './dto/update-setting.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Settings } from 'src/entities/settings.entity';
import { In, Repository } from 'typeorm';
import { firstValueFrom } from 'rxjs';
import { HttpService } from '@nestjs/axios';
import { Inventory, LocationAction, RobotCount, Station, Task, TaskStatus, TaskType, WaitingLocation } from 'src/entities';
import { MOVE_TYPE } from 'src/entities/task.entity';
import { isIn } from 'class-validator';
import { Robot, RobotStatus } from 'src/entities/robots.entity';
import { LoggingService } from 'src/services/logging.service';
import { OperationType } from 'src/entities/robot-count.entity';
import { EmptyLocation } from 'src/entities/empty-location.entity';

@Injectable()
export class SettingsService {
  constructor(
    private readonly httpService: HttpService,
    @InjectRepository(Settings)
    private settingsRepository: Repository<Settings>,
    @InjectRepository(Task)
    private taskRepository: Repository<Task>,
    @InjectRepository(Robot)
    private robotRepository: Repository<Robot>,
    @InjectRepository(RobotCount)
    private robotCountRepository: Repository<RobotCount>,
    @InjectRepository(Station)
    private stationsRepository: Repository<Station>,
    @InjectRepository(Inventory)
    private inventoryRepository: Repository<Inventory>,
    @InjectRepository(EmptyLocation)
    private emptyLocationRepository: Repository<EmptyLocation>,
    @InjectRepository(WaitingLocation)
    private waitingLocationRepository: Repository<WaitingLocation>,
    private readonly loggingService: LoggingService,
  ){}
  create(createSettingDto: CreateSettingDto) {
    return 'This action adds a new setting';
  }

  async findAll() {
    return await this.settingsRepository.find();
  }

  async findOne(id: number) {
    return `This action returns a #${id} setting`;
  }

  remove(id: number) {
    return `This action removes a #${id} setting`;
  }

  public async getAllRobots(task_type: TaskType) {
    const robots = await this.robotRepository.find({
      where: { task_type: task_type },
    });
    const res: any[] = [];
    if (robots.length === 0) {
      return res;
    }
    for (const robot of robots) {
      let robot_task: Task | null = null;
      if (robot.status === RobotStatus.INUSE){
        robot_task = await this.taskRepository.findOne({
          where: { robot_id: robot.robot_id, status: In([TaskStatus.PROCESSING, TaskStatus.IN_PROGRESS, TaskStatus.COMPLETED]) },
          order: { created_at: 'DESC' }
        });
      }
      let end_location:any = null;
      const destination_type: string | undefined = robot_task?.end_location.location_attribute?.attribute_value;
      if (robot_task && destination_type && destination_type === 'station'){
        end_location = await this.stationsRepository.findOne({
          where: { station_id : robot_task.end_location.location_id },
        });
      } else if (robot_task && destination_type && (destination_type === 'inventory' || destination_type === 'quarantine')){
        end_location = await this.inventoryRepository.findOne({
          where: { id : robot_task.end_location.location_id },
        });
      } else if (robot_task && destination_type && destination_type === 'empty_location'){
        end_location = await this.emptyLocationRepository.findOne({
          where: { location_id : robot_task.end_location.location_id },
        });
      } else if (robot_task && destination_type && destination_type === 'waiting_location'){
        end_location = await this.waitingLocationRepository.findOne({
          where: { location_id : robot_task.end_location.location_id },
        });
      }
      let travel_status =  robot_task ? ((robot_task.status === TaskStatus.PROCESSING || robot_task.status === TaskStatus.INQUEUE) ? `MOVING TO ${end_location.location_name}` : (robot_task.status === TaskStatus.COMPLETED ? `REACHED ${end_location.location_name}` : `ERROR`)) : (robot.status === RobotStatus.ONLINE ? '-' : 'INACTIVE');
      res.push({
        'id': robot.robot_id,
        'robot_name': robot.robot_name || robot.robot_id,
        'status': robot.status,
        'travel_status': travel_status,
        'current_status_time': robot.updated_at ? (Date.now() - new Date(robot.updated_at).getTime()) / 1000 : 0,
        'reason': robot.message_code ? robot.message_code : null,
        'is_paused': robot_task ? robot_task.is_paused : false,
      });
    }
    return res;
  }
  async updateRobot(robotId: string, status: RobotStatus, reason: string|null) {
    try{
      const robot = await this.robotRepository.findOne({ where: { robot_id: robotId } });
      if (!robot) {
        throw new Error(`Robot with ID ${robotId} not found`);
      }
      if (!robot.logs){
        robot.logs = [];
      }
      console.log(`reason: ${reason}`);
      robot.logs.push({
        timestamp: new Date(),
        previous_status: robot.status,
        new_status: status,
        reason: reason,
      });
      robot.status = status;
      robot.message_code = reason;
      
      await this.robotRepository.save(robot);
      await this.loggingService.log(`Robot ${robotId} is now ${robot.status}`, robot.task_type, null, null);
      return { message: `Robot ${robotId} is now ${robot.status}` };
    } catch (error) {
      throw new Error(`Failed to update robot: ${error.message}`);
    }
  }

  async getAllRobotsInUse(task_type: TaskType) {
    const operationType = task_type['task_type'] === TaskType.BASEOPS ? OperationType.BASEOPS : OperationType.FLOWOPS;
    const robots = await this.robotCountRepository.find({
      where: { operation_type: operationType },
    });
    return {
      "total_robots": robots.length > 0 ? robots[0].total_robots : 0,
      "robot_in_use": robots.length > 0 ? robots[0].robot_in_use : 0,
      "is_waiting": robots.length > 0 ? robots[0].is_waiting : false,
    };
  }

  async updateAutoStart(auto_start: number) {
    const setting = await this.settingsRepository.findOne({
      where: {operation_type: OperationType.FLOWOPS}
    });
    if (setting) {
      setting.value['AUTO_START'] = auto_start;
      await this.settingsRepository.save(setting);
      return { message: `AUTO_START updated to ${auto_start}` };
    } else {
      throw new Error('FLOWOPS settings not found');
    }
  }

  async updateTaskAllocationStrategy(task_allocation_strategy: string) {
    const setting = await this.settingsRepository.findOne({
      where: {operation_type: OperationType.FLOWOPS}
    });
    if (setting) {
      setting.value['TASK_ALLOCATION_STRATEGY'] = task_allocation_strategy;
      await this.settingsRepository.save(setting);
      return { message: `TASK_ALLOCATION_STRATEGY updated to ${task_allocation_strategy}` };
    } else {
      throw new Error('FLOWOPS settings not found');
    }
  }
}