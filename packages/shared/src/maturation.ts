import { z } from 'zod';
import { ConnectionStatus, ProviderType } from './enums';

// ── maturação (aquecimento de chip) ─────────────────────────────────
//
// Um "plano de maturação" pega um pool de instâncias (números) e orquestra
// conversas entre elas ao longo de uma rampa de dias, com padrão humano:
// horários ativos, delays com jitter, "digitando…", leitura e reações.
// Complementa a camada anti-ban (que limita SAÍDA); aqui o objetivo é GERAR
// tráfego bidirecional legítimo para construir reputação do número.

export type MaturationPlanStatus = 'draft' | 'running' | 'paused' | 'completed';

/** Presets de intensidade da rampa. `custom` = usuário ajustou na mão. */
export type MaturationIntensity = 'gentle' | 'standard' | 'accelerated' | 'custom';

export interface MaturationActiveHours {
  /** hora local de início da janela ativa (0–23). */
  start: number;
  /** hora local de fim (exclusiva) da janela ativa (1–24). */
  end: number;
}

export interface MaturationConfig {
  intensity: MaturationIntensity;
  /** dias de rampa até o teto pleno. */
  durationDays: number;
  /** mensagens/dia POR NÚMERO no dia 1. */
  startMessagesPerDay: number;
  /** mensagens/dia POR NÚMERO no último dia da rampa. */
  targetMessagesPerDay: number;
  /** janela do dia em que as conversas acontecem. */
  activeHours: MaturationActiveHours;
  /**
   * Fuso da janela ativa (ex.: -3 para Brasília). Ausente = hora local do
   * servidor — que em Docker costuma ser UTC, então o painel envia o offset
   * do navegador ao criar o plano.
   */
  utcOffsetHours?: number;
  /** intervalo (s) mínimo/máximo entre turnos de conversa — sempre com jitter. */
  minDelaySec: number;
  maxDelaySec: number;
  /** emitir "digitando…" proporcional ao tamanho do texto antes de enviar. */
  simulateTyping: boolean;
  /** o receptor marca a conversa como lida após receber. */
  markAsRead: boolean;
  /** chance (0–1) de o receptor reagir com emoji à mensagem. */
  reactionChance: number;
  /**
   * chance (0–1) de um turno enviar mídia de stock (foto/vídeo) em vez de
   * texto. Requer uma chave do provedor grátis (Pexels) no servidor; sem
   * chave, o motor simplesmente manda texto. Degrada por engine.
   */
  mediaChance: number;
  /** tipos de mídia buscados no provedor de stock. */
  mediaTypes: MaturationMediaType[];
  /** chance (0–1) de um turno enviar uma enquete casual. */
  pollChance: number;
  /** chance (0–1) de um turno enviar uma localização. */
  locationChance: number;
  /** frases extras do usuário, misturadas ao banco padrão. */
  phrases?: string[];
}

/** Tipos de mídia de stock que o motor sabe buscar (Pexels tem foto e vídeo). */
export type MaturationMediaType = 'image' | 'video';

/** Presets tunáveis — mesma filosofia dos ANTI_BAN_PRESETS. */
export const MATURATION_PRESETS: Record<
  Exclude<MaturationIntensity, 'custom'>,
  MaturationConfig
> = {
  gentle: {
    intensity: 'gentle',
    durationDays: 21,
    startMessagesPerDay: 8,
    targetMessagesPerDay: 60,
    activeHours: { start: 8, end: 22 },
    minDelaySec: 90,
    maxDelaySec: 420,
    simulateTyping: true,
    markAsRead: true,
    reactionChance: 0.25,
    mediaChance: 0.12,
    mediaTypes: ['image'],
    pollChance: 0.06,
    locationChance: 0.04,
  },
  standard: {
    intensity: 'standard',
    durationDays: 14,
    startMessagesPerDay: 12,
    targetMessagesPerDay: 120,
    activeHours: { start: 8, end: 22 },
    minDelaySec: 45,
    maxDelaySec: 240,
    simulateTyping: true,
    markAsRead: true,
    reactionChance: 0.2,
    mediaChance: 0.15,
    mediaTypes: ['image', 'video'],
    pollChance: 0.08,
    locationChance: 0.05,
  },
  accelerated: {
    intensity: 'accelerated',
    durationDays: 7,
    startMessagesPerDay: 20,
    targetMessagesPerDay: 200,
    activeHours: { start: 7, end: 23 },
    minDelaySec: 30,
    maxDelaySec: 150,
    simulateTyping: true,
    markAsRead: true,
    reactionChance: 0.15,
    mediaChance: 0.18,
    mediaTypes: ['image', 'video'],
    pollChance: 0.1,
    locationChance: 0.06,
  },
};

/**
 * Meta de mensagens/dia POR NÚMERO no dia `dayIndex` (0-based): interpolação
 * geométrica entre start e target — cresce suave no começo (quando o número é
 * mais frágil) e acelera no fim. Fonte única para API e preview do painel.
 */
