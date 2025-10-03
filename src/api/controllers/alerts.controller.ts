import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AlertsService } from '../services/alerts.service';

@Controller('alerts')
export class AlertsController {
  constructor(private readonly alertsService: AlertsService) {}

  @Post()
  @Throttle({ default: { limit: 20, ttl: 60000 } }) // 20 alerts per minute
  async create(@Body() body: {
    userId: string;
    tokenAddress: string;
    label?: string;
    condition: any;
    channels?: string[];
    cooldownMinutes?: number;
  }) {
    return this.alertsService.createAlert(body.userId, body);
  }

  @Get()
  async list(@Query('userId') userId: string, @Query('tokenAddress') tokenAddress?: string) {
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
  async getNotifications(@Query('userId') userId: string, @Query('unread') unread?: string) {
    return this.alertsService.getUserNotifications(userId, unread === 'true');
  }

  @Patch('notifications/:id/read')
  async markRead(@Param('id') id: string) {
    return this.alertsService.markNotificationRead(id);
  }
}
