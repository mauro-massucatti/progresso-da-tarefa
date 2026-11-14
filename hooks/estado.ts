// Estado do Mod, em variáveis do próprio arquivo: os ganchos leem e escrevem aqui,
// e cada mudança pede ao Claude Code para redesenhar o painel e a faixa.
import type { EngineInterface } from 'claude-code'
import type { Plano, Vez } from '../types/valores'

export const est = {
  plano: null as Plano | null,
  ultimoPedido: '',
  fechadoPelaPessoa: false,
  vez: 'claude' as Vez,
  compacto: false,
  etapaAberta: 0,
  turno: '',
}
export type Estado = typeof est

export function mudar<K extends keyof Estado>($: EngineInterface, chave: K, fn: (v: Estado[K]) => Estado[K]) {
  est[chave] = fn(est[chave])
  $.ui.invalidate('ui.render')
}
