import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { UpdateLocationDto } from './dto/update-location.dto';
import { In, Repository } from 'typeorm';
import { LocationEntity, LocationType } from 'src/entities/location.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { UpdateZoneDto } from './dto/update-zone.dto';
import { LocationManagerService } from '../tasks/location_manager.service';
import { LocationStatus } from 'src/entities/station.entity';

@Injectable()
export class LocationsService {

  constructor(
    readonly LocationManagerService: LocationManagerService,
    @InjectRepository(LocationEntity)
    private readonly locationRepository: Repository<LocationEntity>,
  ) {}

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

    if (body.is_waiting_area !== undefined) {
      // Ensure attributes array exists
      if (!Array.isArray(existing.attributes)) {
      existing.attributes = [] as any;
      }
      const attrs: any[] = existing.attributes as any[];
      const waitIdx = attrs.findIndex(a => a && a.attribute_name === 'is_waiting_area');

      if (body.is_waiting_area === false) {
      // remove the attribute entry entirely when explicitly false
      if (waitIdx >= 0) {
        attrs.splice(waitIdx, 1);
      }
      } else {
      const value = body.is_waiting_area === null ? null : body.is_waiting_area;
      if (waitIdx >= 0) {
        attrs[waitIdx].attribute_value = value;
      } else {
        attrs.push({ attribute_name: 'is_waiting_area', attribute_value: value });
      }
      }
      existing.attributes = attrs as any;
    }
    // Handle all_locations_directly_accessible attribute similar to is_waiting_area
    if (body.all_locations_directly_accessible !== undefined) {
      // Ensure attributes array exists
      if (!Array.isArray(existing.attributes)) {
        existing.attributes = [] as any;
      }
      const attrs: any[] = existing.attributes as any[];
      const idx = attrs.findIndex(
        a => a && a.attribute_name === 'all_locations_directly_accessible',
      );

      if (body.all_locations_directly_accessible === false) {
        // remove the attribute entry entirely when explicitly false
        if (idx >= 0) {
          attrs.splice(idx, 1);
        }
      } else {
        const value =
          body.all_locations_directly_accessible === null
            ? null
            : body.all_locations_directly_accessible;
        if (idx >= 0) {
          attrs[idx].attribute_value = value;
        } else {
          attrs.push({
            attribute_name: 'all_locations_directly_accessible',
            attribute_value: value,
          });
        }
      }
      existing.attributes = attrs as any;
    }
    if (updates.location_status &&  [LocationType.PALLET, LocationType.ENTRY].includes(existing.location_type) && updates.location_status !== existing.location_status) {
      if(updates.location_status === LocationStatus.AVAILABLE) {
        await this.LocationManagerService.updateLocationStatusInFMS(existing.location_id, "Empty")
      } else if (updates.location_status === LocationStatus.OCCUPIED) {
        await this.LocationManagerService.updateLocationStatusInFMS(existing.location_id, "Occupied")
      }
    }

    Object.assign(existing, updates);
    await this.locationRepository.save(existing);
    return existing;
  }

  async findByZone(zoneId: string) {
    // Return only actual locations that belong to the zone (exclude the zone record itself)
    return await this.locationRepository.find({ where: { parent_id: zoneId, location_type: In([LocationType.PALLET, LocationType.ENTRY]) }, order: { display_name: 'ASC' } });
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

    if (dto.is_waiting_area !== undefined) {
      // Ensure attributes array exists
      if (!Array.isArray(zone.attributes)) {
        zone.attributes = [] as any;
      }
      const attrs: any[] = zone.attributes as any[];
      const waitIdx = attrs.findIndex(a => a && a.attribute_name === 'is_waiting_area');

      if (waitIdx >= 0) {
        attrs[waitIdx].attribute_value = dto.is_waiting_area === null ? null : dto.is_waiting_area;
      } else {
        attrs.push({ attribute_name: 'is_waiting_area', attribute_value: dto.is_waiting_area === null ? null : dto.is_waiting_area });
      }
      zone.attributes = attrs as any;
      mutated = true;
    }

    if (dto.all_locations_directly_accessible !== undefined) {
      // Ensure attributes array exists
      if (!Array.isArray(zone.attributes)) {
        zone.attributes = [] as any;
      }
      const attrs: any[] = zone.attributes as any[];
      const idx = attrs.findIndex(a => a && a.attribute_name === 'all_locations_directly_accessible');

      if (idx >= 0) {
        attrs[idx].attribute_value = dto.all_locations_directly_accessible === null ? null : dto.all_locations_directly_accessible;
      } else {
        attrs.push({ attribute_name: 'all_locations_directly_accessible', attribute_value: dto.all_locations_directly_accessible === null ? null : dto.all_locations_directly_accessible });
      }
      zone.attributes = attrs as any;
      mutated = true;
    }

    if (!mutated) {
      throw new BadRequestException('No updatable fields provided (display_name or category or is_waiting_area or all_locations_directly_accessible).');
    }

    await this.locationRepository.save(zone);
    return zone;
  }
}
