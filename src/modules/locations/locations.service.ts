import { Inject, Injectable } from '@nestjs/common';
import { CreateLocationDto } from './dto/create-location.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { Repository, Not } from 'typeorm';
import { LocationEntity, LocationType } from 'src/entities/location.entity';
import { InjectRepository } from '@nestjs/typeorm';

@Injectable()
export class LocationsService {

  constructor(
    @InjectRepository(LocationEntity)
    private readonly locationRepository: Repository<LocationEntity>,
  ) {}

  create(createLocationDto: CreateLocationDto) {
    return 'This action adds a new location';
  }

  findAll() {
    return `This action returns all locations`;
  }

  findOne(id: number) {
    return `This action returns a #${id} location`;
  }

  update(id: number, updateLocationDto: UpdateLocationDto) {
    return `This action updates a #${id} location`;
  }

  remove(id: number) {
    return `This action removes a #${id} location`;
  }

  async findByZone(zoneId: string) {
    // Return only actual locations that belong to the zone (exclude the zone record itself)
    return await this.locationRepository.find({ where: { parent_id: zoneId, location_type: LocationType.PALLET } });
  }

  async findZones() {
    // Return locations that are defined as zones
    return await this.locationRepository.find({ where: { location_type: LocationType.ZONE } });
  }
}
