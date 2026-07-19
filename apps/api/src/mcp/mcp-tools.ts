import { z } from 'zod';
import { ApiKeyAction } from '@wamux/shared';
import { InboxQueryService } from '../inbox/inbox-query.service';
import { MessagingService } from '../messaging/messaging.service';

/** Contexto da chamada — resolvido pelo guard, nunca vem do input da tool. */
export interface McpToolContext {
  instanceId: string;
}

export interface McpToolDefinition {
  name: string;
  description: string;
  /** ação exigida — checada pelo dispatcher (`mcp.controller.ts`), não pelo guard da rota (ver design doc §7.3). */
  requiredAction: ApiKeyAction;
  inputSchema: z.ZodRawShape;
  handler: (ctx: McpToolContext, args: Record<string, unknown>) => Promise<unknown>;
}

/**
 * Tools MCP da fatia 1 (`docs/api-keys-mcp-handoff.md` §7.4) — só leitura +
 * envio de texto. Mídia/grupos/comunidades/control/delete ficam de fora de
 * propósito, adicionar depois é só mais uma entrada aqui, sem redesenho.
 */
export function buildMcpTools(
  inboxQuery: InboxQueryService,
  messaging: MessagingService,
): McpToolDefinition[] {
  return [
    {
      name: 'list_chats',
      description: 'Lista as conversas (chats) persistidas da instância, mais recentes primeiro.',
      requiredAction: ApiKeyAction.READ,
      inputSchema: {
        cursor: z.string().optional().describe('cursor opaco da página anterior'),
        limit: z.number().int().min(1).max(100).optional().describe('máximo de itens (default 50)'),
        q: z.string().optional().describe('busca por nome/número, contém, case-insensitive'),
      },
      handler: (ctx, args) =>
        inboxQuery.listChats(ctx.instanceId, {
          cursor: args.cursor as string | undefined,
          limit: args.limit as number | undefined,
          q: args.q as string | undefined,
        }),
    },
    {
      name: 'get_chat_messages',
      description: 'Mensagens de um chat específico, paginadas, mais recentes primeiro.',
      requiredAction: ApiKeyAction.READ,
      inputSchema: {
        chatId: z
          .string()
          .describe('jid do chat, ex.: "5511999999999@s.whatsapp.net" ou "123...@g.us"'),
        limit: z.number().int().min(1).max(100).optional().describe('máximo de itens (default 50)'),
        before: z
          .number()
          .int()
          .optional()
          .describe('unix (segundos) — só mensagens mais antigas que isso'),
      },
      handler: (ctx, args) =>
        inboxQuery.listMessages(ctx.instanceId, args.chatId as string, {
          limit: args.limit as number | undefined,
          before: args.before as number | undefined,
        }),
    },
    {
      name: 'list_contacts',
      description: 'Lista os contatos persistidos da instância.',
      requiredAction: ApiKeyAction.READ,
      inputSchema: {
        cursor: z.string().optional().describe('cursor opaco da página anterior'),
        limit: z.number().int().min(1).max(100).optional().describe('máximo de itens (default 50)'),
        q: z.string().optional().describe('busca por nome/número, contém, case-insensitive'),
      },
      handler: (ctx, args) =>
        inboxQuery.listContacts(ctx.instanceId, {
          cursor: args.cursor as string | undefined,
          limit: args.limit as number | undefined,
          q: args.q as string | undefined,
        }),
    },
    {
      name: 'send_text_message',
      description: 'Envia uma mensagem de texto pro WhatsApp.',
      requiredAction: ApiKeyAction.SEND,
      inputSchema: {
        to: z.string().describe('destino: número (5511999999999) ou jid completo'),
        text: z.string().min(1).describe('texto da mensagem'),
      },
      handler: (ctx, args) =>
        messaging.sendText(ctx.instanceId, { to: args.to as string, text: args.text as string }),
    },
  ];
}
