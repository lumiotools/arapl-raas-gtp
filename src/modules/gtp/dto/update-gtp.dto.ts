import { PartialType } from '@nestjs/swagger';
import { CreateGtpDto } from './create-gtp.dto';

export class UpdateGtpDto extends PartialType(CreateGtpDto) {}