export function maturationTargetForDay(config: MaturationConfig, dayIndex: number): number {
  const { durationDays, startMessagesPerDay: start, targetMessagesPerDay: target } = config;
  if (dayIndex <= 0) return start;
  if (dayIndex >= durationDays - 1) return target;
  const ratio = target / Math.max(start, 1);
  return Math.round(start * Math.pow(ratio, dayIndex / (durationDays - 1)));
}

/** Total estimado de mensagens POR NÚMERO ao longo da rampa inteira. */
export function maturationTotalPerInstance(config: MaturationConfig): number {
  let total = 0;
  for (let d = 0; d < config.durationDays; d++) total += maturationTargetForDay(config, d);
  return total;
}

// ── banco de conversas padrão (PT-BR, tom casual) ───────────────────
// Aberturas → respostas encadeáveis → fechamentos. O processor monta
// "conversas" de N turnos alternando os dois lados; o banco do usuário
// (config.phrases) entra misturado às respostas.

export interface MaturationScript {
  openers: string[];
  replies: string[];
  closers: string[];
  /** mensagens só-emoji, intercaladas ocasionalmente. */
  emojis: string[];
  /** emojis usados como reação a uma mensagem recebida. */
  reactions: string[];
}

export const DEFAULT_MATURATION_SCRIPT: MaturationScript = {
  openers: [
    'Oi, tudo bem?',
    'E aí, como você tá?',
    'Bom dia! Tudo certo por aí?',
    'Oi! Sumido(a), hein?',
    'Opa, tudo tranquilo?',
    'Oi, tudo bem com você?',
    'E aí, novidades?',
    'Oi! Conseguiu resolver aquilo?',
    'Boa tarde! Tudo em ordem?',
    'Oi, você viu minha mensagem ontem?',
  ],
  replies: [
    'Tudo sim, e você?',
    'Tudo certo por aqui!',
    'Tô bem, graças a Deus. E aí?',
    'Na correria, mas indo. Rs',
    'Sim, deu tudo certo no final.',
    'Ainda não, mas tô resolvendo hoje.',
    'Verdade! O tempo tá voando.',
    'Boa! Depois me conta como foi.',
    'Sim sim, te mando mais tarde.',
    'Combinado então.',
    'Perfeito, obrigado(a)!',
    'Hahaha com certeza.',
    'Nossa, nem me fala…',
    'Depois a gente marca algo sim.',
    'Pode deixar, vou ver isso.',
    'Legal demais! Fico feliz.',
    'Sério? Não sabia disso.',
    'Entendi. Faz sentido.',
    'Também acho.',
    'Qualquer coisa me chama.',
  ],
  closers: [
    'Bom, vou indo aqui. Falamos depois!',
    'Beleza, até mais!',
    'Vou correr aqui, a gente se fala!',
    'Fechou. Abraço!',
    'Boa noite! 😴',
    'Valeu! Até amanhã.',
    'Tmj! 👊',
  ],
  emojis: ['😂', '👍', '🙌', '😅', 'kkkk', '❤️', '👏👏', '😄'],
  reactions: ['👍', '❤️', '😂', '😮', '🙏', '👏'],
};

// ── conteúdo de mídia / interativos ─────────────────────────────────
// Mídia (foto/vídeo) vem de um provedor de stock grátis (Pexels): buscamos
// por um destes termos casuais e mandamos a URL direta. Enquete e localização
// são geradas destes bancos — sem precisar de arquivo nem de API.

/** Termos de busca casuais para o provedor de stock (foto/vídeo). */
export const MEDIA_SEARCH_TERMS = [
  'cachorro',
  'gato',
  'comida',
  'café',
  'praia',
  'pôr do sol',
  'cidade',
  'natureza',
  'viagem',
  'flores',
  'montanha',
  'pizza',
  'futebol',
  'carro',
  'música',
  'trabalho',
  'academia',
  'chuva',
];

/** Legendas casuais para a mídia (pode ir sem legenda também). */
export const MEDIA_CAPTIONS = [
  '',
  '',
  'Olha isso 😍',
  'Achei massa',
  'kkkk',
  'Que tal?',
  'Tô querendo um desses',
  'Bom demais',
  'Vem cá ver',
  'Saudade disso',
];

/** Enquetes casuais (pergunta + opções). */
export const POLL_TOPICS: Array<{ question: string; options: string[] }> = [
  {
    question: 'Bora marcar algo esse fim de semana?',
    options: ['Bora!', 'Semana que vem', 'Tô fora'],
  },
  { question: 'Qual a boa pra hoje?', options: ['Cinema', 'Comer fora', 'Ficar em casa'] },
  { question: 'Café ou chá?', options: ['Café ☕', 'Chá 🍵', 'Os dois'] },
  { question: 'Praia ou montanha?', options: ['Praia 🏖️', 'Montanha ⛰️'] },
  { question: 'Melhor dia pra reunião?', options: ['Segunda', 'Quarta', 'Sexta'] },
  {
    question: 'Pizza de quê?',
    options: ['Calabresa', 'Portuguesa', 'Marguerita', 'Quatro queijos'],
  },
  { question: 'Vamos de qual filme?', options: ['Ação', 'Comédia', 'Terror', 'Tanto faz'] },
];

