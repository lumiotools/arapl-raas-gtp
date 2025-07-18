import { JwtModuleOptions } from '@nestjs/jwt';

export const jwtConfig: JwtModuleOptions = {
  global: true,
  secret: 'jwtConfig.secret',
  signOptions: { expiresIn: '10h' },
};
