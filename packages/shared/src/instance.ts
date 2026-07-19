import { z } from 'zod';
import { ProviderType, WebhookEvent } from './enums';
import type { InstanceEventsConfig } from './events';

/** Metadados de exibição de cada engine (usado pelo painel). */
export interface ProviderMeta {
  value: ProviderType;
  label: string;
  official: boolean;
}

export const PROVIDERS: ProviderMeta[] = [
  { value: ProviderType.BAILEYS, label: 'Baileys', official: false },
  { value: ProviderType.WEBJS, label: 'whatsapp-web.js', official: false },
  { value: ProviderType.CLOUD_API, label: 'Cloud API (oficial)', official: true },
  { value: ProviderType.WHATSMEOW, label: 'whatsmeow (Go)', official: false },
];

/** Metadados dos eventos de webhook (fonte única para o painel). */
export interface WebhookEventMeta {
  value: WebhookEvent;
  label: string;
  description: string;
  category: string;
  /** Equivalente no Evolution (referência para quem vem de lá). */
  evolution?: string;
}

export const WEBHOOK_EVENTS: WebhookEventMeta[] = [
  // ── Conexão ──
  {
    value: WebhookEvent.CONNECTION_UPDATE,
    label: 'Conexão',
    description: 'Mudanças de status: connecting, connected, logout.',
    category: 'Conexão',
    evolution: 'CONNECTION_UPDATE',
  },
  {
    value: WebhookEvent.QRCODE_UPDATED,
    label: 'QR Code',
    description: 'Novo QR Code gerado para parear.',
    category: 'Conexão',
    evolution: 'QRCODE_UPDATED',
  },
  {
    value: WebhookEvent.LOGOUT_INSTANCE,
    label: 'Logout',
    description: 'A sessão foi encerrada (precisa reparear).',
    category: 'Conexão',
    evolution: 'LOGOUT_INSTANCE',
  },
  // ── Mensagens ──
  {
    value: WebhookEvent.MESSAGE_RECEIVED,
    label: 'Mensagens recebidas',
    description: 'Toda mensagem nova que chega na instância.',
    category: 'Mensagens',
    evolution: 'MESSAGES_UPSERT',
  },
  {
    value: WebhookEvent.MESSAGE_SENT,
    label: 'Mensagens enviadas',
    description: 'Mensagens que a própria instância enviou (inclusive por outro aparelho).',
    category: 'Mensagens',
    evolution: 'SEND_MESSAGE',
  },
  {
    value: WebhookEvent.MESSAGE_STATUS,
    label: 'Status de mensagem',
    description: 'Entregue, lido, reproduzido — das mensagens enviadas.',
    category: 'Mensagens',
    evolution: 'MESSAGES_UPDATE',
  },
  {
    value: WebhookEvent.MESSAGE_DELETED,
    label: 'Mensagens apagadas',
    description: 'Mensagem apagada para todos.',
    category: 'Mensagens',
    evolution: 'MESSAGES_DELETE',
  },
  {
    value: WebhookEvent.MESSAGE_EDITED,
    label: 'Mensagens editadas',
    description: 'Mensagem editada (novo texto normalizado).',
    category: 'Mensagens',
    evolution: 'MESSAGES_EDITED',
  },
  {
    value: WebhookEvent.MESSAGE_REACTION,
    label: 'Reações',
    description: 'Reação (emoji) adicionada/removida numa mensagem.',
    category: 'Mensagens',
  },
  {
    value: WebhookEvent.POLL_VOTE,
    label: 'Votos de enquete',
    description: 'Voto em enquete, descriptografado e normalizado.',
    category: 'Mensagens',
  },
  // ── Chats & Contatos ──
  {
    value: WebhookEvent.CHATS_UPSERT,
    label: 'Novos chats',
    description: 'Um chat novo apareceu.',
    category: 'Chats & Contatos',
    evolution: 'CHATS_UPSERT',
  },
  {
    value: WebhookEvent.CHATS_UPDATE,
    label: 'Chats atualizados',
    description: 'Mudança em um chat (não lidas, arquivado, etc.).',
    category: 'Chats & Contatos',
    evolution: 'CHATS_UPDATE',
  },
  {
    value: WebhookEvent.CHATS_DELETE,
    label: 'Chats apagados',
    description: 'Um chat foi removido.',
    category: 'Chats & Contatos',
    evolution: 'CHATS_DELETE',
  },
  {
    value: WebhookEvent.CONTACTS_UPSERT,
    label: 'Novos contatos',
    description: 'Contato novo sincronizado.',
    category: 'Chats & Contatos',
    evolution: 'CONTACTS_UPSERT',
  },
  {
    value: WebhookEvent.CONTACTS_UPDATE,
    label: 'Contatos atualizados',
    description: 'Nome, foto ou status de um contato mudou.',
    category: 'Chats & Contatos',
    evolution: 'CONTACTS_UPDATE',
  },
  // ── Grupos ──
  {
    value: WebhookEvent.GROUPS_UPSERT,
    label: 'Novos grupos',
    description: 'A instância entrou em / criou um grupo.',
    category: 'Grupos',
    evolution: 'GROUPS_UPSERT',
  },
  {
    value: WebhookEvent.GROUPS_UPDATE,
    label: 'Grupos atualizados',
    description: 'Assunto, descrição ou configurações do grupo mudaram.',
    category: 'Grupos',
    evolution: 'GROUP_UPDATE',
  },
  {
    value: WebhookEvent.GROUP_PARTICIPANTS_UPDATE,
    label: 'Participantes de grupo',
    description: 'Alguém entrou, saiu, virou admin, etc.',
    category: 'Grupos',
    evolution: 'GROUP_PARTICIPANTS_UPDATE',
  },
  // ── Comunidades ──
  {
    value: WebhookEvent.COMMUNITY_PARTICIPANTS_SYNCED,
    label: 'Participantes de comunidade sincronizados',
    description: 'Metadados e lista de participantes de uma comunidade foram (re)sincronizados.',
    category: 'Comunidades',
  },
  {
    value: WebhookEvent.COMMUNITY_ANNOUNCEMENT_DISCOVERED,
    label: 'Grupo de anúncios identificado',
    description:
      'O subgrupo de anúncios de uma comunidade foi resolvido (a descoberta é assíncrona).',
    category: 'Comunidades',
  },
  // ── Presença & Chamadas ──
  {
    value: WebhookEvent.PRESENCE_UPDATE,
    label: 'Presença',
    description: 'Digitando, gravando, online/offline.',
    category: 'Presença & Chamadas',
    evolution: 'PRESENCE_UPDATE',
  },
  {
    value: WebhookEvent.CALL_RECEIVED,
    label: 'Chamadas',
    description: 'Chamada de voz/vídeo recebida.',
    category: 'Presença & Chamadas',
    evolution: 'CALL',
  },
  // ── Etiquetas ──
  {
    value: WebhookEvent.LABELS_EDIT,
    label: 'Etiquetas',
    description: 'Etiqueta criada/renomeada/removida (WhatsApp Business).',
    category: 'Etiquetas',
    evolution: 'LABELS_EDIT',
  },
  {
    value: WebhookEvent.LABELS_ASSOCIATION,
    label: 'Etiqueta ↔ chat',
    description: 'Etiqueta associada/desassociada de um chat.',
    category: 'Etiquetas',
    evolution: 'LABELS_ASSOCIATION',
  },
  // ── Templates (Cloud API) ──
  {
    value: WebhookEvent.TEMPLATE_STATUS_UPDATE,
    label: 'Template: status',
    description: 'Aprovação/rejeição/pausa de um template HSM (Cloud API).',
    category: 'Templates',
    evolution: 'TEMPLATE_STATUS_UPDATE',
  },
  {
    value: WebhookEvent.TEMPLATE_QUALITY_UPDATE,
    label: 'Template: qualidade',
    description: 'Mudança de score de qualidade (GREEN/YELLOW/RED) de um template.',
    category: 'Templates',
    evolution: 'TEMPLATE_QUALITY_UPDATE',
  },
  {
    value: WebhookEvent.TEMPLATE_CATEGORY_UPDATE,
    label: 'Template: categoria',
    description: 'Recategorização de um template (ex.: UTILITY → MARKETING).',
    category: 'Templates',
    evolution: 'TEMPLATE_CATEGORY_UPDATE',
  },
  // ── Sistema ──
  {
    value: WebhookEvent.ANTIBAN_ALERT,
    label: 'Alerta anti-ban',
    description: 'Freio automático (auto-throttle) acionado por sinais de risco.',
    category: 'Sistema',
  },
  {
    value: WebhookEvent.ERROR,
    label: 'Erros',
    description: 'Falhas reportadas pela engine.',
    category: 'Sistema',
  },
];

