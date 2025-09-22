import { SetMetadata } from '@nestjs/common';
import { Role } from 'src/entities/user.entity';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, [Role.ADMIN, ...roles]);