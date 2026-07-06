import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as amqp from 'amqplib';

/**
 * Publisher de eventos no RabbitMQ. Publica num exchange `topic` com routing
 * key `<instanceId>.<event>` — o consumidor faz bind pelo padrão que quiser
 * (ex.: `*.message.received`, `<id>.#`). Sem `RABBITMQ_URI` fica inativo.
 * Reconecta sozinho se o broker cair.
 */
@Injectable()
export class RabbitmqService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RabbitmqService.name);
  // O tipo de retorno de amqp.connect mudou entre versões (Connection →
  // ChannelModel); inferimos para não acoplar a uma versão específica.
  private conn?: Awaited<ReturnType<typeof amqp.connect>>;
  private channel?: amqp.Channel;
  private uri = '';
  private exchange = 'wamux.events';
  private closing = false;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    this.uri = this.config.get<string>('rabbitmq.uri') ?? '';
    this.exchange = this.config.get<string>('rabbitmq.exchange') ?? 'wamux.events';
    if (!this.uri) {
      this.logger.log('RABBITMQ_URI não configurada — publisher RabbitMQ inativo.');
      return;
    }
    await this.connect();
  }

  async onModuleDestroy(): Promise<void> {
    this.closing = true;
    try {
      await this.channel?.close();
      await this.conn?.close();
    } catch {
      /* ignora erros no shutdown */
    }
  }

  private async connect(): Promise<void> {
    try {
      this.conn = await amqp.connect(this.uri);
      this.channel = await this.conn.createChannel();
      await this.channel.assertExchange(this.exchange, 'topic', { durable: true });
      this.conn.on('close', () => {
        this.channel = undefined;
        this.conn = undefined;
        if (!this.closing) {
          this.logger.warn('RabbitMQ desconectado; reconectando em 5s');
          setTimeout(() => void this.connect(), 5000);
        }
      });
      this.conn.on('error', (e) => this.logger.warn(`RabbitMQ erro: ${e.message}`));
      this.logger.log(`RabbitMQ conectado (exchange "${this.exchange}")`);
    } catch (e) {
      this.logger.warn(`RabbitMQ indisponível (${(e as Error).message}); retry em 5s`);
      setTimeout(() => void this.connect(), 5000);
    }
  }

  get connected(): boolean {
    return !!this.channel;
  }

  get exchangeName(): string {
    return this.exchange;
  }

  publish(instanceId: string, event: string, payload: unknown): void {
    if (!this.channel) return;
    const routingKey = `${instanceId}.${event}`;
    const body = Buffer.from(
      JSON.stringify({ instanceId, event, data: payload, timestamp: Date.now() }),
    );
    try {
      this.channel.publish(this.exchange, routingKey, body, {
        contentType: 'application/json',
        persistent: true,
      });
    } catch (e) {
      this.logger.warn(`publish RabbitMQ falhou: ${(e as Error).message}`);
    }
  }
}
