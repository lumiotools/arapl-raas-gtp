import { BadRequestException, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Task, TaskStatus } from "src/entities";
import { TaskType } from "src/entities/task.entity";
import { OperationType } from 'src/entities/robot-count.entity';
import { LocationEntity, LocationType } from "src/entities/location.entity";
import { LocationStatus } from "src/entities/station.entity";
import { In, Raw, Repository } from "typeorm";
import { LoggingService } from "../../services/logging.service";

@Injectable()
export class LocationManagerService {
    private taskType: TaskType = TaskType.BASEOPS;
    private operationType: OperationType = OperationType.BASEOPS;
    constructor(
        @InjectRepository(LocationEntity)
        private locationRepository: Repository<LocationEntity>,
        @InjectRepository(Task)
        private taskRepository: Repository<Task>,
        private readonly loggingService: LoggingService,
    ) {}

    // Initialize the service for a specific operation/task type
    public initForTaskType(operationType: OperationType, taskType: TaskType) {
        this.operationType = operationType ?? this.operationType;
        this.taskType = taskType ?? this.taskType;
    }

    async reserveLocation(location_id: string): Promise<boolean> {
        const location = await this.locationRepository.findOne({ where: { location_id: location_id, location_status: LocationStatus.AVAILABLE } });
        console.log(`location found: ${JSON.stringify(location)}`);
        if (!location) {
            console.log(`Location ${location_id} is not available for reservation.`);
            await this.loggingService.log(`Location ${location_id} not available for reservation`, this.taskType, null, null);
            return false;
        }
        location.location_status = LocationStatus.RESERVED;
        await this.locationRepository.save(location);
        await this.loggingService.log(`Location ${location_id} reserved`, this.taskType, null, null);
        return true;
    }

    async reserveStartLocation(location_id: string): Promise<boolean> {
        const location = await this.locationRepository.findOne({ where: { location_id: location_id, location_status: In([LocationStatus.AVAILABLE, LocationStatus.OCCUPIED]) } });
        if (!location) {
            console.log(`Location ${location_id} is not available for reservation.`);
            await this.loggingService.log(`Start location ${location_id} not available for reservation`, this.taskType, null, null);
            return false;
        }
        location.location_status = LocationStatus.RESERVED;
        await this.locationRepository.save(location);
        await this.loggingService.log(`Start location ${location_id} reserved`, this.taskType, null, null);
        return true;
    }

    async findOptimalDropLocation(zone_id: string): Promise<string | null> {
        const zone = await this.locationRepository.findOne({ where: { location_id: zone_id, location_type: LocationType.ZONE } });
        if (!zone) {
            console.log(`Zone with ID ${zone_id} not found.`);
            await this.loggingService.log(`Zone ${zone_id} not found while finding drop location`, this.taskType, null, null);
            return null;
        }
        const locations = await this.locationRepository.find({
            where: { parent_id: zone.location_id, location_status: LocationStatus.AVAILABLE, location_type: LocationType.PALLET },
            order: { drop_priority: "ASC" }
        });
        if (locations.length === 0){
            await this.loggingService.log(`No available drop locations in zone ${zone_id}`, this.taskType, null, null);
            return null;
        }
        // fetch the location from the locations with smallest (highest priority) drop_priority

        const optimalLocation = locations.find(loc => loc.drop_priority !== null);
            if (optimalLocation) {
            await this.loggingService.log(`Selected drop location ${optimalLocation.location_id} in zone ${zone_id}`, this.taskType, null, null);
            return optimalLocation.location_id;
        }
        const validLocations = locations.filter(loc => 
            loc.row != null && loc.column != null
        );
        if (!validLocations.length) {
            await this.loggingService.log(`No valid drop locations (row/column) in zone ${zone_id}`, this.taskType, null, null);
            return null;
        }

        const chosen = validLocations.reduce((min, current) => {
            if (current.row < min.row || 
            (current.row === min.row && current.column < min.column)) {
            return current;
            }
            return min;
        });
        await this.loggingService.log(`Selected drop location ${chosen.location_id} in zone ${zone_id} by row/column`, this.taskType, null, null);
        return chosen.location_id;
    }

    async freeLocation(location_id: string): Promise<void> {
        await this.locationRepository.update({ location_id }, { location_status: LocationStatus.AVAILABLE });
        await this.loggingService.log(`Location ${location_id} set to AVAILABLE`, this.taskType, null, null);
    }

    async occupyLocation(location_id: string): Promise<void> {
        await this.locationRepository.update({ location_id }, { location_status: LocationStatus.OCCUPIED });
        await this.loggingService.log(`Location ${location_id} set to OCCUPIED`, this.taskType, null, null);
    }

