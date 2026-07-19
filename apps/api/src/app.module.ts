import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { LoggerModule } from 'nestjs-pino';
import configuration from './config/configuration';
import { DatabaseModule } from './database/database.module';
import { RedisModule } from './redis/redis.module';
import { ThrottleModule } from './throttle/throttle.module';
import { ProvidersModule } from './providers/providers.module';
import { SettingsModule } from './settings/settings.module';
import { SessionModule } from './session/session.module';
import { InstanceModule } from './instance/instance.module';
import { IdentityModule } from './identity/identity.module';
import { MediaModule } from './media/media.module';
import { MessagingModule } from './messaging/messaging.module';
import { PollModule } from './messaging/poll.module';
import { WebhookModule } from './webhook/webhook.module';
import { EventsModule } from './events/events.module';
import { LabelsModule } from './labels/labels.module';
import { ContactsModule } from './contacts/contacts.module';
import { NewsletterModule } from './newsletter/newsletter.module';
import { GroupsModule } from './groups/groups.module';
import { CommunitiesModule } from './communities/communities.module';
import { TemplatesModule } from './templates/templates.module';
import { AccountModule } from './account/account.module';
import { FlowsModule } from './flows/flows.module';
import { HistoryModule } from './history/history.module';
import { StatsModule } from './stats/stats.module';
import { HealthModule } from './health/health.module';
import { InboxModule } from './inbox/inbox.module';
import { ActivityLogModule } from './activity-log/activity-log.module';
import { ApiKeysModule } from './api-keys/api-keys.module';
import { McpModule } from './mcp/mcp.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        pinoHttp: {
          level: config.get<string>('logLevel'),
          transport:
            config.get<string>('env') === 'development'
              ? { target: 'pino-pretty', options: { singleLine: true } }
              : undefined,
          redact: ['req.headers.authorization', 'req.headers.apikey'],
        },
      }),
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('redis.host'),
          port: config.get<number>('redis.port'),
          password: config.get<string>('redis.password') || undefined,
        },
        defaultJobOptions: {
          attempts: 5,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: 1000,
          removeOnFail: 5000,
        },
      }),
    }),
    RedisModule,
    ThrottleModule,
    DatabaseModule,
    ActivityLogModule,
    ApiKeysModule,
    SettingsModule,
    IdentityModule,
    MediaModule,
    ProvidersModule,
    SessionModule,
    WebhookModule,
    PollModule,
    InstanceModule,
    EventsModule,
    MessagingModule,
    LabelsModule,
    ContactsModule,
    NewsletterModule,
    GroupsModule,
    CommunitiesModule,
    TemplatesModule,
    AccountModule,
    FlowsModule,
    HistoryModule,
    StatsModule,
    HealthModule,
    InboxModule,
    McpModule,
  ],
})
export class AppModule {}
