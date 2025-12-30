import { Controller, Get, Post, Body, Patch, Param, Delete, Res, Req, UnauthorizedException, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { AuthService } from './auth.service';
import { CreateAuthDto } from './dto/create-auth.dto';
import { UpdateAuthDto } from './dto/update-auth.dto';
import { RolesGuard } from './guard/roles.guard';
import { Roles } from './guard/roles.decorator';
import { JwtService } from '@nestjs/jwt';
import { jwtConfig } from 'src/config/jwt.config';
import { JwtAuthGuard } from './guard/auth.guard';
import { Role } from 'src/entities/user.entity';
import { ApiBody, ApiConsumes, ApiOperation, ApiResponse } from '@nestjs/swagger';
import e from 'express';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly jwtService: JwtService
  ) {}

  @Post('/register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Register a new user',
    description: 'Creates a new user account with the provided details.'
  })
  @ApiConsumes('application/json')
  @ApiBody({ schema: {type: 'object', properties:{user_name: { type: 'string' }, password: { type: 'string' }, role: { type: 'string' }}} })
  @ApiResponse({
    status: 201,
    description: 'The user has been successfully created.',
    schema: {
      type: 'object',
      properties: {
        user_name: { type: 'string' },
        role: { type: 'string' }
      }
    }
  })
  @ApiResponse({
    status: 409,
    description: 'Conflict. Username already exists or Password is required or Role is invalid.'
  })

  async create(@Body() createAuthDto: CreateAuthDto) {
    return await this.authService.create(createAuthDto);
  }

  @Post('/login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'User login',
    description: 'Authenticates a user and returns a JWT token.'
  })
  @ApiConsumes('application/json')
  @ApiBody({ schema: {type: 'object', properties:{user_name: { type: 'string' }, password: { type: 'string' }}} })
  @ApiResponse({
    status: 200,
    description: 'The user has been successfully authenticated.',
    schema: {
      type: 'object',
      properties: {
        user_name: { type: 'string' },
        role: { type: 'string' },
        token: { type: 'string' }
      }
    }
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized. Invalid Username or Password.'
  })
  async login(@Body() loginDto: { user_name: string; password: string }, @Res({ passthrough: true }) res) {
    const result = await this.authService.login(loginDto.user_name, loginDto.password);
    if (result && result.token) {
      console.log('Setting cookie with token:', result.token);
      
      // Set cookie with proper configuration
      res.cookie('token', result.token, {
        httpOnly: true, // Prevents JavaScript access, more secure
        secure: process.env.NODE_ENV === 'production', // Only sent over HTTPS in production
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax', // Allows cross-site requests (frontend/backend on different domains)
        maxAge: 10 * 60 * 60 * 1000 // 10 hours
      });
    }
    return result;
  }

  @Post('/logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'User logout',
    description: 'Logs out the user by clearing the authentication cookie.'
  })
  @ApiResponse({
    status: 200,
    description: 'The user has been successfully logged out.'
  })
  @ApiConsumes('application/json')
  async logout(@Res({ passthrough: true }) res) {
    res.clearCookie('token');
    return { message: 'Logged out successfully' };
  }

  @Post('/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify JWT token',
    description: 'Verifies the JWT token from cookies and returns the payload if valid.'
  })
  @ApiResponse({
    status: 200,
    description: 'The token is valid.',
    schema: {
      type: 'object',
      properties: {
        sub: { type: 'number' },
        user_name: { type: 'string' },
        role: { type: 'string' }
      }
    }
  })
  @ApiConsumes('application/json')
  @ApiResponse({
    status: 401,
    description: 'Unauthorized. Invalid or missing token.'
  })
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
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get user profile',
    description: 'Retrieves the profile of the authenticated user.'
  })
  @ApiResponse({
    status: 200,
    description: 'The user profile has been successfully retrieved.',
    schema: {
        type: 'object',
        properties: {
          user: {
            type: 'object',
            properties: {
              sub: { type: 'string' },
              user_name: { type: 'string' },
              role: { type: 'string' },
              exp: { type: 'number' },
              iat: { type: 'number'
            }
          }
        }
      }
    }
  })
  @UseGuards(JwtAuthGuard)
  async getProfile(@Req() req) {
    return { user: req.user };
  }
}
