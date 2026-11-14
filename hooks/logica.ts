// Contas do progresso: sem chamadas ao engine, para poder testar sozinhas.
import type { Etapa, Plano, Prazo, Situacao } from '../types'

const MIN = 60_000

export const situacaoDe = (status: unknown): Situacao =>
  status === 'completed' ? 'feita' : status === 'in_progress' ? 'agora' : 'falta'

// Troca a lista inteira de etapas, guardando os horários das que já existiam com o mesmo nome.
export function trocarEtapas(
  plano: Plano | null,
  novas: { nome: string; situacao: Situacao }[],
  agora: number,
  pedido: string,
  comecarDeNovo: boolean,
): Plano {
  const antigo = plano && !comecarDeNovo && !plano.concluido ? plano : null
  const etapas: Etapa[] = novas.map(n => {
    const velha = antigo?.etapas.find(v => v.nome === n.nome)
    const etapa: Etapa = { nome: n.nome, situacao: n.situacao }
    if (velha?.inicio) etapa.inicio = velha.inicio
    if (velha?.fim) etapa.fim = velha.fim
    if (velha?.acoes?.length) etapa.acoes = velha.acoes
    if (n.situacao !== 'falta' && !etapa.inicio) etapa.inicio = agora
    if (n.situacao === 'feita' && !etapa.fim) etapa.fim = agora
    if (n.situacao !== 'feita') delete etapa.fim
    return etapa
  })
  // Arquivos, erros e consumo seguem com a tarefa enquanto ela não recomeça do zero.
  const extras = antigo ? { arquivos: antigo.arquivos, erros: antigo.erros, usoInicio: antigo.usoInicio, usoAgora: antigo.usoAgora, fazendo: antigo.fazendo } : {}
  const limpo = Object.fromEntries(Object.entries(extras).filter(([, v]) => v !== undefined))
  return fechar({
    ...limpo,
    tarefa: antigo?.tarefa || resumirPedido(pedido),
    etapas,
    inicio: antigo?.inicio ?? agora,
    atualizado: agora,
  }, agora)
}

// "advance": a etapa em andamento termina e a próxima que falta começa.
export function avancar(plano: Plano, agora: number): Plano {
  const etapas = plano.etapas.map(e => ({ ...e }))
  const atual = etapas.findIndex(e => e.situacao === 'agora')
  const emCurso = atual >= 0 ? etapas[atual] : undefined
  if (emCurso) Object.assign(emCurso, { situacao: 'feita', fim: agora })
  const proxima = etapas.find(e => e.situacao === 'falta')
  if (proxima) Object.assign(proxima, { situacao: 'agora', inicio: agora })
  return fechar({ ...plano, etapas, atualizado: agora }, agora)
}

// "done" e "start": números de etapa contados a partir de 1.
export function marcar(plano: Plano, feitas: number[], comecar: number | undefined, agora: number): Plano {
  const etapas = plano.etapas.map(e => ({ ...e }))
  for (const n of feitas) {
    const e = etapas[n - 1]
    if (e && e.situacao !== 'feita') Object.assign(e, { situacao: 'feita', fim: agora, inicio: e.inicio ?? agora })
  }
  if (comecar !== undefined) {
    const e = etapas[comecar - 1]
    if (e && e.situacao === 'falta') Object.assign(e, { situacao: 'agora', inicio: agora })
  }
  return fechar({ ...plano, etapas, atualizado: agora }, agora)
}

export function concluirTudo(plano: Plano, agora: number): Plano {
  const etapas = plano.etapas.map(e =>
    e.situacao === 'feita' ? e : { ...e, situacao: 'feita' as const, inicio: e.inicio ?? agora, fim: agora },
  )
  return fechar({ ...plano, etapas, atualizado: agora }, agora)
}

function fechar(plano: Plano, agora: number): Plano {
  const tudo = plano.etapas.length > 0 && plano.etapas.every(e => e.situacao === 'feita')
  if (tudo && !plano.concluido) return { ...plano, concluido: agora }
  if (!tudo && plano.concluido) {
    const { concluido: _fora, ...resto } = plano
    return resto
  }
  return plano
}

