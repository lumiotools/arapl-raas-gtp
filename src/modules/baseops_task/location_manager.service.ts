import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { LocationEntity } from "src/entities/location.entity";
import { LocationStatus } from "src/entities/station.entity";
import { Repository } from "typeorm";

@Injectable()
export class BaseOpsLocationManagerService {
    constructor(
        @InjectRepository(LocationEntity)
        private locationRepository: Repository<LocationEntity>,
    ) {}

    async reserveLocation(location_id: string): Promise<boolean> {
        const queryRunner = this.locationRepository.manager.connection.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();
    
        try {
            // Single atomic operation: Update only if status is AVAILABLE
            const result = await queryRunner.manager
                .createQueryBuilder()
                .update(LocationEntity)
                .set({ status: LocationStatus.RESERVED })
                .where("location_id = :location_id AND status = :status", {
                    location_id: location_id,
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

    
}