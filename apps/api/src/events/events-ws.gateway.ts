import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import type { IncomingMessage } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { InstanceService } from '../instance/instance.service';

/**
 * Transporte WebSocket dos eventos. Monta um servidor `ws`
 * no mesmo HTTP server do Nest, em `/events`. O cliente conecta com
 * `?instance=<id>&apikey=<key>` e recebe, em tempo real, os eventos daquela
 * instância. Auth: a apikey precisa ser a da instância ou a GLOBAL_API_KEY.
 */
@Injectable()
export class EventsWsGateway implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(EventsWsGateway.name);
  private wss?: WebSocketServer;
  /** instanceId → sockets conectados. */
  private readonly clients = new Map<string, Set<WebSocket>>();

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly instances: InstanceService,
    private readonly config: ConfigService,
  ) {}

  onApplicationBootstrap(): void {
    const server = this.adapterHost.httpAdapter?.getHttpServer();
    if (!server) {
      this.logger.warn('HTTP server indisponível; WebSocket de eventos não iniciado');
      return;
    }
    this.wss = new WebSocketServer({ server, path: '/events' });
    this.wss.on('connection', (ws, req) => void this.onConnect(ws, req));
    this.logger.log('WebSocket de eventos ativo em /events');
  }

  onModuleDestroy(): void {
    this.wss?.close();
  }

  private async onConnect(ws: WebSocket, req: IncomingMessage): Promise<void> {
    try {
      const url = new URL(req.url ?? '', 'http://localhost');
      const instanceId = url.searchParams.get('instance') ?? '';
      const apikey = url.searchParams.get('apikey') ?? '';
      if (!instanceId) return ws.close(4000, 'parâmetro "instance" obrigatório');

      const inst = await this.instances.findOne(instanceId).catch(() => null);
      if (!inst) return ws.close(4004, 'instância não encontrada');

      const globalKey = this.config.get<string>('globalApiKey');
      if (apikey !== inst.apiKey && apikey !== globalKey) {
        return ws.close(4001, 'apikey inválida');
      }

      const cfg = this.instances.effectiveEvents(inst);
      if (!cfg.websocket.enabled) {
        return ws.close(4003, 'WebSocket desabilitado nesta instância');
      }

      this.add(instanceId, ws);
      ws.on('close', () => this.remove(instanceId, ws));
      ws.on('error', () => this.remove(instanceId, ws));
      ws.send(JSON.stringify({ event: 'ws.connected', instanceId, timestamp: Date.now() }));
      this.logger.debug(`WS conectado à instância ${instanceId} (${this.count(instanceId)} clientes)`);
    } catch {
      ws.close(1011, 'erro interno');
    }
  }

  /** Empurra um evento para todos os clientes daquela instância. */
  push(instanceId: string, event: string, payload: unknown): void {
    const set = this.clients.get(instanceId);
    if (!set?.size) return;
    const msg = JSON.stringify({ instanceId, event, data: payload, timestamp: Date.now() });
    for (const ws of set) {
      if (ws.readyState === WebSocket.OPEN) ws.send(msg);
    }
  }

  count(instanceId: string): number {
    return this.clients.get(instanceId)?.size ?? 0;
  }

  private add(instanceId: string, ws: WebSocket): void {
    let set = this.clients.get(instanceId);
    if (!set) {
      set = new Set();
      this.clients.set(instanceId, set);
    }
    set.add(ws);
  }

  private remove(instanceId: string, ws: WebSocket): void {
    const set = this.clients.get(instanceId);
    set?.delete(ws);
    if (set && set.size === 0) this.clients.delete(instanceId);
  }
}
