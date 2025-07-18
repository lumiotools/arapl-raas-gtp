import { Controller, Get, Post, Body, Patch, Param, Delete, Res } from '@nestjs/common';
import { AuthService } from './auth.service';
import { CreateAuthDto } from './dto/create-auth.dto';
import { UpdateAuthDto } from './dto/update-auth.dto';
import { User } from 'src/entities/user.entity';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('/register')
  async create(@Body() createAuthDto: CreateAuthDto) {
    return await this.authService.create(createAuthDto);
  }

  @Post('/login')
  async login(@Body() loginDto: { user_name: string; password: string }, @Res({ passthrough: true }) res) {
    const result = await this.authService.login(loginDto.user_name, loginDto.password);
    if (result && result.token) {
      res.cookie('token', result.token, { httpOnly: true, secure: true, sameSite: 'strict' });
    }
    return result;
  }

  @Get()
  findAll() {
    return this.authService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.authService.findOne(+id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateAuthDto: UpdateAuthDto) {
    return this.authService.update(+id, updateAuthDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.authService.remove(+id);
  }
}
