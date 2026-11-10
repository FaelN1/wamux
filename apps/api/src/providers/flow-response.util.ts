import { FlowResponse } from './provider.types';

/**
 * Resposta de WhatsApp Flow, comum às engines: na Cloud `nfm_reply.response_json`
 * e nas não oficiais `nativeFlowResponseMessage.paramsJson` são uma STRING JSON com os campos do Flow + o
 * `flow_token`. JSON inválido não derruba a mensagem: `data` fica vazio e o
 * cru continua em `raw`.
 */
export function parseNfmReply(nfm: {
  name?: string;
  body?: string;
  response_json?: string;
}): FlowResponse {
  let data: Record<string, unknown> = {};
  try {
    const parsed: unknown = nfm.response_json ? JSON.parse(nfm.response_json) : {};
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      data = parsed as Record<string, unknown>;
    }
  } catch {
    /* mantém data = {} */
  }
  return {
    name: nfm.name,
    body: nfm.body,
    data,
    ...(typeof data.flow_token === 'string' ? { flowToken: data.flow_token } : {}),
  };
}
