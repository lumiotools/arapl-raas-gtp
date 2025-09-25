import { PartialType } from '@nestjs/swagger';
import { CreateEmptyLocationDto } from './create-empty_location.dto';

export class UpdateEmptyLocationDto extends PartialType(CreateEmptyLocationDto) {}
