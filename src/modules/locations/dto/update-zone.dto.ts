import { IsOptional, IsString, MaxLength } from 'class-validator';

// DTO for updating a Zone. Only display_name and "Category" attribute are editable
export class UpdateZoneDto {
  @IsString()
  @IsOptional()
  @MaxLength(100)
  display_name?: string;

  // Category attribute value (can be string or null). Accept empty string/null as clearing.
  @IsOptional()
  @IsString()
  category?: string; // allowing string; if need to allow null, absence or explicit null handled in service
}
