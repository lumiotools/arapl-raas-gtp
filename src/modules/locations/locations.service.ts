import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { CreateLocationDto } from './dto/create-location.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { Repository, Not } from 'typeorm';
import { LocationEntity, LocationType } from 'src/entities/location.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { UpdateZoneDto } from './dto/update-zone.dto';

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

  async updateZone(zoneId: string, dto: UpdateZoneDto) {
    const zone = await this.locationRepository.findOne({ where: { location_id: zoneId, location_type: LocationType.ZONE } });
    if (!zone) {
      throw new NotFoundException(`Zone with id ${zoneId} not found`);
    }

    let mutated = false;

    if (dto.display_name !== undefined) {
      zone.display_name = dto.display_name;
      mutated = true;
    }

    if (dto.category !== undefined) {
      // Ensure attributes array exists
      if (!Array.isArray(zone.attributes)) {
        zone.attributes = [] as any;
      }
      const attrs: any[] = zone.attributes as any[];
      const catIdx = attrs.findIndex(a => a && a.attribute_name === 'Category');
      if (catIdx >= 0) {
        attrs[catIdx].attribute_value = dto.category === '' ? null : dto.category; // treat empty string as clearing
      } else {
        attrs.push({ attribute_name: 'Category', attribute_value: dto.category === '' ? null : dto.category });
      }
      zone.attributes = attrs as any;
      mutated = true;
    }

    if (!mutated) {
      throw new BadRequestException('No updatable fields provided (display_name or category).');
    }

    await this.locationRepository.save(zone);
    return zone;
  }
}
