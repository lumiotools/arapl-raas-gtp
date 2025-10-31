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
        await this.updateLocationStatusInFMS(location_id, 'Empty');
        await this.loggingService.log(`Location ${location_id} set to AVAILABLE`, this.taskType, null, null);
    }

    async occupyLocation(location_id: string): Promise<void> {
        await this.locationRepository.update({ location_id }, { location_status: LocationStatus.OCCUPIED });
        await this.updateLocationStatusInFMS(location_id, 'Occupied');
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

    async getEntryPoint(location_id: string): Promise<LocationEntity|null> {
        const location = await this.locationRepository.findOne({ where: { location_id: location_id }, select: {parent_id: true} });
        const entry_location = await this.locationRepository.findOne({ where: { parent_id: location?.parent_id ?? location?.location_id, location_type: LocationType.ENTRY } });
        
        return entry_location ? entry_location : null;
    }

    async getLocation(location_id: string): Promise<LocationEntity | null> {
        const location = await this.locationRepository.findOne({ where: { location_id: location_id } });
        return location || null;
    }

    async findInaccessibleStartLocations(startLocationIds: string[], minPriority: number, maxPriority: number, zoneId?: string): Promise<LocationEntity[]> {
        if (!startLocationIds || startLocationIds.length === 0) return [];

        const blocked: LocationEntity[] = [];

        // load all requested start locations in one query
        const starts = await this.locationRepository.find({
            where: { location_id: In(startLocationIds) }
        });

        for (const loc of starts) {
            if (!loc) continue;
            if (loc.pick_priority == null) continue;

            // If any OTHER location (excluding the provided start locations)
            // in the same zone (or a provided zoneId) is OCCUPIED and has a
            // pick_priority less than this start's pick_priority, then this
            // start location is blocked (we must pick in ascending pick_priority order).
            const qb = this.locationRepository.createQueryBuilder('l')
                .where('l.location_type = :locationType', { locationType: LocationType.PALLET })
                .andWhere('l.location_status = :occupied', { occupied: LocationStatus.OCCUPIED })
                .andWhere('l.pick_priority < :startPriority', { startPriority: loc.pick_priority })
                .andWhere('l.location_id NOT IN (:...excluded)', { excluded: startLocationIds });

            if (zoneId) {
                qb.andWhere('l.parent_id = :zoneId', { zoneId });
            } else if (loc.parent_id) {
                qb.andWhere('l.parent_id = :parentId', { parentId: loc.parent_id });
            }

            const blocker = await qb.getOne();
            if (blocker) blocked.push(loc);
        }

        return blocked;
    }

    async syncFMSLocations() {
        // const existingLocations = await this.locationRepository.find();

        // if (existingLocations.length > 0) {
        //     console.log("Existing locations found in DB, skipping initial FMS sync to avoid overwriting local data.");
        //     return;
        // }

        console.log("Starting FMS location sync...");
        const fmsLocations = await this.fetchFMSLocations();
        console.log("Fetched FMS locations");

        for (const { zone_id, locations, entry_point } of fmsLocations) {
            const existing_zone = await this.locationRepository.findOne({ where: { location_id: zone_id, location_type: LocationType.ZONE } });
            if (!existing_zone) {
                const zoneRecord = this.locationRepository.create({
                    location_id: zone_id,
                    display_name: zone_id,
                    location_type: LocationType.ZONE,
                });
                await this.locationRepository.save(zoneRecord);
                console.log(`Created new zone ${zone_id} from FMS sync`);
                await this.loggingService.log(`Created new zone ${zone_id} from FMS sync`, this.taskType, null, null);
            } else {
                console.log(`Zone ${zone_id} already exists; skipping update`);
            }

            const existingLocations = await this.locationRepository.find({
                where: { parent_id: zone_id, location_type: LocationType.PALLET },
            });

            for (const location of locations) {
                const existingLocation = existingLocations.find(el => el.location_id === location.location_id)
                if (!existingLocation) {
                    const record = this.locationRepository.create({
                        location_id: String(location.location_id).trim(),
                        parent_id: zone_id,
                        display_name: location.display_name ?? String(location.location_id).trim(),
                        location_type: LocationType.PALLET,
                        row: location.location_row != null ? Number(location.location_row) : undefined,
                        column: location.location_column != null ? Number(location.location_column) : undefined,
                    });
                    await this.locationRepository.save(record);
                    console.log(`Created new location ${location.location_id} under zone ${zone_id}`);
                    await this.loggingService.log(`Created new location ${location.location_id} under zone ${zone_id} from FMS sync`, this.taskType, null, null);
                } else {
                    existingLocation.location_status = location.location_attribute?.attribute_value === "Empty" ? LocationStatus.AVAILABLE : LocationStatus.OCCUPIED;
                    await this.locationRepository.save(existingLocation);
                    console.log(`Updated location ${location.location_id} status under zone ${zone_id}`);
                }
            }

            if (entry_point) {
                const existingEntry = await this.locationRepository.findOne({ where: { parent_id: zone_id, location_type: LocationType.ENTRY } });
                if (!existingEntry) {
                    const entryRecord = this.locationRepository.create({
                        location_id: String(entry_point.location_id).trim(),
                        parent_id: zone_id,
                        display_name: entry_point.display_name ?? String(entry_point.location_id).trim(),
                        location_type: LocationType.ENTRY,
                    });
                    await this.locationRepository.save(entryRecord);
                    console.log(`Created new entry point ${entry_point.location_id} under zone ${zone_id}`);
                    await this.loggingService.log(`Created new entry point ${entry_point.location_id} under zone ${zone_id} from FMS sync`, this.taskType, null, null);
                } else {
                    existingEntry.location_status = entry_point.location_attribute?.attribute_value === "Empty" ? LocationStatus.AVAILABLE : LocationStatus.OCCUPIED;
                    await this.locationRepository.save(existingEntry);
                    console.log(`Updated entry point ${entry_point.location_id} under zone ${zone_id}`);
                }
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
        const entries = await Promise.all(zones.map(async (zone_type: { zone: string; type: string }) => {
            const locationsUrl = `${wms_base_url}/robot-job/${warehouse_name}/locations?location_zone=${encodeURIComponent(zone_type.zone)}&location_type=${encodeURIComponent(zone_type.type)}`;
            console.log(`Fetching locations for zone ${zone_type.zone} from ${locationsUrl}`);
            const locationsResponse = await fetch(locationsUrl, {
            method: 'GET',
            headers: {
            authorization: `${warehouse_key}`,
            'Content-Type': 'application/json',
            },
            });
            const locationsData = await locationsResponse.json();

            if (!locationsData?.available_location_types?.length) {
                locationsData.available_location_types = [];
            }
            locationsData.available_location_types.sort((a, b)=> a.location_id.localeCompare(b.location_id));

            const entryPointUrl = `${wms_base_url}/robot-job/${warehouse_name}/locations?location_zone=${encodeURIComponent(zone_type.zone)}&location_type=entry`;
            console.log(`Fetching locations for zone ${zone_type.zone} from ${entryPointUrl}`);
            const entryPointResponse = await fetch(entryPointUrl, {
            method: 'GET',
            headers: {
            authorization: `${warehouse_key}`,
            'Content-Type': 'application/json',
            },
            });
            const entryPointData = await entryPointResponse.json();

            if (!entryPointData?.available_location_types?.length) {
                entryPointData.available_location_types = [];
            }

            return {
                zone_id: zone_type.zone,
                locations: locationsData.available_location_types,
                entry_point: entryPointData.available_location_types[0]
            };
        }));

        const zoneMap = entries;
        return zoneMap;
        } catch(error){
            throw new BadRequestException('Failed to fetch locations from FMS' );
        }
  }

  async updateLocationStatusInFMS(location_id: string, status: 'Empty' | 'Occupied'): Promise<void> {
    const warehouse_name = process.env.WMS_WAREHOUSE_NAME || 'warehouse';
    const warehouse_key = process.env.WMS_WAREHOUSE_AUTH_KEY || 'test';
    const wms_base_url = process.env.WMS_BASE_URL || 'http://localhost:3000/robot-job';
    const updateUrl = `${wms_base_url}/robot-job/${warehouse_name}/locations/status`;

    const payload = {
        location_id: location_id,
        status: status
    };

    try {
        const response = await fetch(updateUrl, {
            method: 'PATCH',
            headers: {
                authorization: `${warehouse_key}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });

        const responseData = await response.json();

        if(responseData.status != 200) {
            throw new BadRequestException(responseData.message);
        }
    } catch (error) {
        console.log('Failed to update location status in FMS: ', error.message)
    }
  }

  async getZoneType(zone_id: string): Promise<string> {
    const fms_zones = JSON.parse(process.env.FMS_ZONES || '[]');
    const zone = fms_zones.find((z: { zone: string; type: string }) => z.zone === zone_id);
    return zone.type;
  }
}