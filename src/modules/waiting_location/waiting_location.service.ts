import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CreateWaitingLocationDto } from './dto/create-waiting_location.dto';
import { UpdateWaitingLocationDto } from './dto/update-waiting_location.dto';
import { WaitingLocation } from 'src/entities';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LocationStatus } from 'src/entities/station.entity';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class WaitingLocationService {
  httpService: any;
  constructor(
    @InjectRepository(WaitingLocation)
    private readonly waitingLocationRepository: Repository<WaitingLocation>,
  ){}
  async create(createWaitingLocationDto: CreateWaitingLocationDto) {
    throw new ConflictException('Waiting location creation is not allowed');
    // const existingWaitLocation = await this.waitingLocationRepository.findOne({
    //   where:{location_id: createWaitingLocationDto.location_id}
    // });
    // if (existingWaitLocation) {
    //   throw new ConflictException(`Waiting location with id ${createWaitingLocationDto.location_id} already exists`);
    // }
    // const newWaitingLocation = this.waitingLocationRepository.create(createWaitingLocationDto);
    // return this.waitingLocationRepository.save(newWaitingLocation);
  }

  async getAllWmsWaiting(){
    try{
      const warehouse_name = process.env.WMS_WAREHOUSE_NAME || 'warehouse';
      const warehosue_key = process.env.WMS_WAREHOUSE_AUTH_kEY || 'test';
      const wms_base_url = process.env.WMS_BASE_URL || 'http://localhost:3030/robot-job';  

      const response: {success:boolean, data: {bin_locations: {id:string, name:string}[]}[]} = await firstValueFrom(
        this.httpService.get(`${wms_base_url}/robot-job/${warehouse_name}/locations`, {
          headers: {
            'authorization': `${warehosue_key}`,
            'Content-Type': 'application/json'
          }
        })
      );
      if (response && response.data && Array.isArray(response.data)) {
        return response.data;
      }
      return [];
    }
    catch{
      return [];
    }
    
  }

  async findAll() {
    const waiting_object = (await this.getAllWmsWaiting())[0];
    const waiting_bin_locations = waiting_object.bin_locations || [];
    const bin_ids = waiting_bin_locations.map(bin => bin.id);
    const allWaitingLocations = await this.waitingLocationRepository.find();

    // find bin_ids that are not in allWaitingLocations
    const missingBinIds = bin_ids.filter(id => !allWaitingLocations.some(location => location.location_id === id));
    for (const missingId of missingBinIds) {
      const newWaitingLocation = this.waitingLocationRepository.create({
        location_id: missingId,
        location_name: waiting_bin_locations.find(bin => bin.id === missingId)?.name || 'Unknown'
      });
      await this.waitingLocationRepository.save(newWaitingLocation);
    }
    // find allWaitingLocations ids that are not in bin_ids
    const existingWaitingLocationIds = allWaitingLocations.map(location => location.location_id);
    const missingWaitingLocationIds = existingWaitingLocationIds.filter(id => !bin_ids.includes(id));
    if (missingWaitingLocationIds.length > 0) {
      await this.waitingLocationRepository.delete(missingWaitingLocationIds);
    }
    return await this.waitingLocationRepository.find();
  }

  async findOne(id: string) {
    const waiting_object = await this.getAllWmsWaiting()[0];
    const bin_locations = waiting_object.bin_locations || [];
    const binLocation = bin_locations.find((bin: { id: string }) => bin.id === id);
    if (!binLocation) {
      const existing = await this.waitingLocationRepository.findOne({ where: { location_id: id } });
      if (existing) {
        this.waitingLocationRepository.delete({ location_id: id });
      }
      throw new NotFoundException(`Waiting location with id ${id} not found in WMS bin locations`);
    }
    const bin_name = binLocation.bin_name;
    let waitingLocation = await this.waitingLocationRepository.findOne({
      where: { location_id: id }
    });
    if (!waitingLocation) {
      // Create new waiting location if not exists
      waitingLocation = this.waitingLocationRepository.create({
        location_id: id,
        location_name: bin_name
      });
      waitingLocation = await this.waitingLocationRepository.save(waitingLocation);
    }
    return waitingLocation;
  }

  async update(id: string, updateWaitingLocationDto: UpdateWaitingLocationDto) {
    if (id !== updateWaitingLocationDto.location_id) {
      throw new ConflictException(`ID update is not allowed`);
    }
    const existing = await this.waitingLocationRepository.findOne({ where: { location_id: id } });
    if (!existing) {
      throw new Error(`Waiting location with id ${id} not found`);
    }
    if (existing.location_id !== updateWaitingLocationDto.location_id) {
      throw new ConflictException(`Cannot change location_id of waiting location ${id}`);
    }
    if (existing.holded_by) {
      throw new ConflictException(`Cannot update waiting location ${id}. Some robot is holding it.`);
    }
    if (existing.status !== 'AVAILABLE') {
      throw new ConflictException(`Cannot update waiting location ${id} as it is not in AVAILABLE status`);
    }
    await this.waitingLocationRepository.update({ location_id: id }, updateWaitingLocationDto);
    return await this.waitingLocationRepository.findOne({ where: { location_id: id } });
  }

  async remove(id: string) {
    throw new ConflictException('Waiting location removal is not allowed');
    // const existing = await this.waitingLocationRepository.findOne({ where: { location_id: id } });
    // if (!existing) {
    //   throw new Error(`Waiting location with id ${id} not found`);
    // }
    // if (existing.holded_by){
    //   throw new ConflictException(`Cannot delete waiting location ${id}. Some robot is holding it.`);
    // }
    // await this.waitingLocationRepository.delete({ location_id: id });
    // return { message: `Waiting location with id ${id} deleted successfully` };
  }

  async reserveWaitingLocation(location_id: string): Promise<boolean> {
      const queryRunner = this.waitingLocationRepository.manager.connection.createQueryRunner();
      await queryRunner.connect();
      await queryRunner.startTransaction();
  
      try {
        const waitingLocation = await queryRunner.manager.findOne(WaitingLocation, { where: { location_id: location_id } });

        if (!waitingLocation) {
          return false;
        }

        if (waitingLocation.status !== LocationStatus.AVAILABLE) {
          return false;
        }

        waitingLocation.status = LocationStatus.RESERVED;
        await queryRunner.manager.save(WaitingLocation, waitingLocation);

        await queryRunner.commitTransaction();
  
        // Return the updated inventory (with isProcessing = true)
        return true;
      } catch (error) {
        await queryRunner.rollbackTransaction();
        return false;
      } finally {
        await queryRunner.release();
      }
    }
}
