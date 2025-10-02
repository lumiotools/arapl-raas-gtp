import { Injectable } from '@nestjs/common';
import { CreateSettingDto } from './dto/create-setting.dto';
import { UpdateSettingDto } from './dto/update-setting.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Settings } from 'src/entities/settings.entity';
import { Repository } from 'typeorm';
import { firstValueFrom } from 'rxjs';
import { HttpService } from '@nestjs/axios';
import { TaskType } from 'src/entities';

@Injectable()
export class SettingsService {
  constructor(
    private readonly httpService: HttpService,
    @InjectRepository(Settings)
    private settingsRepository: Repository<Settings>,
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

  async makeRobotOffline(robotId: string) {
    const warehouse_name = process.env.WMS_WAREHOUSE_NAME || 'warehouse';
    const warehouse_key = process.env.WMS_WAREHOUSE_AUTH_KEY || 'test';
    const wms_base_url = process.env.WMS_BASE_URL || 'http://localhost:3030';

    const url = `${wms_base_url}/robot-job/${warehouse_name}/update-robot`;
    const reqBody = {
      robot_id: robotId
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
