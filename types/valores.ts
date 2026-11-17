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
// De quem é a vez: o Claude trabalhando, o Claude esperando uma resposta sua.
export type Vez = 'claude' | 'voce' | 'pergunta'

// Uso do plano: a janela de 5 horas (a "sessão atual" do Claude) e a semanal, com o gasto da conversa.
export type Janela = { pct: number; renova?: string }
export type Limites = { sessao?: Janela; semana?: Janela; custo?: number; lido: number }
