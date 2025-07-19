import { Module } from '@nestjs/common';
import { DatabaseResetController } from './database-reset.controller';
import { DatabaseResetService } from './database-reset.service';
import { JwtModule } from '@nestjs/jwt';
import { jwtConfig } from 'src/config/jwt.config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from 'src/entities/user.entity';

@Module({
  imports:[JwtModule.register(jwtConfig), TypeOrmModule.forFeature([User])], 
  controllers: [DatabaseResetController],
  providers: [DatabaseResetService],
  exports: [DatabaseResetService],
})
export class DatabaseResetModule {}
