import { PartialType } from '@nestjs/swagger';
import { CreateBaseopsTaskDto } from './create-baseops_task.dto';

export class UpdateBaseopsTaskDto extends PartialType(CreateBaseopsTaskDto) {}
