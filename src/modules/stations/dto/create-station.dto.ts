export class CreateStationDto {
  station_id: string;
  station_name: string;
  priority: number;
  is_active?: boolean;
}
