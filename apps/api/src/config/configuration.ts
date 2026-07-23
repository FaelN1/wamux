/**
 * Configuração central lida de variáveis de ambiente (.env).
 * Consumida via ConfigService em toda a aplicação.
 */
export default () => ({
  env: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  logLevel: process.env.LOG_LEVEL ?? 'info',
  workerId: process.env.WORKER_ID ?? 'worker-1',
  globalApiKey: process.env.GLOBAL_API_KEY ?? 'change-me',

  db: {
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? '5432', 10),
    user: process.env.DB_USER ?? 'whatsapp',
    password: process.env.DB_PASSWORD ?? 'whatsapp',
    name: process.env.DB_NAME ?? 'whatsapp_api',
    synchronize: (process.env.DB_SYNCHRONIZE ?? 'false') === 'true',
  },

  redis: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
    password: process.env.REDIS_PASSWORD ?? '',
  },

  // Rate limit de envio por instância (token bucket): ritmo sustentado
  // (perSec) + rajada (burst). Anti-ban.
  rateLimit: {
    perSec: parseFloat(process.env.RATE_LIMIT_PER_SEC ?? '1'),
    burst: parseInt(process.env.RATE_LIMIT_BURST ?? '5', 10),
  },

  // Webhook global: aplicado às instâncias sem webhook próprio.
  webhookGlobal: {
    enabled: (process.env.WEBHOOK_GLOBAL_ENABLED ?? 'false') === 'true',
    url: process.env.WEBHOOK_GLOBAL_URL ?? '',
  },

  // RabbitMQ (transporte de eventos). Sem URI = publisher inativo.
  rabbitmq: {
    uri: process.env.RABBITMQ_URI ?? '',
    exchange: process.env.RABBITMQ_EXCHANGE ?? 'wamux.events',
  },

  // URL pública deste gateway (para montar a URL do WebSocket no painel).
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? '',

  // Pipeline de mídia. store=local (default) grava em disco e serve
  // pela rota do gateway; store=s3 usa um bucket S3 (ou compatível —
  // MinIO, Spaces) pros bytes, mas a URL servida continua sendo a rota
  // do gateway (ver S3MediaStore.url()) — nunca presigned.
  media: {
    store: process.env.MEDIA_STORE ?? 'local',
    maxSizeMb: parseInt(process.env.MEDIA_MAX_SIZE_MB ?? '100', 10),
    local: { dir: process.env.MEDIA_LOCAL_DIR ?? './data/media' },
    s3: {
      endpoint: process.env.MEDIA_S3_ENDPOINT ?? '',
      region: process.env.MEDIA_S3_REGION ?? 'us-east-1',
      bucket: process.env.MEDIA_S3_BUCKET ?? '',
      accessKeyId: process.env.MEDIA_S3_ACCESS_KEY_ID ?? '',
      secretAccessKey: process.env.MEDIA_S3_SECRET_ACCESS_KEY ?? '',
      // true = path-style (bucket no path da URL) — necessário pro MinIO e
      // pela maioria dos serviços S3-compatíveis; AWS S3 real costuma usar
      // virtual-hosted style (false).
      forcePathStyle: (process.env.MEDIA_S3_FORCE_PATH_STYLE ?? 'true') === 'true',
    },
  },

  // Identidade mostrada no WhatsApp ("Aparelhos conectados") — Baileys.
  device: {
    client: process.env.SESSION_PHONE_CLIENT ?? 'WAMux',
    browser: process.env.SESSION_PHONE_NAME ?? 'Chrome',
  },

  whatsmeow: {
    // URL do sidecar Go (wamux_go, em services/whatsmeow/).
    url: process.env.WHATSMEOW_URL ?? 'http://localhost:8081',
    // MASTER_API_KEY do serviço Go (usada para provisionar instâncias).
    masterKey: process.env.WHATSMEOW_MASTER_KEY ?? '',
    // Base URL pública deste gateway, usada como destino do webhook que o
    // serviço Go chama de volta (…/api/webhooks/whatsmeow/:id).
    callbackBaseUrl: process.env.WHATSMEOW_CALLBACK_BASE ?? 'http://localhost:3000',
  },

  cloudApi: {
    version: process.env.CLOUD_API_VERSION ?? 'v21.0',
    baseUrl: process.env.CLOUD_API_BASE_URL ?? 'https://graph.facebook.com',
    verifyToken: process.env.CLOUD_API_VERIFY_TOKEN ?? '',
  },

  // Maturação (aquecimento de chip). Para variar as conversas com foto/vídeo
  // o motor busca mídia num provedor de stock grátis (Pexels — pegue a chave
  // em https://www.pexels.com/api/, grátis). Sem chave, o motor manda só
  // texto (+ enquete/localização, que são geradas sem API).
  maturation: {
    pexelsApiKey: process.env.PEXELS_API_KEY ?? '',
  },

  // Persistência do Inbox (contato-chat/mensagens). Opt-in por privacidade —
  // default off. Nomes espelham as flags DATABASE_SAVE_* da Evolution API
  // (familiaridade pra quem migra). Ver docs/inbox-persistencia-handoff.md.
  persistence: {
    contacts: (process.env.DATABASE_SAVE_DATA_CONTACTS ?? 'false') === 'true',
    newMessage: (process.env.DATABASE_SAVE_DATA_NEW_MESSAGE ?? 'false') === 'true',
    messageUpdate: (process.env.DATABASE_SAVE_MESSAGE_UPDATE ?? 'false') === 'true',
    historic: (process.env.DATABASE_SAVE_DATA_HISTORIC ?? 'false') === 'true',
    // Higiene multi-tenant.
    retentionDays: parseInt(process.env.DATABASE_MESSAGE_RETENTION_DAYS ?? '0', 10), // 0 = sem expurgo
    storeMediaBody: (process.env.DATABASE_SAVE_MEDIA_BODY ?? 'false') === 'true', // grava url de mídia at-rest
  },

  // Painel de Logs/Atividade — opt-in, default off. Escopo admin (não por
  // instância). Ver docs/logs-painel-handoff.md.
  activityLog: {
    enabled: (process.env.ACTIVITY_LOG_ENABLED ?? 'false') === 'true',
    // 0 = nunca expurga.
    retentionDays: parseInt(process.env.ACTIVITY_LOG_RETENTION_DAYS ?? '0', 10),
    // GET não loga por default (alto volume, baixo valor de auditoria) —
    // POST/PUT/PATCH/DELETE sempre logam quando a flag acima está ligada.
    includeGetRequests: (process.env.ACTIVITY_LOG_INCLUDE_GET ?? 'false') === 'true',
  },
});
