// Estado do Mod, em variáveis do próprio arquivo: os ganchos leem e escrevem aqui,
// e cada mudança (mudar, em register.tsx) pede ao Claude Code para redesenhar o painel e a faixa.
import type { Limites, Plano, Recurso, Vez } from '../types/valores'

export const est = {
  plano: null as Plano | null,
  ultimoPedido: '',
  fechadoPelaPessoa: false,
  vez: 'claude' as Vez,
  compacto: false,
  etapaAberta: 0,
  turno: '',
  limites: null as Limites | null,
  recursos: [] as Recurso[],
}
export type Estado = typeof est

