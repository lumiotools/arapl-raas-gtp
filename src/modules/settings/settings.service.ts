import { Inject, Injectable } from '@nestjs/common';
import { CreateSettingDto } from './dto/create-setting.dto';
import { UpdateSettingDto } from './dto/update-setting.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Settings } from 'src/entities/settings.entity';
import { Repository } from 'typeorm';
import { firstValueFrom } from 'rxjs';
import { HttpService } from '@nestjs/axios';
import { LocationAction, Task, TaskStatus, TaskType } from 'src/entities';
import { MOVE_TYPE } from 'src/entities/task.entity';
import { isIn } from 'class-validator';

@Injectable()
export class SettingsService {
  constructor(
    private readonly httpService: HttpService,
    @InjectRepository(Settings)
    private settingsRepository: Repository<Settings>,
    @InjectRepository(Task)
    private taskRepository: Repository<Task>,
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

  update(id: number, updateSettingDto: UpdateSettingDto) {
    return `This action updates a #${id} setting`;
  }

  remove(id: number) {
    return `This action removes a #${id} setting`;
  }

  async findAllRobots(task_type: TaskType) {
    try {
      
      const warehouse_name = process.env.WMS_WAREHOUSE_NAME || 'warehouse';
      const warehouse_key = process.env.WMS_WAREHOUSE_AUTH_KEY || 'test'; // Fixed typo
      const wms_base_url = process.env.WMS_BASE_URL || 'http://localhost:3030';

      console.log(`TASK TYPE: ${task_type['task_type']}`);
      console.log(`${TaskType.GOODS_TO_PERSON === "GoodsToPerson"}`);

      const url = `${wms_base_url}/robot-job/${warehouse_name}/all-robots?task_type=${task_type['task_type'] === TaskType.GOODS_TO_PERSON ? "GOODSTOPERSON" : "BASEOPS"}`;
      console.log(`url: ${url}`);

      const response:any = await firstValueFrom(
        this.httpService.get(url, {
          headers: {
            'authorization': warehouse_key, // Fixed typo
            'Content-Type': 'application/json'
          }
        })
      );
      
      return response.data;
      
    } catch (error) {
      
      throw new Error(`Failed to fetch robots from WMS: ${error.message}`);
    }
  }

  async getAllRobots(task_type: TaskType){
  
    try {
      const robots = (await this.findAllRobots(task_type)).robots;
      if (robots.length === 0) {
        return [];
      }
      const res: any[] = [];
      for (const robot of robots){
        if (robot.is_active == false){
          res.push({
            'id': robot.id,
            'status': 'inactive',
            'travel_status': 'INACTIVE',
            'in_use': false,
            'current_status_time': robot.current_status_time,
            'reason': robot.message_code ? robot.message_code : null
          })
          continue;
        }
        const task = await this.taskRepository.findOne({
          where: { robot_id: robot.id },
          order: { created_at: 'DESC' }
        });
        if (!task){
          res.push({
            'id': robot.id,
            'status': 'idle',
            'travel_status': 'NO TASK ASSIGNED',
            'in_use': false,
            'current_status_time': robot.current_status_time,
            'reason': robot.message_code ? robot.message_code : null
          })
          continue;
        }
        const isInUse = task.status === TaskStatus.PROCESSING ? true : (task.status === TaskStatus.COMPLETED && task.end_location.location_action===LocationAction.DROP ? false : true);
        let current_status_time = robot.current_status_time ?? 0;
        if (isInUse){
          const firstTask = await this.taskRepository.findOne({ where: { batch_id: task.batch_id, sequence_order: 1 } });
          const createdAt = firstTask?.created_at;
          if (createdAt) {
            current_status_time = (Date.now() - new Date(createdAt).getTime()) / 1000;
          }
        }
        res.push({
          'id': robot.id,
          'status': task ? (task.status === TaskStatus.PROCESSING ? 'working' : (task.status === TaskStatus.PENDING ? 'idle' : 'idle')) : 'idle',
          'travel_status': task ? (task.status === TaskStatus.PROCESSING ? `MOVING TO ${task.end_location.location_id}` :(task.status === TaskStatus.COMPLETED ? `REACHED ${task.end_location.location_id}` : `IDLE`)) : 'IDLE',
          'in_use': isInUse,
          'current_status_time': current_status_time,
        });
      }
      return res;
    }
    catch{
      // pass
    }
    const moving_tasks = await this.taskRepository.find({
      where: { status: TaskStatus.PROCESSING, task_type: task_type['task_type'] }
    });
    const res : any[] = [];
    // keep a set of all the robot IDs used in moving_tasks
    let current_status_time = 0;
    const uniqueRobotIds = new Set<string>();
    for(const task of moving_tasks){
      const firstTask = await this.taskRepository.findOne({ where: { batch_id: task.batch_id, sequence_order: 1 } });
      const createdAt = firstTask?.created_at;
      if (createdAt) {
        current_status_time = (Date.now() - new Date(createdAt).getTime()) / 1000;
      }
      res.push({
        'id': task.robot_id,
        'status': 'working',
        'travel_status': `MOVING TO ${task.end_location.location_id}`,
        'in_use': true,
        'current_status_time': current_status_time
      })
      uniqueRobotIds.add(task.robot_id);
    }
    const station_robots = await this.taskRepository.find({
      where: {status: TaskStatus.COMPLETED, task_type: task_type['task_type']
    },
    order: { updated_at: 'DESC' }
    })
    for (const task of station_robots){
      if (uniqueRobotIds.has(task.robot_id)) continue;
      uniqueRobotIds.add(task.robot_id);
      let current_status_time = 0;
      const firstTask = await this.taskRepository.findOne({ where: { batch_id: task.batch_id, sequence_order: 1 } });
      const createdAt = firstTask?.created_at;
      if (createdAt) {
        current_status_time = (Date.now() - new Date(createdAt).getTime()) / 1000;
      }
      if ([MOVE_TYPE.INVENTORY_TO_STATION, MOVE_TYPE.STATION_TO_STATION, MOVE_TYPE.WAITING_LOCATION_TO_STATION,
        MOVE_TYPE.INVENTORY_TO_WAITING_LOCATION, MOVE_TYPE.STATION_TO_WAITING_LOCATION
      ].includes(task.move_type)){
        res.push({
          'id': task.robot_id,
          'status': 'working',
          'travel_status': `REACHED ${task.end_location.location_id}`,
          'in_use': task.end_location.location_action===LocationAction.DROP ? false : true,
          'current_status_time': current_status_time
        });
      }
    }
    return res;
  }

  async updateRobot(robotId: string, message_code: 'maintenance' | 'charging' | 'error' | null) {
    const warehouse_name = process.env.WMS_WAREHOUSE_NAME || 'warehouse';
    const warehouse_key = process.env.WMS_WAREHOUSE_AUTH_KEY || 'test';
    const wms_base_url = process.env.WMS_BASE_URL || 'http://localhost:3030';

    const url = `${wms_base_url}/robot-job/${warehouse_name}/update-robot`;
    const reqBody = {
      robot_id: robotId,
      message_code: message_code
    }
    try {
      const response: any = await firstValueFrom(
        this.httpService.patch(url, reqBody, {
          headers: {
            'authorization': warehouse_key,
            'Content-Type': 'application/json'
          }
        })
      );
      return response.data;
    } catch (error) {
      throw new Error(`Failed to make robot offline: ${error.message}`);
    }
  }
}
