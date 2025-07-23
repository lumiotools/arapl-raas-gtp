import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';

export const getDBConfig = (
  configService: ConfigService,
): TypeOrmModuleOptions => {
  const dbEnv = configService.get<string>('DB_ENV', 'local');

  const dbCredentials = {
    local: {
      username: configService.get<string>('DB_USERNAME', 'postgres'),
      password: configService.get<string>('DB_PASSWORD'),
      database: configService.get<string>('DB_DATABASE', 'wms_gtp'),
      // ssl: configService.get<boolean>('DB_SSL', false), // Optional SSL configuration
    },
  };

  return {
    type: 'postgres',
    host: configService.get<string>('DB_HOST', 'localhost'),
    port: configService.get<number>('DB_PORT', 5432),
    username: dbCredentials[dbEnv]?.username || dbCredentials.local.username,
    password: dbCredentials[dbEnv]?.password || dbCredentials.local.password,
    database: dbCredentials[dbEnv]?.database || dbCredentials.local.database,
    ssl: dbCredentials[dbEnv]?.ssl || false,
    entities: [__dirname + '/../**/*.entity{.ts,.js}'],
    synchronize: true, // Set to false in production
    logging: true, // Enable logging for debugging
  };
};

// Legacy export for backward compatibility
export const DBConfig: TypeOrmModuleOptions = {
  type: 'postgres',
  host: 'localhost',
  port: 5432,
  username: 'postgres',
  password: 'rishav',
  database: 'wms_gtp',
  entities: [__dirname + '/../**/*.entity{.ts,.js}'],
  synchronize: true, // Set to false in production
  logging: true, // Enable logging for debugging
};
