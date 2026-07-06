import { MessageAckStatus } from '@wamux/shared';

const RANK: Record<MessageAckStatus, number> = {
  [MessageAckStatus.PENDING]: 0,
  [MessageAckStatus.SERVER]: 1,
  [MessageAckStatus.DELIVERED]: 2,
  [MessageAckStatus.READ]: 3,
  [MessageAckStatus.PLAYED]: 4,
  [MessageAckStatus.FAILED]: 99,
};

/**
 * Transição monotônica de ack: só avança (um `delivered` atrasado não
 * rebaixa um `read`). `failed` só se aplica antes da entrega.
 */
export function nextAck(current: MessageAckStatus, incoming: MessageAckStatus): MessageAckStatus {
  if (incoming === MessageAckStatus.FAILED) {
    return RANK[current] >= RANK[MessageAckStatus.DELIVERED] ? current : MessageAckStatus.FAILED;
  }
  return RANK[incoming] > RANK[current] ? incoming : current;
}
