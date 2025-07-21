import { JwtModuleOptions } from '@nestjs/jwt';
import { config } from 'dotenv';
config(); // Load environment variables from .env file
export const jwtConfig: JwtModuleOptions = {
  global: true,
  secret: config().parsed?.JWT_SECRET ,
  signOptions: { expiresIn: '10h' },
};