/** Instância como retornada pela API (a `apiKey` só vem na criação). */
export interface InstanceDTO {
  id: string;
  name: string;
  provider: ProviderType;
  status: string;
  wid?: string | null;
  webhookUrl?: string | null;
  /** eventos que a instância recebe no webhook (vazio = todos). */
  webhookEvents?: string[];
  /** config de eventos por transporte (webhook + websocket + rabbitmq). */
  events?: InstanceEventsConfig;
  createdAt: string;
  /** ISO da última mensagem (enviada/recebida) — null se nunca houve. */
  lastActivityAt?: string | null;
  apiKey?: string;
  liveStatus?: string | null;
}

/** Resposta do endpoint de QR. */
export interface QrResponse {
  qr: string | null;
  qrImage: string | null;
  message?: string;
}

// ── schemas Zod (validação em runtime / contrato de entrada) ──
export const zProvider = z.nativeEnum(ProviderType);

export const zCreateInstance = z.object({
  name: z
    .string()
    .min(1)
    .regex(/^[a-zA-Z0-9_-]+$/, 'apenas letras, números, _ ou -'),
  provider: zProvider,
  config: z.record(z.unknown()).optional(),
  webhookUrl: z.string().url().optional(),
  webhookEvents: z.array(z.string()).optional(),
});

export type CreateInstanceInput = z.infer<typeof zCreateInstance>;
