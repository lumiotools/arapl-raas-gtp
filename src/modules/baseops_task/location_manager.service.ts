import { BadRequestException, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Task, TaskStatus } from "src/entities";
import { LocationEntity, LocationType } from "src/entities/location.entity";
import { LocationStatus } from "src/entities/station.entity";
import { In, Repository } from "typeorm";

@Injectable()
export class BaseOpsLocationManagerService {
    constructor(
        @InjectRepository(LocationEntity)
        private locationRepository: Repository<LocationEntity>,
        @InjectRepository(Task)
        private taskRepository: Repository<Task>,
    ) {}

    async reserveLocation(display_name: string): Promise<boolean> {
        const queryRunner = this.locationRepository.manager.connection.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            // Single atomic operation: Update only if location_status is AVAILABLE
            const result = await queryRunner.manager
                .createQueryBuilder()
                .update(LocationEntity)
                .set({ location_status: LocationStatus.RESERVED })  // ✅ Fixed: use location_status
                .where("display_name = :display_name AND location_status = :status", {  // ✅ Fixed: use location_status
                    display_name: display_name,
                    status: LocationStatus.AVAILABLE
                })
                .execute();

            // If no rows were affected, location was either not found or not available
            if (result.affected === 0) {
                await queryRunner.rollbackTransaction();
                return false;
            }

            await queryRunner.commitTransaction();
            return true;

        } catch (error) {
            await queryRunner.rollbackTransaction();
            return false;
        } finally {
            await queryRunner.release();
        }
    }

    async findOptimalDropLocation(zone_id: string): Promise<string | null> {
        const zone = await this.locationRepository.findOne({ where: { display_name: zone_id, location_type: LocationType.ZONE } });
        if (!zone) {
            console.log(`Zone with ID ${zone_id} not found.`);
            return null;
        }
        const locations = await this.locationRepository.find({
            where: { parent_id: zone.location_id, location_status: LocationStatus.AVAILABLE, location_type: LocationType.PALLET },
            order: { drop_priority: "ASC" }
        });
        if (locations.length === 0){return null;}
        // fetch the location from the locations with smallest (highest priority) drop_priority

        const optimalLocation = locations.find(loc => loc.drop_priority !== null);
        if (optimalLocation) {
            return optimalLocation.display_name;
        }
        const validLocations = locations.filter(loc => 
            loc.row != null && loc.column != null
        );
        if (!validLocations.length) return null;

        return validLocations.reduce((min, current) => {
            if (current.row < min.row || 
            (current.row === min.row && current.column < min.column)) {
            return current;
            }
            return min;
        }).display_name;
    }

    async freeLocation(display_name: string): Promise<void> {
        await this.locationRepository.update({ display_name }, { location_status: LocationStatus.AVAILABLE });
    }

    async occupyLocation(display_name: string): Promise<void> {
        await this.locationRepository.update({ display_name }, { location_status: LocationStatus.OCCUPIED });
    }

    async isValidLocationId(location_id: string, isStart: boolean): Promise<boolean> {
        const location = await this.locationRepository.findOne({ where: { display_name: location_id, location_status: isStart ? In([LocationStatus.OCCUPIED, LocationStatus.AVAILABLE]) : LocationStatus.AVAILABLE, location_type: LocationType.PALLET } });
        console.log(`Checking location ID: ${location_id}, Found: ${location ? 'Yes' : 'No'}`);
        if (!location) {
            return false;
        }
        return true;
    }

    async otherTaskWithStartLocation(location_id: string): Promise<string | null> {
        // fetch all tasks in PENDING and ASSIGNED status
        const tasks = await this.taskRepository.find({
            where: { status: In([TaskStatus.PENDING, TaskStatus.ASSIGNED]) }
        });
        for (const task of tasks) {
            if (task.start_location && task.start_location.location_id === location_id) {
                return task.task_id;
            }
        }
        return null;
    }

    async otherTaskWithEndLocation(location_id: string): Promise<string | null> {
        // fetch all tasks in PENDING and ASSIGNED status
        const tasks = await this.taskRepository.find({
            where: { status: In([TaskStatus.PENDING, TaskStatus.ASSIGNED]) }
        });
        for (const task of tasks) {
            if (task.end_location && task.end_location.location_id === location_id) {
                return task.task_id;
            }
        }
        return null;
    }

    async getManualTaskStartLocation(){
        const startLocation = await this.locationRepository.find({ where: { location_type: LocationType.PALLET, location_status: In([LocationStatus.AVAILABLE, LocationStatus.OCCUPIED])},
            relations: ['parent']
        });
        return startLocation;
    }

    async getManualTaskEndLocation(){
        const endLocation = await this.locationRepository.find({ where: { location_type: LocationType.PALLET, location_status: LocationStatus.AVAILABLE }, relations: ['parent'] });
        return endLocation;
    }

    async syncFMSLocations() {
        console.log("Starting FMS location sync...");
        const fmsLocations = await this.fetchFMSLocations();
        console.log("Fetched FMS locations");

        const zoneIds = Object.keys(fmsLocations);
        const fmsZoneIds = new Set(zoneIds);

        for (const zoneId of zoneIds) {
            const locations = Array.isArray(fmsLocations[zoneId]) ? fmsLocations[zoneId] : [];
            console.log(`Syncing zone ${zoneId} with ${locations.length} locations`);

            // Upsert zone
            const zoneRecord = this.locationRepository.create({
                location_id: zoneId,
                display_name: zoneId,
                location_type: LocationType.ZONE,
            });
            await this.locationRepository.save(zoneRecord);

            // Load existing pallet locations under this zone for cleanup
            const existing = await this.locationRepository.find({
                where: { parent_id: zoneId, location_type: LocationType.PALLET },
            });
            const existingById = new Map(existing.map(e => [e.location_id, e] as const));
            const seenIds = new Set<string>();

            // Determine fallback counters from existing data
            const maxExistingRow = existing.reduce((m, e) => Math.max(m, e.row ?? 0), 0);
            const maxExistingPick = existing.reduce((m, e) => Math.max(m, e.pick_priority ?? 0), 0);
            let nextRow = maxExistingRow + 1;
            let nextPick = maxExistingPick + 1;
            const baselineTotal = Math.max(1, existing.length + locations.length);

            for (const l of locations) {
                const id = String(l.location_id).trim();
                if (!id) continue;
                seenIds.add(id);

                const existingRecord = existingById.get(id);

                if (!existingRecord) {
                    // Create new record with payload fields
                    const record = this.locationRepository.create({
                        location_id: id,
                        parent_id: zoneId,
                        display_name: l.display_name ?? id,
                        location_type: LocationType.PALLET,
                        row: l.row != null ? Number(l.row) : undefined,
                        column: l.column != null ? Number(l.column) : undefined,
                        pick_priority: l.pick_priority != null ? Number(l.pick_priority) : undefined,
                        drop_priority: l.drop_priority != null ? Number(l.drop_priority) : undefined,
                    });

                    // Fallbacks ONLY for newly created records
                    if (record.column == null) record.column = 1;
                    if (record.row == null) record.row = nextRow++;
                    if (record.pick_priority == null) record.pick_priority = nextPick++;
                    if (record.drop_priority == null && record.pick_priority != null) {
                        const computed = baselineTotal - (record.pick_priority - 1);
                        record.drop_priority = Math.max(1, computed);
                    }

                    await this.locationRepository.save(record);
                } else {
                    // Update only provided fields; do not overwrite existing when FMS omits
                    const updates: Partial<LocationEntity> = {};
                    if (l.row != null) updates.row = Number(l.row);
                    if (l.column != null) updates.column = Number(l.column);

                    if (Object.keys(updates).length > 0) {
                        await this.locationRepository.update({ location_id: id }, updates);
                    }
                }
            }

            // Remove pallets not present in FMS response for this zone
            for (const e of existing) {
                if (!seenIds.has(e.location_id)) {
                    console.log(`Deleting location ${e.location_id} from zone ${zoneId} as it's not present in FMS`);
                    await this.locationRepository.delete({ location_id: e.location_id });
                }
            }
        }

        // Remove zones not present in FMS (and their children first)
        const dbZones = await this.locationRepository.find({ where: { location_type: LocationType.ZONE } });
        for (const dbZone of dbZones) {
            if (!fmsZoneIds.has(dbZone.location_id)) {
                console.log(`Deleting zone ${dbZone.location_id} and its children as it's not present in FMS`);
                await this.locationRepository.delete({ parent_id: dbZone.location_id, location_type: LocationType.PALLET });
                await this.locationRepository.delete({ location_id: dbZone.location_id });
            }
        }
    }

  async fetchFMSLocations() {
    const fms_zones = JSON.parse(process.env.FMS_ZONES || '[]');

    try{
          const warehouse_name = process.env.WMS_WAREHOUSE_NAME || 'warehouse';
          const warehouse_key = process.env.WMS_WAREHOUSE_AUTH_KEY || 'test';
          const wms_base_url = process.env.WMS_BASE_URL || 'http://localhost:3000/robot-job';
          console.log(`Fetching WMS locations from ${wms_base_url}`);
            const zones = Array.isArray(fms_zones) && fms_zones.length ? fms_zones : [];
            const entries = await Promise.all(zones.map(async (zone: string) => {
              const url = `${wms_base_url}/robot-job/${warehouse_name}/locations?location_zone=${encodeURIComponent(zone)}&location_type=${encodeURIComponent(zone)}`;
              console.log(`Fetching locations for zone ${zone} from ${url}`);
              const response = await fetch(url, {
              method: 'GET',
              headers: {
                authorization: `${warehouse_key}`,
                'Content-Type': 'application/json',
              },
              });
              if (!response.ok) {
              throw new BadRequestException(`Failed to fetch locations for zone ${zone}: ${response.status} ${response.statusText}`);
              }
              const data = await response.json();
              data.available_location_types.sort((a, b)=> a.location_id.localeCompare(b.location_id));
              return [data.zone_id, data.available_location_types] as const;
            }));

            const zoneMap: Record<string, any> = Object.fromEntries(entries);
            return zoneMap;
        }
        catch{
          throw new BadRequestException('Failed to fetch locations from FMS' );
        }
  }
}