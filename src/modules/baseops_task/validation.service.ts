import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Task } from 'src/entities/task.entity';
import { LocationEntity } from 'src/entities/location.entity';

export interface ValidationResult {
  isValid: boolean;
  reason?: string;
}

@Injectable()
export class ValidationService {
  private readonly logger = new Logger(ValidationService.name);

  constructor(
    @InjectRepository(LocationEntity)
    private readonly locationRepository: Repository<LocationEntity>,
  ) {}

  /**
   * Validate task location requirements
   */
  async validateTaskLocation(task: Task): Promise<ValidationResult> {
    // Check if start location exists
    const startLocation = await this.locationRepository.findOne({ 
      where: { location_id: task.start_location.location_id } 
    });
    
    if (!startLocation) {
      return { 
        isValid: false, 
        reason: `Start location ${task.start_location.location_id} does not exist` 
      };
    }
    
    
    // Check if end location exists
    const endLocation = await this.locationRepository.findOne({ 
      where: { location_id: task.end_location.location_id } 
    });
    
    if (!endLocation) {
      return { 
        isValid: false, 
        reason: `End location ${task.end_location.location_id} does not exist` 
      };
    }
    
    // Check if end location is occupied
    if (endLocation.is_occupied) {
      return { 
        isValid: false, 
        reason: `End location ${task.end_location.location_id} is occupied` 
      };
    }
    
    return { isValid: true };
  }

}
