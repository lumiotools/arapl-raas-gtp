import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { CreateAuthDto } from './dto/create-auth.dto';
import { UpdateAuthDto } from './dto/update-auth.dto';
import { User } from 'src/entities/user.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { Role } from 'src/entities/user.entity';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private jwtService: JwtService,
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
  async login(user_name: string, password: string) {
    const user = await this.userRepository.findOne({ where: { user_name } });
    if (!user) {
      throw new UnauthorizedException('Invalid Username or Password');
    }
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid Username or Password');
    }
    // Generate a JWT token
    const payload = { sub: user.id, username: user.user_name, role: user.role };
    const token = await this.jwtService.signAsync(payload);
    let res = {
      user_name: user.user_name,
      role: user.role,
      token: token,
    };
    return res;
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
