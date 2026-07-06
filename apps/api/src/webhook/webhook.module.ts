import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InstanceEntity } from '../instance/instance.entity';
import { WEBHOOK_QUEUE } from './webhook.constants';
import { WebhookService } from './webhook.service';
import { WebhookProcessor } from './webhook.processor';
import { WebhookCircuitBreakerService } from './circuit-breaker.service';

/**
 * Entrega OUTBOUND de eventos (gateway -> webhook do cliente).
 * A recepção INBOUND (Cloud API / whatsmeow -> gateway) fica no InstanceModule,
 * pois precisa do gerenciador de instâncias para normalizar e re-emitir.
 */
@Module({
  imports: [
    BullModule.registerQueue({ name: WEBHOOK_QUEUE }),
    TypeOrmModule.forFeature([InstanceEntity]),
  ],
  providers: [WebhookService, WebhookProcessor, WebhookCircuitBreakerService],
  exports: [WebhookService, BullModule],
})
export class WebhookModule {}