export function resumirPedido(texto: string): string {
  const linha = (texto || '').split('\n').map(l => l.trim()).find(l => l.length > 0) ?? ''
  if (!linha) return 'Tarefa desta sessão'
  return linha.length > 90 ? linha.slice(0, 87).trimEnd() + '...' : linha
}

export type Contagem = { total: number; feitas: number; agora: number; faltam: number; fracao: number; percentual: number }

export function contar(plano: Plano): Contagem {
  const total = plano.etapas.length
  const feitas = plano.etapas.filter(e => e.situacao === 'feita').length
  const agora = plano.etapas.filter(e => e.situacao === 'agora').length
  const faltam = total - feitas - agora
  // Percentual único em todo o Mod: etapas concluídas sobre o total.
  const fracao = total ? feitas / total : 0
  return { total, feitas, agora, faltam, fracao, percentual: Math.round(fracao * 100) }
}

// Estimativa do que falta, pelo tempo médio das etapas já concluídas.
export function estimarRestante(plano: Plano, agora: number): number | null {
  const c = contar(plano)
  if (plano.concluido) return 0
  if (c.feitas === 0) return null
  const fins = plano.etapas.filter(e => e.fim).map(e => e.fim as number)
  const ultimo = fins.length ? Math.max(...fins) : agora
  const media = Math.max(MIN / 2, (ultimo - plano.inicio) / c.feitas)
  const atual = plano.etapas.find(e => e.situacao === 'agora')
  const gastoNaAtual = atual?.inicio ? agora - atual.inicio : 0
  const restoAtual = atual ? Math.max(media * 0.25, media - gastoNaAtual) : 0
  return Math.round(restoAtual + c.faltam * media)
}

// Prazo: "30min", "1h", "1h30", "2 horas", "18:30", "18h30".
export function lerPrazo(texto: string, agora: number): Prazo | null | 'invalido' {
  const t = texto.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!t) return 'invalido'
  if (/^(limpar|tirar|sem prazo|sem|nenhum|apagar)$/.test(t)) return null
  let m = t.match(/^(\d{1,3}) ?(m|min|mins|minuto|minutos)$/)
  if (m) return { ate: agora + Number(m[1]) * MIN, desde: agora, texto: `${m[1]} min` }
  m = t.match(/^(\d{1,2}) ?(h|hora|horas)(?: ?e? ?(\d{1,2}) ?(m|min|minutos)?)?$/)
  if (m) {
    const minutos = Number(m[1]) * 60 + Number(m[3] ?? 0)
    return { ate: agora + minutos * MIN, desde: agora, texto: m[3] ? `${m[1]} h ${m[3]} min` : `${m[1]} h` }
  }
  m = t.match(/^(?:às |as |até |ate )?(\d{1,2})[:h](\d{2})$/)
  if (m && Number(m[1]) < 24 && Number(m[2]) < 60) {
    const d = new Date(agora)
    d.setHours(Number(m[1]), Number(m[2]), 0, 0)
    let ate = d.getTime()
    if (ate <= agora) ate += 24 * 60 * MIN
    return { ate, desde: agora, texto: `até ${hora(ate)}` }
  }
  return 'invalido'
}

