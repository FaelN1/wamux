import { randomUUID } from 'node:crypto';
import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { InstanceManagerService } from '../instance/instance-manager.service';
import { InstanceService } from '../instance/instance.service';
import { FlowSessionFilter, FlowSessionService } from '../flow-sessions/flow-session.service';
import { FlowSessionEntity } from '../flow-sessions/flow-session.entity';
import {
  FlowEndpointHttpRequest,
  FlowTokenInvalidError,
  ProviderRequestError,
  WhatsAppProvider,
} from '../providers/provider.interface';
import {
  CreateFlowInput,
  CreateFlowResult,
  Flow,
  FlowAsset,
  FlowDataExchangeRequest,
  FlowEncryptionInfo,
  SendFlowInput,
  SendResult,
  SetFlowEncryptionInput,
  UpdateFlowMetadataInput,
} from '../providers/provider.types';
import { signWebhook } from '../webhook/signature';

/** Chave em `instance.config` com a URL do serviço do integrador (troca de dados). */
const DATA_EXCHANGE_URL_KEY = 'flowDataExchangeUrl';

/** WhatsApp Flows (Cloud API). Capability guard → 501 nas outras engines. */
@Injectable()
export class FlowsService {
  private readonly logger = new Logger(FlowsService.name);

  constructor(
    private readonly manager: InstanceManagerService,
    private readonly instances: InstanceService,
    private readonly sessions: FlowSessionService,
    private readonly config: ConfigService,
  ) {}

  async list(id: string): Promise<Flow[]> {
    return (await this.cap(id)).listFlows!();
  }
  async get(id: string, flowId: string): Promise<Flow> {
    return (await this.cap(id)).getFlow!(flowId);
  }
  async create(id: string, input: CreateFlowInput): Promise<CreateFlowResult> {
    return (await this.cap(id)).createFlow!(input);
  }
  async updateJson(
    id: string,
    flowId: string,
    flowJson: string,
  ): Promise<{ validation_errors: unknown[] }> {
    return (await this.cap(id)).updateFlowJson!(flowId, flowJson);
  }
  async updateMetadata(id: string, flowId: string, input: UpdateFlowMetadataInput): Promise<void> {
    if (!Object.values(input).some((v) => v != null)) {
      throw new BadRequestException('Informe ao menos um campo para atualizar.');
    }
    return (await this.cap(id)).updateFlowMetadata!(flowId, input);
  }
  async assets(id: string, flowId: string): Promise<FlowAsset[]> {
    return (await this.cap(id)).listFlowAssets!(flowId);
  }
  async json(id: string, flowId: string): Promise<{ flowJson: string | null }> {
    try {
      return { flowJson: await (await this.cap(id)).getFlowJson!(flowId) };
    } catch (e) {
      if (e instanceof ProviderRequestError) throw e;
      // falha ao baixar do CDN (URL expirada, rede) — não é erro do cliente nem 500 nosso.
      throw new BadGatewayException(`Não foi possível baixar o Flow JSON: ${(e as Error).message}`);
    }
  }
  async publish(id: string, flowId: string): Promise<void> {
    return (await this.cap(id)).publishFlow!(flowId);
  }
  async deprecate(id: string, flowId: string): Promise<void> {
    return (await this.cap(id)).deprecateFlow!(flowId);
  }
  async remove(id: string, flowId: string): Promise<void> {
    return (await this.cap(id)).deleteFlow!(flowId);
  }

  /**
   * Envia o Flow e abre a sessão de correlação. O `flowToken` é gerado aqui
   * quando o cliente não manda um — e sempre volta na resposta.
   */
  async send(id: string, input: SendFlowInput): Promise<SendResult & { flowToken: string }> {
    if (!!input.flowId === !!input.flowName) {
      throw new BadRequestException('Informe exatamente um de flowId ou flowName.');
    }
    const action = input.action ?? 'navigate';
    if (action === 'navigate' && !input.screen) {
      throw new BadRequestException('"screen" é obrigatório quando action=navigate.');
    }
    if (input.data && !Object.keys(input.data).length) {
      throw new BadRequestException('"data", quando presente, não pode ser vazio.');
    }
    const provider = await this.cap(id);
    const flowToken = input.flowToken ?? randomUUID();
    const result = await provider.sendFlow!({ ...input, flowToken });
    await this.sessions.recordSent(id, {
      flowToken,
      flowId: input.flowId,
      flowName: input.flowName,
      contact: result.to,
      messageId: result.id,
      mode: input.mode ?? 'published',
    });
    return { ...result, flowToken };
  }

  // ── criptografia / endpoint de troca de dados ──

  async getEncryption(id: string): Promise<FlowEncryptionInfo> {
    return (await this.cap(id)).getFlowEncryption!();
  }

