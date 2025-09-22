import { PartialType } from '@nestjs/swagger';
import { CreateWaitingLocationDto } from './create-waiting_location.dto';

export class UpdateWaitingLocationDto extends PartialType(CreateWaitingLocationDto) {}
