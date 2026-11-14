export type Situacao = 'feita' | 'agora' | 'falta'
export type Etapa = {
  nome: string
  situacao: Situacao
  id?: string
  inicio?: number
  fim?: number
  acoes?: string[] // o que foi feito durante a etapa, em palavras comuns
}
export type Arquivo = { caminho: string; acao: 'criado' | 'alterado'; quando: number }
export type Erro = { quando: number; oque: string }
export type Plano = {
  tarefa: string
  etapas: Etapa[]
  inicio: number
  atualizado: number
  concluido?: number
  arquivos?: Arquivo[]
  erros?: Erro[]
  fazendo?: string     // a ação em curso, em palavras comuns
  usoInicio?: number   // percentual do limite de 5 horas quando a tarefa começou
  usoAgora?: number    // o mesmo percentual na última leitura
}
export type Prazo = { ate: number; desde: number; texto: string; avisou5?: boolean; avisouVencido?: boolean }
// De quem é a vez: o Claude trabalhando, o Claude esperando uma resposta sua ou a sua autorização.
export type Vez = 'claude' | 'voce' | 'pergunta' | 'autorizacao'

declare module 'claude-code' {
  interface PluginState {
    'progresso-da-tarefa': {
      plano: Shaped<Plano | null>
      prazo: Shaped<Prazo | null>
      ultimoPedido: string
      fechadoPelaPessoa: boolean
      vez: Vez
      compacto: boolean
      etapaAberta: number
      turno: string
    }
  }
}
