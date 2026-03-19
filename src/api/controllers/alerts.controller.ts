import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UnauthorizedException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AlertsService } from '../services/alerts.service';
import { Request } from 'express';

@Controller('alerts')
export class AlertsController {
  constructor(private readonly alertsService: AlertsService) {}

  @Post()
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async create(
    @Req() req: Request & { user?: any },
    @Body() body: {
      tokenAddress: string;
      label?: string;
      condition: any;
      channels?: string[];
      cooldownMinutes?: number;
    },
  ) {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedException('User context missing');
    return this.alertsService.createAlert(userId, body);
  }

  @Get()
  async list(@Req() req: Request & { user?: any }, @Query('tokenAddress') tokenAddress?: string) {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedException('User context missing');
    return this.alertsService.listUserAlerts(userId, tokenAddress);
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    return this.alertsService.getAlert(id);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: {
    label?: string;
    isActive?: boolean;
    condition?: any;
    cooldownMinutes?: number;
  }) {
    return this.alertsService.updateAlert(id, body);
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    await this.alertsService.deleteAlert(id);
    return { ok: true };
  }

  @Get('notifications/list')
  async getNotifications(@Req() req: Request & { user?: any }, @Query('unread') unread?: string) {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedException('User context missing');
    return this.alertsService.getUserNotifications(userId, unread === 'true');
  }

  @Patch('notifications/:id/read')
  async markRead(@Param('id') id: string) {
    return this.alertsService.markNotificationRead(id);
  }

  @Patch('notifications/read-all')
  async markAllRead(@Req() req: Request & { user?: any }) {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedException('User context missing');
    return this.alertsService.markAllNotificationsRead(userId);
  }
}
