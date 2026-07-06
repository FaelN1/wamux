import { BadRequestException, Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { zSettingsUpdate } from '@wamux/shared';
import { GlobalApiKeyGuard } from '../common/guards/global-api-key.guard';
import { SettingsService } from './settings.service';

@Controller('settings')
@UseGuards(GlobalApiKeyGuard)
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  get() {
    return this.settings.get();
  }

  @Put()
  async update(@Body() body: unknown) {
    const parsed = zSettingsUpdate.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      );
    }
    return this.settings.update(parsed.data);
  }
}
