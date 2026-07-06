import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MessageAckStatus, MessageStatusUpdate, NormalizedMessage } from '@wamux/shared';
import { MessageLogEntity } from './message-log.entity';
import { nextAck } from './message-ack';

/** Escrita centralizada do log de mensagens + transições de ack. */
@Injectable()
export class MessageLogService {
  private readonly logger = new Logger(MessageLogService.name);

  constructor(
    @InjectRepository(MessageLogEntity) private readonly repo: Repository<MessageLogEntity>,
  ) {}

  /** Grava o envio assim que a lib devolve o messageId (ack = server_ack). */
  async recordOutbound(m: {
    id: string;
    instanceId: string;
    chatId: string;
    clientMessageId?: string;
  }): Promise<void> {
    if (!m.id) return;
    await this.repo.upsert(
      {
        id: m.id,
        instanceId: m.instanceId,
        chatId: m.chatId,
        fromMe: true,
        clientMessageId: m.clientMessageId ?? null,
        ack: MessageAckStatus.SERVER,
        serverAckAt: new Date(),
      },
      ['id'],
    );
  }

  /** Log leve de entrada (auditoria + lastActivity). */
  async recordInbound(m: NormalizedMessage): Promise<void> {
    if (!m.id) return;
    await this.repo.upsert(
      {
        id: m.id,
        instanceId: m.instanceId,
        chatId: m.chatId,
        fromMe: false,
        type: m.type,
        text: m.text ?? null,
        source: 'live',
        timestamp: m.timestamp ? String(m.timestamp) : null,
      },
      ['id'],
    );
  }

  /** Aplica um message.status monotonicamente e carimba o timestamp da transição. */
  async applyStatus(u: MessageStatusUpdate): Promise<void> {
    const row = await this.repo.findOne({ where: { id: u.messageId } });
    if (!row) return; // status de mensagem que não logamos
    const ack = nextAck(row.ack, u.status);
    if (ack === row.ack) return; // não regrediu → idempotente
    const at = new Date(u.timestamp * 1000);
    await this.repo.update(
      { id: u.messageId },
      {
        ack,
        ...(ack === MessageAckStatus.SERVER ? { serverAckAt: at } : {}),
        ...(ack === MessageAckStatus.DELIVERED ? { deliveredAt: at } : {}),
        ...(ack === MessageAckStatus.READ || ack === MessageAckStatus.PLAYED ? { readAt: at } : {}),
        ...(ack === MessageAckStatus.FAILED ? { failedAt: at } : {}),
      },
    );
  }

  /** Marca falha definitiva de envio (esgotou retries na fila outbound). */
  async markFailed(messageId: string, reason: string): Promise<void> {
    await this.repo.update(
      { id: messageId },
      { ack: MessageAckStatus.FAILED, failedAt: new Date(), failureReason: reason },
    );
  }

  async get(instanceId: string, messageId: string): Promise<MessageLogEntity | null> {
    return this.repo.findOne({ where: { id: messageId, instanceId } });
  }
}
