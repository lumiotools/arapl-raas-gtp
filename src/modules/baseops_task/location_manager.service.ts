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
        const location = await this.locationRepository.findOne({
            where: { parent_id: zone_id, location_status: LocationStatus.AVAILABLE, location_type: LocationType.PALLET },
            order: { drop_priority: "ASC" }
        });
        console.log('Optimal drop location:', JSON.stringify(location));
        return location ? location.display_name : null;
    }

    async freeLocation(display_name: string): Promise<void> {
        await this.locationRepository.update({ display_name }, { location_status: LocationStatus.AVAILABLE });
    }

    async occupyLocation(display_name: string): Promise<void> {
        await this.locationRepository.update({ display_name }, { location_status: LocationStatus.OCCUPIED });
    }

}