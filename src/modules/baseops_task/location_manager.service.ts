import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { LocationEntity, LocationType } from "src/entities/location.entity";
import { LocationStatus } from "src/entities/station.entity";
import { Repository } from "typeorm";

@Injectable()
export class BaseOpsLocationManagerService {
    constructor(
        @InjectRepository(LocationEntity)
        private locationRepository: Repository<LocationEntity>,
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

    async isValidLocationId(location_id: string): Promise<boolean> {
        const location = await this.locationRepository.findOne({ where: { display_name: location_id, location_status: LocationStatus.AVAILABLE, location_type: LocationType.PALLET } });
        console.log(`Checking location ID: ${location_id}, Found: ${location ? 'Yes' : 'No'}`);
        if (!location) {
            return false;
        }
        return true;
    }
}