    async isValidLocationId(location_id: string, isStart: boolean): Promise<boolean> {
        const location = await this.locationRepository.findOne({ where: { location_id: location_id, location_status: isStart ? In([LocationStatus.OCCUPIED, LocationStatus.AVAILABLE]) : LocationStatus.AVAILABLE, location_type: LocationType.PALLET } });
        console.log(`Checking location ID: ${location_id}, Found: ${location ? 'Yes' : 'No'}`);
        if (!location) {
            await this.loggingService.log(`Invalid or unavailable ${isStart ? 'start' : 'end'} location ${location_id}`, this.taskType, null, null);
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
        const startLocation = await this.locationRepository.find({ where: { location_type: LocationType.PALLET },
            relations: ['parent']
        });
        return startLocation;
    }

    async getManualTaskEndLocation(){
        const endLocation = await this.locationRepository.find({ where: { location_type: LocationType.PALLET }, relations: ['parent'] });
        return endLocation;
    }

    async getOptimalWaitLocation(required_location_id: string): Promise<string | null> {
        console.log("Finding optimal wait location in end zone...");

        const requiredLocation = await this.locationRepository.findOne({ where: { location_id: required_location_id } });

        console.log(`Required location found: ${requiredLocation ? 'Yes' : 'No'}, Current Zone: `, requiredLocation?.location_type === LocationType.PALLET ? requiredLocation.parent_id : requiredLocation?.location_id);

        let waitLocationQuery = this.locationRepository
            .createQueryBuilder('location')
            .where('location.location_type = :locationType', { locationType: LocationType.PALLET })
            .andWhere('location.parent_id = :parentId', { parentId: requiredLocation?.location_type === LocationType.PALLET ? requiredLocation.parent_id : requiredLocation?.location_id })
            .andWhere('location.location_status = :locationStatus', { locationStatus: LocationStatus.AVAILABLE })
            .andWhere(
                `location.attributes::jsonb @> :attr::jsonb`,
                { 
                    attr: JSON.stringify([{ 
                        attribute_name: 'is_waiting_area', 
                        attribute_value: true 
                    }])
                }
            )
            .orderBy('location.drop_priority', 'ASC');
        
        let waitLocation = await waitLocationQuery.getOne();

        console.log(`Wait location in same zone found: ${waitLocation ? 'Yes' : 'No'}`);
            if (waitLocation) {
                await this.loggingService.log(`Wait location ${waitLocation.location_id} selected in same zone for ${requiredLocation?.location_id}`,
                this.taskType, null, null);
        }

        if (!waitLocation) {

            console.log("Searching for wait location...");
            const waitZone = await this.locationRepository
                .createQueryBuilder('location')
                .where('location.location_type = :locationType', { locationType: LocationType.ZONE })
                .andWhere(
                    `location.attributes::jsonb @> :attr::jsonb`,
                    { 
                        attr: JSON.stringify([{ 
                            attribute_name: 'is_waiting_area', 
                            attribute_value: true 
                        }])
                    }
                )
                .getOne();
            
                if (!waitZone) {
                console.log(`Wait zone not found, Searching for other wait locations...`);
                await this.loggingService.log(`Wait zone attribute not found; searching global wait locations`, this.taskType, null, null);
            }
            
            waitLocationQuery = this.locationRepository
                .createQueryBuilder('location')
                .where('location.location_type = :locationType', { locationType: LocationType.PALLET })
                .andWhere('location.location_status = :locationStatus', { locationStatus: LocationStatus.AVAILABLE })
                .orderBy('location.drop_priority', 'ASC');
            
            if (waitZone) {
                waitLocationQuery.andWhere('location.parent_id = :parentId', { parentId: waitZone.location_id });
            } else {
                waitLocationQuery.andWhere(
                    `location.attributes::jsonb @> :attr::jsonb`,
                    { 
                        attr: JSON.stringify([{ 
                            attribute_name: 'is_waiting_area', 
                            attribute_value: true 
                        }])
                    }
                );
            }
            
            waitLocation = await waitLocationQuery.getOne();
            console.log(`Found wait location: ${waitLocation ? 'Yes' : 'No'}`);
            console.log(`Found wait location: ${waitLocation?.location_id}`);
            if (waitLocation) {
                await this.loggingService.log(`Wait location ${waitLocation.location_id} selected (fallback search)`, this.taskType, null, null);
            }
        } else {
            console.log(`Found wait location in same zone: ${waitLocation.location_id}`);
        }

        if (!waitLocation) {
            await this.loggingService.log(`No wait location available for ${requiredLocation?.location_id}`, this.taskType, null, null);
        }
        return waitLocation?.location_id || null;
    }

    async getDisplayName(location_id: string): Promise<string> {
        const location = await this.locationRepository.findOne({ where: { location_id: location_id } });
        return location?.display_name || location_id;
    }

    async getPickPriority(location_id: string): Promise<number> {
        const location = await this.locationRepository.findOne({ where: { location_id: location_id } });
        return location!.pick_priority;
    }

    async getDropPriority(location_id: string): Promise<number> {
        const location = await this.locationRepository.findOne({ where: { location_id: location_id } });
        return location!.drop_priority;
    }

    async getLocation(location_id: string): Promise<LocationEntity | null> {
        const location = await this.locationRepository.findOne({ where: { location_id: location_id } });
        return location || null;
    }

    async findInaccessibleStartLocations(startLocationIds: string[], minPriority: number, maxPriority: number, zoneId?: string): Promise<LocationEntity[]> {
        if (!startLocationIds || startLocationIds.length === 0) return [];

        const blocked: LocationEntity[] = [];

        const colQb = this.locationRepository.createQueryBuilder('c')
            .select('DISTINCT c.column', 'col')
            .where('c.location_type = :locationType', { locationType: LocationType.PALLET })
            .andWhere('c.column IS NOT NULL');
        if (zoneId) colQb.andWhere('c.parent_id = :zoneId', { zoneId });
        const cols = await colQb.getRawMany();
        if (cols.length <= 2) return [];

        for (const sid of startLocationIds) {
            const loc = await this.getLocation(sid);
            if (!loc) continue;
            if (loc.column == null) continue;

            // Query for any non-AVAILABLE slot in same column with pick_priority less than maxPriority
            const qb = this.locationRepository.createQueryBuilder('l')
                .where('l.location_type = :locationType', { locationType: LocationType.PALLET })
                .andWhere('l.column = :col', { col: loc.column })
                .andWhere('l.location_status != :available', { available: LocationStatus.AVAILABLE })
                .andWhere('l.pick_priority < :maxPriority', { maxPriority });

            if (zoneId) qb.andWhere('l.parent_id = :zoneId', { zoneId });
            // exclude the current batch's start locations from blocking
            if (startLocationIds && startLocationIds.length > 0) qb.andWhere('l.location_id NOT IN (:...excluded)', { excluded: startLocationIds });

            const blocker = await qb.getOne();
            if (blocker) blocked.push(loc);
        }

        return blocked;
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

            // Ensure zone exists (add-only, no overwrite)
            const existingZone = await this.locationRepository.findOne({ where: { location_id: zoneId, location_type: LocationType.ZONE } });
            if (!existingZone) {
                const zoneRecord = this.locationRepository.create({
                    location_id: zoneId,
                    display_name: zoneId,
                    location_type: LocationType.ZONE,
                });
                await this.locationRepository.save(zoneRecord);
                    await this.loggingService.log(`Created new zone ${zoneId} from FMS sync`, this.taskType, null, null);
                console.log(`Created new zone ${zoneId}`);
            } else {
                console.log(`Zone ${zoneId} already exists; skipping update`);
            }

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
                        row: l.location_row != null ? Number(l.location_row) : undefined,
                        column: l.location_column != null ? Number(l.location_column) : undefined,
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
                    await this.loggingService.log(`Created new location ${id} under zone ${zoneId} from FMS sync`, this.taskType, null, null);
                    console.log(`Created new location ${id} under zone ${zoneId}`);
                } else {
                    // Existing location found - no changes (add-only policy)
                    // Intentionally skipping updates for existing locations
                    // to avoid overwriting local data when FMS omits fields
                }
            }

            // Remove pallets not present in FMS response for this zone
            for (const e of existing) {
                if (!seenIds.has(e.location_id)) {
                    console.log(`Deleting location ${e.location_id} from zone ${zoneId} as it's not present in FMS`);
                    await this.locationRepository.delete({ location_id: e.location_id });
                    await this.loggingService.log(`Deleted location ${e.location_id} (not present in FMS)`, this.taskType, null, null);
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
                await this.loggingService.log(`Deleted zone ${dbZone.location_id} and its children (not present in FMS)`, this.taskType, null, null);
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
                catch(error){
            await this.loggingService.createErrorLog(`Failed to fetch locations from FMS: ${error?.message ?? error}`,
                this.taskType, null as any, null, true);
                    throw new BadRequestException('Failed to fetch locations from FMS' );
        }
  }
}