/**
 * Pedidos do catálogo do WhatsApp Business.
 *
 * Quando um cliente monta um carrinho no catálogo de uma conta Business, ele
 * envia uma mensagem de pedido que carrega apenas `orderId` e um `token` — os
 * itens não vêm na mensagem. Buscar o conteúdo real exige uma consulta
 * separada ao servidor, que é o que este contrato cobre.
 *
 * Disponível só na engine `whatsmeow` (via hypermeow, que adicionou
 * `GetOrderDetails`); as demais ficam 501 por `capabilities.orders`.
 */

export interface OrderProduct {
  id: string;
  name: string;
  /** menor unidade da moeda (centavos), como o protocolo entrega. */
  price: number;
  currency: string;
  quantity: number;
  imageUrl?: string;
  /** variação escolhida (tamanho, cor…), quando o produto tem. */
  variant?: string;
}

export interface OrderPrice {
  /** menor unidade da moeda (centavos). */
  subtotal: number;
  total: number;
  currency: string;
  /** ex.: "pending" enquanto o vendedor não fecha o valor final. */
  status?: string;
}

export interface OrderDetails {
  id: string;
  /** unix (s). */
  createdAt: number;
  catalogId?: string;
  price: OrderPrice;
  products: OrderProduct[];
}

/** Entrada da consulta — ambos os campos vêm da mensagem de pedido recebida. */
export interface GetOrderInput {
  orderId: string;
  /** token opaco que autoriza a leitura daquele pedido. */
  token: string;
}
