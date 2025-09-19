import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { LocationEntity } from "src/entities/location.entity";
import { Repository } from "typeorm";

@Injectable()
export class LocationManagerService {
    constructor(
        @InjectRepository(LocationEntity)
        private locationRepository: Repository<LocationEntity>,
    ) {}
}