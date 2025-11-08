import { IsString } from 'class-validator';

export class WMSBatchJobCargo {
    @IsString()
    cargo_code: string;
}