  async setEncryption(id: string, input: SetFlowEncryptionInput): Promise<FlowEncryptionInfo> {
    const provider = await this.cap(id);
    try {
      return await provider.setFlowEncryption!(input);
    } catch (e) {
      // chave PEM inválida é erro do cliente, não 500 (erros da Graph seguem o filtro global).
      if (e instanceof ProviderRequestError) throw e;
      throw new BadRequestException(`Chave privada inválida: ${(e as Error).message}`);
    }
  }

  /** URL pública que deve ser registrada como `endpoint_uri` do Flow na Meta. */
  endpointUri(id: string): string | null {
    const base = (this.config.get<string>('publicBaseUrl') ?? '').replace(/\/+$/, '');
    return base ? `${base}/api/webhooks/flows/${id}` : null;
  }

  async getEndpoint(id: string): Promise<{ url: string | null; endpointUri: string | null }> {
    await this.cap(id);
    const inst = await this.instances.findOne(id);
    return {
      url: (inst.config[DATA_EXCHANGE_URL_KEY] as string | undefined) ?? null,
      endpointUri: this.endpointUri(id),
    };
  }

  async setEndpoint(
    id: string,
    url: string | null,
  ): Promise<{ url: string | null; endpointUri: string | null }> {
    await this.cap(id);
    await this.instances.patchConfig(id, { [DATA_EXCHANGE_URL_KEY]: url });
    return { url, endpointUri: this.endpointUri(id) };
  }

  // ── sessões (correlação) ──

  listSessions(id: string, filter: FlowSessionFilter): Promise<FlowSessionEntity[]> {
    return this.sessions.list(id, filter);
  }

  async getSession(id: string, flowToken: string): Promise<FlowSessionEntity> {
    const s = await this.sessions.get(id, flowToken);
    if (!s) throw new NotFoundException(`Sessão de Flow "${flowToken}" não encontrada`);
    return s;
  }

  // ── Data API: chamada da Meta ao endpoint público ──

  /**
   * O adapter cuida do protocolo (assinatura, RSA/AES, ping, notificação de
   * erro). Aqui só decidimos a próxima tela — repassando o payload decifrado
   * ao serviço do integrador — e registramos a execução.
   */
  async dataExchange(
    id: string,
    req: FlowEndpointHttpRequest,
  ): Promise<{ status: number; body: string }> {
    const provider = await this.manager.ensureConnected(id);
    if (!provider.handleFlowEndpoint) {
      throw new NotFoundException('Instância sem suporte a endpoint de Flow');
    }
    return provider.handleFlowEndpoint(req, {
      onExchange: (r) => this.forwardExchange(id, r),
      onClientError: async (flowToken, error) => {
        this.logger.warn(
          `[${id}] Flow ${flowToken ?? '?'}: erro no cliente ${String(error.error)}`,
        );
        if (flowToken) await this.sessions.recordError(id, flowToken, error);
      },
    });
  }

  private async forwardExchange(
    id: string,
    r: Omit<FlowDataExchangeRequest, 'instanceId'>,
  ): Promise<Record<string, unknown>> {
    if (r.flowToken) await this.sessions.recordExchange(id, r.flowToken, r.action, r.screen);

    const inst = await this.instances.findOne(id);
    const url = inst.config[DATA_EXCHANGE_URL_KEY] as string | undefined;
    if (!url) {
      const msg = 'endpoint de troca de dados não configurado (PUT flows/endpoint)';
      if (r.flowToken) await this.sessions.recordError(id, r.flowToken, { error: msg });
      throw new Error(msg);
    }

    const rawBody = JSON.stringify({ instanceId: id, ...r } satisfies FlowDataExchangeRequest);
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (inst.webhookSecret) {
      headers['X-WAMux-Signature'] = signWebhook(
        inst.webhookSecret,
        rawBody,
        Math.floor(Date.now() / 1000),
      );
    }

    // Sem retry: a Meta espera a resposta em até 10s e ela mesma repete a chamada.
    const res = await axios.post(url, rawBody, {
      headers,
      timeout: this.config.get<number>('flows.dataExchangeTimeoutMs') ?? 8000,
      validateStatus: () => true,
    });
    const body = res.data as unknown;

    if (res.status === 427) {
      const msg = (body as { error_msg?: string } | undefined)?.error_msg;
      throw new FlowTokenInvalidError(msg);
    }
    if (res.status < 200 || res.status >= 300 || !body || typeof body !== 'object') {
      const msg = `endpoint do integrador respondeu HTTP ${res.status}`;
      if (r.flowToken) await this.sessions.recordError(id, r.flowToken, { error: msg });
      throw new Error(msg);
    }
    return body as Record<string, unknown>;
  }

  private async cap(id: string): Promise<WhatsAppProvider> {
    const p = await this.manager.requireLive(id);
    if (!p.capabilities.flows || !p.listFlows) {
      throw new NotImplementedException(
        `A engine "${p.type}" não suporta Flows (Cloud API oficial).`,
      );
    }
    return p;
  }
}
