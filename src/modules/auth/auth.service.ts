import { ConflictException, Injectable } from '@nestjs/common';
import { CreateAuthDto } from './dto/create-auth.dto';
import { UpdateAuthDto } from './dto/update-auth.dto';
import { User } from 'src/entities/user.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { Role } from 'src/entities/user.entity';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}
  async create(createAuthDto: CreateAuthDto) {
    const existingUser = await this.userRepository.findOne({
      where: { user_name: createAuthDto.user_name },
    });
    if (existingUser) {
      throw new ConflictException(`User with email ${createAuthDto.user_name} already exists`);
    }
    if (!createAuthDto.password) {
      throw new ConflictException('Password is required');
    }
    if (!createAuthDto.role || !Object.values(Role).includes(createAuthDto.role)) {
      throw new ConflictException('Role is required and must be a valid value');
    }
    // Hash the password before saving (assuming you have a hashing function)
    const hashedPassword = await bcrypt.hash(createAuthDto.password, 10);
    const newUser = this.userRepository.create({
      ...createAuthDto,
      password: hashedPassword,
    });
    await this.userRepository.save(newUser);
    return {
      "user_name": newUser.user_name,
      "role": newUser.role, 
    }
  }

  findAll() {
    return `This action returns all auth`;
  }

  findOne(id: number) {
    return `This action returns a #${id} auth`;
  }

  update(id: number, updateAuthDto: UpdateAuthDto) {
    return `This action updates a #${id} auth`;
  }

  remove(id: number) {
    return `This action removes a #${id} auth`;
  }
}