/** Localizações reais (pontos conhecidos no Brasil) para variar o conteúdo. */
export const MATURATION_LOCATIONS: Array<{
  name: string;
  address: string;
  latitude: number;
  longitude: number;
}> = [
  { name: 'Av. Paulista', address: 'São Paulo, SP', latitude: -23.5614, longitude: -46.6559 },
  {
    name: 'Praia de Copacabana',
    address: 'Rio de Janeiro, RJ',
    latitude: -22.9711,
    longitude: -43.1822,
  },
  {
    name: 'Praça da Liberdade',
    address: 'Belo Horizonte, MG',
    latitude: -19.9319,
    longitude: -43.9386,
  },
  {
    name: 'Mercado Central',
    address: 'Belo Horizonte, MG',
    latitude: -19.9227,
    longitude: -43.9408,
  },
  { name: 'Elevador Lacerda', address: 'Salvador, BA', latitude: -12.9737, longitude: -38.5137 },
  { name: 'Beira Mar', address: 'Fortaleza, CE', latitude: -3.7237, longitude: -38.4931 },
  { name: 'Parque Ibirapuera', address: 'São Paulo, SP', latitude: -23.5874, longitude: -46.6576 },
];

// ── eventos / progresso (leitura do painel) ─────────────────────────

export type MaturationEventKind = 'sent' | 'read' | 'reaction' | 'skip' | 'info' | 'error';

/** Entrada do feed "ao vivo" de um plano (ring buffer no servidor). */
export interface MaturationEventEntry {
  ts: number;
  kind: MaturationEventKind;
  /** nomes das instâncias envolvidas (para exibição). */
  from?: string;
  to?: string;
  /** texto enviado (truncado) ou descrição do evento. */
  text?: string;
}

/** Progresso de UM número dentro do plano, enriquecido pela API. */
export interface MaturationInstanceProgress {
  instanceId: string;
  name: string;
  provider: ProviderType;
  connectionStatus: ConnectionStatus | string;
  wid?: string | null;
  sentToday: number;
  targetToday: number;
  totalSent: number;
}

/** Plano como retornado pela API (config + progresso computado). */
export interface MaturationPlanDTO {
  id: string;
  name: string;
  status: MaturationPlanStatus;
  config: MaturationConfig;
  instanceIds: string[];
  createdAt: string;
  startedAt?: string | null;
  /** dia atual da rampa (0-based) — só faz sentido quando rodando/pausado. */
  dayIndex: number;
  /** epoch (ms) do próximo turno agendado, para countdown no painel. */
  nextTurnAt?: number | null;
  totalSent: number;
  instances: MaturationInstanceProgress[];
  events: MaturationEventEntry[];
}

// ── schemas Zod (contrato de entrada) ───────────────────────────────

export const zMaturationConfig = z
  .object({
    intensity: z.enum(['gentle', 'standard', 'accelerated', 'custom']),
    durationDays: z.number().int().min(1).max(90),
    startMessagesPerDay: z.number().int().min(1).max(1_000),
    targetMessagesPerDay: z.number().int().min(1).max(2_000),
    activeHours: z
      .object({
        start: z.number().int().min(0).max(23),
        end: z.number().int().min(1).max(24),
      })
      .refine((h) => h.end > h.start, 'activeHours.end deve ser maior que start'),
    utcOffsetHours: z.number().int().min(-12).max(14).optional(),
    minDelaySec: z.number().int().min(5).max(3_600),
    maxDelaySec: z.number().int().min(10).max(7_200),
    simulateTyping: z.boolean(),
    markAsRead: z.boolean(),
    reactionChance: z.number().min(0).max(1),
    mediaChance: z.number().min(0).max(1),
    mediaTypes: z.array(z.enum(['image', 'video'])).max(2),
    pollChance: z.number().min(0).max(1),
    locationChance: z.number().min(0).max(1),
    phrases: z.array(z.string().min(1).max(500)).max(200).optional(),
  })
  .refine((c) => c.maxDelaySec >= c.minDelaySec, 'maxDelaySec deve ser ≥ minDelaySec')
  .refine(
    (c) => c.targetMessagesPerDay >= c.startMessagesPerDay,
    'targetMessagesPerDay deve ser ≥ startMessagesPerDay',
  );

export const zCreateMaturationPlan = z.object({
  name: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[\p{L}0-9 _-]+$/u, 'apenas letras, números, espaço, _ ou -'),
  instanceIds: z.array(z.string().uuid()).min(2, 'selecione pelo menos 2 números'),
  config: zMaturationConfig,
});

export const zUpdateMaturationPlan = zCreateMaturationPlan.partial();

export type CreateMaturationPlanInput = z.infer<typeof zCreateMaturationPlan>;
export type UpdateMaturationPlanInput = z.infer<typeof zUpdateMaturationPlan>;
