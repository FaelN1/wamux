/**
 * Transportes de entrega de eventos por instância (Webhook,
 * WebSocket, RabbitMQ). Cada transporte tem seu próprio `enabled` + filtro de
 * eventos (vazio = todos). O catálogo de eventos em si é o `WEBHOOK_EVENTS`.
 */
export enum EventTransport {
  WEBHOOK = 'webhook',
  WEBSOCKET = 'websocket',
  RABBITMQ = 'rabbitmq',
}

/** Config comum a todo transporte de stream. */
export interface StreamTransportConfig {
  enabled: boolean;
  /** eventos entregues (vazio = todos). */
  events: string[];
}

/** Webhook = stream + URL de destino. */
export interface WebhookTransportConfig extends StreamTransportConfig {
  url: string;
}

/** Configuração completa de eventos de uma instância. */
export interface InstanceEventsConfig {
  webhook: WebhookTransportConfig;
  websocket: StreamTransportConfig;
  rabbitmq: StreamTransportConfig;
}

export const EMPTY_EVENTS_CONFIG: InstanceEventsConfig = {
  webhook: { enabled: false, url: '', events: [] },
  websocket: { enabled: false, events: [] },
  rabbitmq: { enabled: false, events: [] },
};

/** Metadados de exibição dos transportes (para a nav "Eventos" do painel). */
export interface EventTransportMeta {
  value: EventTransport;
  label: string;
  description: string;
}

export const EVENT_TRANSPORTS: EventTransportMeta[] = [
  {
    value: EventTransport.WEBHOOK,
    label: 'Webhook',
    description: 'Entrega cada evento via HTTP POST na sua URL.',
  },
  {
    value: EventTransport.WEBSOCKET,
    label: 'WebSocket',
    description: 'Stream em tempo real: seu app conecta e recebe os eventos na hora.',
  },
  {
    value: EventTransport.RABBITMQ,
    label: 'RabbitMQ',
    description: 'Publica cada evento num exchange do broker, por routing key.',
  },
];
