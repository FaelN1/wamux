import { Controller, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ApiKeyAction } from '@wamux/shared';
import { Request, Response } from 'express';
import { z } from 'zod';
import { InstanceApiKeyGuard } from '../common/guards/instance-api-key.guard';
import { InstanceId } from '../common/instance-id.decorator';
import { KeyActions } from '../common/key-actions.decorator';
import { RequireScope } from '../common/require-scope.decorator';
import { InboxQueryService } from '../inbox/inbox-query.service';
import { MessagingService } from '../messaging/messaging.service';
import { buildMcpTools } from './mcp-tools';

/**
 * Servidor MCP embutido — um "app MCP" é uma key escopada com `kind: 'mcp'`
 * (`instances/:id/api-keys`), sem entidade própria. Ver
 * `docs/api-keys-mcp-handoff.md` §7.
 *
 * Stateless de propósito (fatia 1, §7.3/§11): um `McpServer` + transporte
 * novos por request, sem sessão persistida — mais simples, dá pra evoluir
 * pra sessão quando precisarmos de resources/prompts/notificação do
 * servidor. Exige `app` na rota (decisão §11.4) — abrir uma sessão MCP é
 * "gerenciar um app". O scope de CADA tool é checado aqui dentro, não pelo
 * guard da rota — um único `POST` atende várias tools com ações diferentes.
 */
@Controller('instances/:id/mcp')
@UseGuards(InstanceApiKeyGuard)
export class McpController {
  constructor(
    private readonly inboxQuery: InboxQueryService,
    private readonly messaging: MessagingService,
  ) {}

  @Post()
  @RequireScope(ApiKeyAction.APP)
  @ApiExcludeEndpoint() // JSON-RPC (protocolo MCP), não é uma rota REST — não cabe no Swagger
  async handle(
    @InstanceId() instanceId: string,
    @KeyActions() callerActions: ApiKeyAction[],
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const tools = buildMcpTools(this.inboxQuery, this.messaging);
    const server = new McpServer(
      { name: 'wamux', version: '1.0.0' },
      { capabilities: { tools: {} } },
    );

    // Assinatura explícita e simples pro TS não tentar inferir os generics
    // de `registerTool` através de um `z.ZodRawShape` genérico dentro de um
    // loop — sem isso, `tsc` estoura "Type instantiation is excessively
    // deep" (o shape real de cada tool só existe em runtime aqui).
    type ToolCallback = (
      args: Record<string, unknown>,
    ) => Promise<{ content: { type: 'text'; text: string }[]; isError?: boolean }>;
    const registerTool = server.registerTool.bind(server) as (
      name: string,
      config: { description: string; inputSchema: z.ZodRawShape },
      cb: ToolCallback,
    ) => void;

    for (const tool of tools) {
      registerTool(
        tool.name,
        { description: tool.description, inputSchema: tool.inputSchema },
        async (args: Record<string, unknown>) => {
          if (!callerActions.includes(tool.requiredAction)) {
            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text: `Sua key não tem a ação "${tool.requiredAction}", necessária pra "${tool.name}".`,
                },
              ],
            };
          }
          try {
            const result = await tool.handler({ instanceId }, args);
            return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
          } catch (e) {
            return {
              isError: true,
              content: [{ type: 'text' as const, text: (e as Error).message }],
            };
          }
        },
      );
    }

    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body as unknown);
  }
}
