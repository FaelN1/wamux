import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InstanceEntity } from '../instance/instance.entity';
import { SessionEntity } from '../session/session.entity';
import { MessageLogEntity } from '../messaging/message-log.entity';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get<string>('db.host'),
        port: config.get<number>('db.port'),
        username: config.get<string>('db.user'),
        password: config.get<string>('db.password'),
        database: config.get<string>('db.name'),
        entities: [InstanceEntity, SessionEntity, MessageLogEntity],
        // Em produção: false + migrations. Em dev: sincroniza o schema.
        synchronize: config.get<boolean>('db.synchronize'),
        autoLoadEntities: true,
      }),
    }),
  ],
})
export class DatabaseModule {}
