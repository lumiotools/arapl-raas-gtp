import { Injectable, NotFoundException } from '@nestjs/common';
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

  async update(id: any, updateLocationDto: UpdateLocationDto) {
    const locationId = String(id);
    const existing = await this.locationRepository.findOne({ where: { location_id: locationId } });
    if (!existing) {
      throw new NotFoundException(`Location with id ${locationId} not found`);
    }

    // Only allow updating these fields
    const updates: Partial<LocationEntity> = {};
    const body: any = updateLocationDto as any;
    if (body.display_name !== undefined) updates.display_name = body.display_name;
    if (body.pick_priority !== undefined) updates.pick_priority = body.pick_priority;
    if (body.drop_priority !== undefined) updates.drop_priority = body.drop_priority;
    if (body.location_status !== undefined) updates.location_status = body.location_status;

    Object.assign(existing, updates);
    await this.locationRepository.save(existing);
    return existing;
  }

  remove(id: number) {
    return `This action removes a #${id} location`;
  }

  async findByZone(zoneId: string) {
    // Return only actual locations that belong to the zone (exclude the zone record itself)
    return await this.locationRepository.find({ where: { parent_id: zoneId, location_type: LocationType.PALLET }, order: { display_name: 'ASC' } });
  }

  async findZones() {
    // Return locations that are defined as zones
    return await this.locationRepository.find({ where: { location_type: LocationType.ZONE }, order: { display_name: 'ASC' } });
  }
}
