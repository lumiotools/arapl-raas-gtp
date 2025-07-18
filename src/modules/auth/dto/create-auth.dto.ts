import { IsEnum, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { Role } from 'src/entities/user.entity';

export class CreateAuthDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(255)
    user_name: string;

    @IsEnum(Role)
    role: Role;

    @IsString()
    @IsNotEmpty()
    @MaxLength(255)
    password: string;
}