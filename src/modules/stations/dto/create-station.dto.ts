import { GtpLocation } from "src/entities";

export class CreateStationDto {
  station_id: string;
  station_name: string;
  priority: number;
  is_active?: boolean;
  gtp_locations_array ?: string[];
}
