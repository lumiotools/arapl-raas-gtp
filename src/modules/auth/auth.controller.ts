import { Controller, Get, Post, Body, Patch, Param, Delete, Res, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { CreateAuthDto } from './dto/create-auth.dto';
import { UpdateAuthDto } from './dto/update-auth.dto';
import { RolesGuard } from './guard/roles.guard';
import { Roles } from './guard/roles.decorator';
import { JwtService } from '@nestjs/jwt';
import { jwtConfig } from 'src/config/jwt.config';
import { JwtAuthGuard } from './guard/auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService, private readonly jwtService: JwtService) {}

  @Post('/register')
  async create(@Body() createAuthDto: CreateAuthDto) {
    return await this.authService.create(createAuthDto);
  }

  @Post('/login')
  async login(@Body() loginDto: { user_name: string; password: string }, @Res({ passthrough: true }) res) {
    const result = await this.authService.login(loginDto.user_name, loginDto.password);
    if (result && result.token) {
      console.log('Setting cookie with token:', result.token);
      
      // Set cookie with proper configuration
      res.cookie('token', result.token, {
        httpOnly: true, // Prevents JavaScript access, more secure
        secure: process.env.NODE_ENV === 'production', // Only sent over HTTPS in production
        sameSite: 'lax', // Allows cross-site requests (frontend/backend on different domains)
        maxAge: 10 * 60 * 60 * 1000 // 10 hours
      });
    }
    return result;
  }

  @Post('/verify')
  @UseGuards(JwtAuthGuard)
  async verify(@Req() req) {
    
    const token = req.cookies?.token;
    
    if (!token) {
      throw new UnauthorizedException('No token found');
    }
    // Verify the token
    const payload = await this.jwtService.verifyAsync(token, {
      secret: jwtConfig.secret // Make sure this matches your JWT secret
    });
    return payload; 
  }

  // Protected route - any authenticated user
  @Get('/profile')
  @UseGuards(JwtAuthGuard)
  async getProfile(@Req() req) {
    return { user: req.user };
  }

  // Admin only route
  @Get('/admin/users')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async getAllUsers() {
    return { message: 'Only admins can see this' };
  }

  // Multiple roles allowed
  @Get('/admin/reports')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'operator')
  async getReports() {
    return { message: 'Admins and operators can see this' };
  }
}
