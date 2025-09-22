import { ApiProperty } from '@nestjs/swagger';
import { CargoDimension, CargoAttribute } from 'src/entities/cargo.entity';

export class CargoResponseDto {
  @ApiProperty({
    description: 'Cargo identifier code',
    example: 'PRD001',
  })
  cargo_code: string;

  @ApiProperty({
    description: 'Type of cargo',
    example: 'Pallet',
  })
  cargo_type: string;

  @ApiProperty({
    description: 'Dimensions of the cargo',
    example: { length: 0, width: 0, height: 0 },
  })
  cargo_dimension: CargoDimension;

  @ApiProperty({
    description: 'Special attributes of the cargo',
    example: null,
    nullable: true,
  })
  cargo_attributes: CargoAttribute[] | null;

  @ApiProperty({
    description: 'Weight of the cargo in kg',
    example: 0,
  })
  cargo_weight: number;
}
