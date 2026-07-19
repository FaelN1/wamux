/**
 * WhatsApp Business Calling API (Cloud) — SÓ SINALIZAÇÃO. Cloud-only, gated por
 * `capabilities.calling`. O WAMux fala o plano de sinalização (JSON /calls +
 * webhooks); a MÍDIA (ICE/DTLS/SRTP, SDP offer/answer) é terminada por um
 * endpoint WebRTC EXTERNO — a Meta não fornece SDK de mídia. Manter SIP
 * DESABILITADO (senão /calls e webhooks de calling param de funcionar).
 */

export type CallAction = 'connect' | 'pre_accept' | 'accept' | 'reject' | 'terminate';

export interface CallSdp {
  type: 'offer' | 'answer';
  sdp: string;
}

export interface ConnectCallInput {
  /** business-initiated (connect): número do destinatário. */
  to?: string;
  /** user-initiated (pre_accept/accept/reject/terminate): id da chamada. */
  callId?: string;
  action: CallAction;
  /** SDP offer (connect) ou answer (pre_accept/accept). */
  sdp?: CallSdp;
  /** biz_opaque_callback_data — eco no webhook de terminate. */
  callbackData?: string;
}
