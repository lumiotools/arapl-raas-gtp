import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { CreateEmptyLocationDto } from './dto/create-empty_location.dto';
import { UpdateEmptyLocationDto } from './dto/update-empty_location.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { empty } from 'rxjs';
import { Repository } from 'typeorm';
import { EmptyLocation } from 'src/entities/empty-location.entity';

@Injectable()
export class EmptyLocationsService {
  constructor(
    @InjectRepository(EmptyLocation)
    private readonly emptyLocationRepository: Repository<EmptyLocation>,
  ) {}
  async create(createEmptyLocationDto: {location_id: string, location_name: string, is_active: boolean, priority: number}) {
    // throw new ConflictException('Waiting location creation is not allowed');
    const existingWaitLocation = await this.emptyLocationRepository.findOne({
      where:{location_id: createEmptyLocationDto.location_id}
    });
    console.log(`existingWaitLocation: ${JSON.stringify(existingWaitLocation)}`);
    if (existingWaitLocation) {
      throw new ConflictException(`Waiting location with id ${createEmptyLocationDto.location_id} already exists`);
    }
    const newWaitingLocation = this.emptyLocationRepository.create(createEmptyLocationDto);
    return this.emptyLocationRepository.save(newWaitingLocation);
  }

  async getAllWmsEmtpy(){
    try{
      const warehouse_name = process.env.WMS_WAREHOUSE_NAME || 'warehouse';
      const warehosue_key = process.env.WMS_WAREHOUSE_AUTH_KEY || 'test';
      const wms_base_url = process.env.WMS_BASE_URL || 'http://localhost:3030/robot-job';
      console.log(`Fetching WMS locations from ${wms_base_url}`);
      const response = await fetch(`${wms_base_url}/robot-job/${warehouse_name}/locations?location_zone=empty&location_type=empty`, {
        method: 'GET',
        headers: {
          'authorization': `${warehosue_key}`,
          'Content-Type': 'application/json'
        }
      });
      const data = await response.json();
      console.log(`response: ${JSON.stringify(data)}`);
      return data;
    }catch{
      throw new BadRequestException('Failed to fetch WMS stations');
    }
  }

  async findAll() {
    const empty_object = (await this.getAllWmsEmtpy());
    const empty_bin_locations = empty_object.available_location_types || [];
    const bin_ids = empty_bin_locations.map(bin => bin.location_id);
    const allEmptyLocations = await this.emptyLocationRepository.find();

    // find bin_ids that are not in allEmptyLocations
    const missingBinIds = bin_ids.filter(id => !allEmptyLocations.some(location => location.location_id === id));
    let priority = 1;
    for (const missingId of missingBinIds) {
      await this.create({
        location_id: missingId,
        location_name: missingId,
        is_active: true,
        priority: priority++
      });
    }
    // find allEmptyLocations ids that are not in bin_ids
    const existingEmptyLocationIds = allEmptyLocations.map(location => location.location_id);
    const missingEmptyLocationIds = existingEmptyLocationIds.filter(id => !bin_ids.includes(id));
    if (missingEmptyLocationIds.length > 0) {
      // await this.waitingLocationRepository.delete(missingWaitingLocationIds);
      for (const id of missingEmptyLocationIds) {
        // await this.remove(id);
        this.emptyLocationRepository.update(
          { location_id: id },
          { is_active: false }
        );
      }
    }

    // find intersecting location IDs
      const intersectingLocationIds = bin_ids.filter(id => existingEmptyLocationIds.includes(id));
      for (const id of intersectingLocationIds) {
        const emptyLocation = allEmptyLocations.filter(location => location.location_id === id)[0];
        if (emptyLocation.is_active === false) {
          await this.emptyLocationRepository.update(
            { location_id: id },
            { is_active: true }
          );
        }
      }
    return await this.emptyLocationRepository.find();
  }

  async findOne(id: string) {
    return await this.emptyLocationRepository.findOne({ where: { location_id: id } });
  }

  update(id: number, updateEmptyLocationDto: UpdateEmptyLocationDto) {
    return `This action updates a #${id} emptyLocation`;
  }

  remove(id: number) {
    return `This action removes a #${id} emptyLocation`;
  }
}
