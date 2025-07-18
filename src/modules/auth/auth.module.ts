import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { User } from 'src/entities/user.entity' // Make sure User entity is imported

@Module({
  imports: [TypeOrmModule.forFeature([User])], // Assuming User entity is defined
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