export const hora = (ms: number): string => {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function duracao(ms: number): string {
  const min = Math.max(0, Math.round(ms / MIN))
  if (min < 1) return 'menos de 1 min'
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const r = min % 60
  return r ? `${h} h ${r} min` : `${h} h`
}

export type Ritmo = 'concluida' | 'no-ritmo' | 'atrasada' | 'vencida' | 'sem-prazo'

// Leitura do tempo: quanto do prazo já passou, ou quanto da previsão.
export function lerTempo(plano: Plano, prazo: Prazo | null, agora: number) {
  const c = contar(plano)
  const decorrido = (plano.concluido ?? agora) - plano.inicio
  if (plano.concluido) {
    return { ritmo: 'concluida' as Ritmo, fracao: 1, centro: 'pronta', frase: `Tarefa concluída em ${duracao(decorrido)}, às ${hora(plano.concluido)}.` }
  }
  if (prazo) {
    const janela = Math.max(MIN, prazo.ate - prazo.desde)
    const fracao = Math.min(1, Math.max(0, (agora - prazo.desde) / janela))
    const falta = prazo.ate - agora
    if (falta <= 0) {
      return { ritmo: 'vencida' as Ritmo, fracao: 1, centro: 'venceu', frase: `O prazo (${hora(prazo.ate)}) venceu há ${duracao(-falta)}. Faltam ${c.faltam + c.agora} de ${c.total} etapas.` }
    }
    const atrasada = fracao > c.fracao + 0.15
    return {
      ritmo: (atrasada ? 'atrasada' : 'no-ritmo') as Ritmo,
      fracao,
      centro: duracao(falta),
      frase: atrasada
        ? `Faltam ${duracao(falta)} para o prazo (${hora(prazo.ate)}), e o tempo está andando mais rápido que as etapas.`
        : `Faltam ${duracao(falta)} para o prazo (${hora(prazo.ate)}). O andamento está dentro do prazo.`,
    }
  }
  const resto = estimarRestante(plano, agora)
  if (resto === null) {
    return { ritmo: 'sem-prazo' as Ritmo, fracao: 0, centro: duracao(decorrido), frase: `Começou às ${hora(plano.inicio)}, há ${duracao(decorrido)}. A previsão aparece quando a primeira etapa terminar.` }
  }
  return {
    ritmo: 'sem-prazo' as Ritmo,
    fracao: decorrido / Math.max(1, decorrido + resto),
    centro: `~${duracao(resto)}`,
    frase: `Começou às ${hora(plano.inicio)}. Pelo ritmo até agora, deve terminar por volta de ${hora(agora + resto)} (estimativa).`,
  }
}

// Mesma paleta do desenho (Anthropic), para o mosaico do terminal.
export const CORES = {
  feita: '#788C5D',
  agora: '#D97757',
  falta: '#87867F',
  trilho: '#3D3D3A',
  'no-ritmo': '#D97757',
  atrasada: '#C15F3C',
  vencida: '#A3492B',
  concluida: '#788C5D',
  'sem-prazo': '#6A9BCC',
} as const

// Fatias da pizza: concluídas, em andamento e as que faltam.
export function svgPizza(c: Contagem, tamanho: number): string {
  const r = tamanho / 2 - 2
  const cx = tamanho / 2
  const fatias: [number, string][] = [[c.feitas, CORES.feita], [c.agora, CORES.agora], [c.faltam, CORES.falta]]
  const total = Math.max(1, c.total)
  let angulo = -Math.PI / 2
  const partes: string[] = []
  for (const [n, cor] of fatias) {
    if (!n) continue
    const frac = n / total
    if (frac >= 0.9999) {
      partes.push(`<circle cx="${cx}" cy="${cx}" r="${r}" fill="${cor}"/>`)
      break
    }
    const fim = angulo + frac * 2 * Math.PI
    const x0 = cx + r * Math.cos(angulo), y0 = cx + r * Math.sin(angulo)
    const x1 = cx + r * Math.cos(fim), y1 = cx + r * Math.sin(fim)
    const grande = frac > 0.5 ? 1 : 0
    partes.push(`<path d="M${cx},${cx} L${x0.toFixed(2)},${y0.toFixed(2)} A${r},${r} 0 ${grande} 1 ${x1.toFixed(2)},${y1.toFixed(2)} Z" fill="${cor}" stroke="#FFFFFF" stroke-width="1.5"/>`)
    angulo = fim
  }
  if (!partes.length) partes.push(`<circle cx="${cx}" cy="${cx}" r="${r}" fill="${CORES.trilho}"/>`)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${tamanho}" height="${tamanho}" viewBox="0 0 ${tamanho} ${tamanho}">${partes.join('')}</svg>`
}

// Anel do tempo: quanto do prazo (ou da previsão) já passou, com o número no meio.
export function svgAnel(fracao: number, cor: string, centro: string, legenda: string, tamanho: number): string {
  const r = tamanho / 2 - 9
  const cx = tamanho / 2
  const volta = 2 * Math.PI * r
  const cheio = Math.min(1, Math.max(0, fracao)) * volta
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${tamanho}" height="${tamanho}" viewBox="0 0 ${tamanho} ${tamanho}">`
    + `<circle cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="${CORES.trilho}" stroke-width="12"/>`
    + `<circle cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="${cor}" stroke-width="12" stroke-linecap="round" stroke-dasharray="${cheio.toFixed(2)} ${volta.toFixed(2)}" transform="rotate(-90 ${cx} ${cx})"/>`
    + `<text x="${cx}" y="${cx - 2}" text-anchor="middle" font-family="-apple-system, Helvetica, Arial, sans-serif" font-size="${Math.round(tamanho / 7)}" font-weight="600" fill="${cor}">${esc(centro)}</text>`
    + `<text x="${cx}" y="${cx + tamanho / 8}" text-anchor="middle" font-family="-apple-system, Helvetica, Arial, sans-serif" font-size="${Math.round(tamanho / 12)}" fill="#7A828C">${esc(legenda)}</text>`
    + `</svg>`
}

// No terminal, pizza e anel viram um mosaico de meios-blocos (dois pontos por célula).
export function mosaico(colunas: number, linhas: number, cor: (x: number, y: number) => string | null): string {
  const PADRAO = 0x01000000
  const palavras = new Uint32Array(colunas * linhas * 3)
  const num = (c: string | null) => (c ? parseInt(c.slice(1), 16) : PADRAO)
  let i = 0
  for (let y = 0; y < linhas; y++) {
    for (let x = 0; x < colunas; x++) {
      const cima = cor(x, y * 2)
      const baixo = cor(x, y * 2 + 1)
      if (!cima && !baixo) {
        palavras[i++] = 0x20; palavras[i++] = PADRAO; palavras[i++] = PADRAO
      } else {
        palavras[i++] = 0x2580; palavras[i++] = num(cima); palavras[i++] = num(baixo)
      }
    }
  }
  return paraBase64(new Uint8Array(palavras.buffer))
}

function paraBase64(b: Uint8Array): string {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let s = ''
  for (let i = 0; i < b.length; i += 3) {
    const n = ((b[i] ?? 0) << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0)
    s += A.charAt((n >> 18) & 63) + A.charAt((n >> 12) & 63) + (i + 1 < b.length ? A.charAt((n >> 6) & 63) : '=') + (i + 2 < b.length ? A.charAt(n & 63) : '=')
  }
  return s
}

// Cor de cada ponto da pizza e do anel no mosaico do terminal (pontos de 0 a 2*colunas por altura).
export function corDaPizza(c: Contagem, lado: number) {
  const fatias: [number, string][] = [[c.feitas, CORES.feita], [c.agora, CORES.agora], [c.faltam, CORES.falta]]
  const total = Math.max(1, c.total)
  return (x: number, y: number): string | null => {
    const dx = x + 0.5 - lado / 2, dy = y + 0.5 - lado / 2
    if (dx * dx + dy * dy > (lado / 2) * (lado / 2)) return null
    if (!c.total) return CORES.trilho
    let a = Math.atan2(dy, dx) + Math.PI / 2
    if (a < 0) a += 2 * Math.PI
    let acum = 0
    for (const [n, cor] of fatias) {
      acum += (n / total) * 2 * Math.PI
      if (a <= acum + 1e-9) return cor
    }
    return CORES.falta
  }
}

export function corDoAnel(fracao: number, corCheia: string, lado: number) {
  return (x: number, y: number): string | null => {
    const dx = x + 0.5 - lado / 2, dy = y + 0.5 - lado / 2
    const d = Math.sqrt(dx * dx + dy * dy)
    if (d > lado / 2 || d < lado / 2 - lado / 5) return null
    let a = Math.atan2(dy, dx) + Math.PI / 2
    if (a < 0) a += 2 * Math.PI
    return a <= fracao * 2 * Math.PI ? corCheia : CORES.trilho
  }
}
