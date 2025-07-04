import { Injectable } from '@nestjs/common';

@Injectable()
export class TriggerService {
  async triggerStationAction(stationId: string) {
    // Dummy response
    return {
      message: `Trigger action called for station ${stationId}`,
      station_id: stationId,
      timestamp: new Date(),
      status: 'success',
    };
  }

  async getStationStatus(stationId: string) {
    // Dummy response
    return {
      message: `Status requested for station ${stationId}`,
      station_id: stationId,
      status: 'AVAILABLE',
      timestamp: new Date(),
    };
  }
}
