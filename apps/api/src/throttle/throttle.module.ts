import { Global, Module } from '@nestjs/common';
import { RateLimiterService } from './rate-limiter.service';
import { IdempotencyService } from './idempotency.service';
import { InboundDedupService } from './inbound-dedup.service';
import { AntiBanService } from './anti-ban.service';
import { RiskMonitorService } from './risk-monitor.service';

/**
 * Primitivas de controle de envio (anti-ban + confiabilidade): rate limiter,
 * idempotência, dedup de entrada, e a camada anti-ban.
 * Globais para uso em qualquer módulo.
 */
@Global()
@Module({
  providers: [
    RateLimiterService,
    IdempotencyService,
    InboundDedupService,
    AntiBanService,
    RiskMonitorService,
  ],
  exports: [
    RateLimiterService,
    IdempotencyService,
    InboundDedupService,
    AntiBanService,
    RiskMonitorService,
  ],
})
export class ThrottleModule {}
