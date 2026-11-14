// Retrato único do andamento e os desenhos do painel.
// Tudo o que o painel, a faixa e o terminal mostram sai de `retrato()`: um só cálculo,
// para que nenhum indicador fique atrás dos outros.
import type { Arquivo, Etapa, Plano, Vez } from '../types'
import { duracao, estimarRestante, hora } from './logica'

const MIN = 60_000

// Paleta institucional da Anthropic, sem azul: oliva, laranja do Claude, argila e kraft, sobre os cinzas quentes.
export const COR = {
  feita: '#788C5D',     // concluída
  agora: '#D97757',     // em andamento (o laranja do Claude)
  espera: '#D4A27F',    // esperando você (kraft)
  erro: '#C15F3C',      // ação que deu erro (argila)
} as const

export type Estado = 'aguardando' | 'andamento' | 'esperando' | 'concluida'

export type Retrato = {
  estado: Estado
  rotulo: string
  cor: string
  total: number
  feitas: number
  emCurso: number
  pendentes: number
  percentual: number          // feitas / total, sem meio-termo
  atual: number               // número da etapa da vez (0 se concluída)
  etapas: { nome: string; situacao: 'feita' | 'agora' | 'falta'; duracao?: string; acoes: string[] }[]
  agora: string | null        // o que o Claude está fazendo, em palavras comuns
  naEtapa: string | null      // há quanto tempo está na etapa atual
  aviso: string | null        // pedido à pessoa quando a vez é dela
  erros: number
  arquivos: Arquivo[]
  uso: number | null          // pontos percentuais do limite de 5 horas gastos na tarefa
  tempo: {
    fracao: number
    valor: string             // número curto no centro do anel
    legenda: string
    cor: string
    linhas: string[]
  }
}

// Duração curta para o centro do anel: sempre cabe.
export function curta(ms: number): string {
  const min = Math.max(0, Math.round(ms / MIN))
  if (min < 1) return '<1 min'
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60), r = min % 60
  return r ? `${h}h${String(r).padStart(2, '0')}` : `${h} h`
}

const ESPERA: Record<Exclude<Vez, 'claude'>, [string, string]> = {
  voce: ['AGUARDANDO VOCÊ', 'O Claude parou e espera sua resposta na conversa.'],
  pergunta: ['PERGUNTA PARA VOCÊ', 'O Claude fez uma pergunta. Responda na conversa.'],
  autorizacao: ['PEDE AUTORIZAÇÃO', 'O Claude espera sua autorização para seguir.'],
}

export function retrato(plano: Plano, agora: number, vez: Vez = 'claude'): Retrato {
  const total = plano.etapas.length
  const feitas = plano.etapas.filter(e => e.situacao === 'feita').length
  const emCurso = plano.etapas.filter(e => e.situacao === 'agora').length
  const pendentes = total - feitas - emCurso
  const percentual = total ? Math.round((feitas / total) * 100) : 0
  const idx = plano.etapas.findIndex(e => e.situacao === 'agora')
  const proxima = plano.etapas.findIndex(e => e.situacao === 'falta')
  const atual = idx >= 0 ? idx + 1 : proxima >= 0 ? proxima + 1 : 0
  const etapaAtual: Etapa | undefined = idx >= 0 ? plano.etapas[idx] : undefined
  const etapas = plano.etapas.map(e => ({
    nome: e.nome, situacao: e.situacao, acoes: e.acoes ?? [],
    duracao: e.situacao === 'feita' && e.inicio && e.fim ? curta(e.fim - e.inicio) : undefined,
  }))
  const uso = plano.usoInicio !== undefined && plano.usoAgora !== undefined ? Math.max(0, Math.round(plano.usoAgora - plano.usoInicio)) : null
  const base = {
    total, feitas, emCurso, pendentes, percentual, atual, etapas, uso,
    erros: plano.erros?.length ?? 0, arquivos: plano.arquivos ?? [],
    agora: null as string | null, naEtapa: null as string | null, aviso: null as string | null,
  }

  if (plano.concluido || (total > 0 && feitas === total)) {
    const fim = plano.concluido ?? agora
    const linhas = [`Das ${hora(plano.inicio)} às ${hora(fim)}`, `${total} etapa${total > 1 ? 's' : ''} concluída${total > 1 ? 's' : ''}`]
    if (base.arquivos.length) linhas.push(`${base.arquivos.length} arquivo${base.arquivos.length > 1 ? 's' : ''} entregue${base.arquivos.length > 1 ? 's' : ''}`)
    if (base.erros) linhas.push(base.erros > 1 ? `${base.erros} ações com erro, refeitas` : '1 ação com erro, refeita')
    if (uso) linhas.push(`Usou ${uso}% do limite de 5 h`)
    return {
      ...base, estado: 'concluida', rotulo: 'CONCLUÍDA', cor: COR.feita, percentual: 100, atual: 0,
      tempo: { fracao: 1, valor: curta(fim - plano.inicio), legenda: 'de duração', cor: COR.feita, linhas },
    }
  }

  base.agora = vez === 'claude' ? plano.fazendo ?? null : null
  base.naEtapa = etapaAtual?.inicio ? `há ${duracao(agora - etapaAtual.inicio)} nesta etapa` : null
  if (vez !== 'claude') base.aviso = ESPERA[vez][1]
  const rotuloDe = (normal: Estado, cor: string): { estado: Estado; rotulo: string; cor: string } => {
    if (vez !== 'claude') return { estado: 'esperando', rotulo: ESPERA[vez][0], cor: COR.espera }
    const rotulo = feitas || emCurso ? 'EM ANDAMENTO' : 'AGUARDANDO'
    return { estado: normal, rotulo, cor }
  }
  const usoLinha = uso ? [`Consumo: ${uso}% do limite de 5 h`] : []

  const decorrido = agora - plano.inicio
  const resto = estimarRestante(plano, agora)
  if (resto === null) {
    return {
      ...base, ...rotuloDe('andamento', COR.agora),
      tempo: {
        fracao: 0, valor: curta(decorrido), legenda: 'decorridos', cor: COR.agora,
        linhas: [`Começou às ${hora(plano.inicio)}`, 'A previsão aparece ao fim da primeira etapa', ...usoLinha],
      },
    }
  }
  return {
    ...base, ...rotuloDe('andamento', COR.agora),
    tempo: {
      fracao: decorrido / Math.max(1, decorrido + resto), valor: `~${curta(resto)}`, legenda: 'restantes', cor: COR.agora,
      linhas: [`Término previsto às ${hora(agora + resto)}`, 'Estimativa pelo ritmo atual', ...usoLinha],
    },
  }
}

// Medidas: uma largura de coluna e um traço para barra e anel.
export const L = 200
const TRACO = 7
const DIAM = 112
const FONTE = `-apple-system, BlinkMacSystemFont, 'Helvetica Neue', Helvetica, Arial, sans-serif`
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const anima = (attr: string, de: string, para: string) =>
  de === para ? '' : `<animate attributeName="${attr}" from="${de}" to="${para}" dur="0.7s" calcMode="spline" keyTimes="0;1" keySplines=".32 .72 0 1" fill="freeze"/>`

// Estilo comum a todos os desenhos: cinzas quentes da Anthropic no tema claro e no escuro.
const ESTILO = `<style>
svg{--t1:#141413;--t2:#3D3D3A;--t3:#87867F;--trilho:#E8E6DC;--pend:#B0AEA5;--fundo:#FAF9F5;color-scheme:light dark}
@media (prefers-color-scheme: dark){svg{--t1:#FAF9F5;--t2:#D1CFC5;--t3:#9C9A92;--trilho:#3D3D3A;--pend:#6E6C66;--fundo:#262624}}
text{font-family:${FONTE};font-variant-numeric:tabular-nums}
.t1{fill:var(--t1)}.t2{fill:var(--t2)}.t3{fill:var(--t3)}
.cap{font-size:10.5px;letter-spacing:.09em;fill:var(--t3);font-weight:600}
.forte{font-weight:600}.p{font-size:12.5px}.pp{font-size:11px}
.num{font-size:30px;font-weight:600;letter-spacing:-.02em}.pct{font-size:17px;font-weight:500;fill:var(--t3)}
.num2{font-weight:600}.valor{font-weight:600;letter-spacing:-.01em;fill:var(--t1)}
.trilho{fill:var(--trilho)}.trilhoS{stroke:var(--trilho)}.fio{stroke:var(--pend)}
.contorno{stroke:var(--fundo);stroke-width:2.5px}
</style>`
const envolver = (corpo: string, altura: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${L + 4}" height="${altura}" viewBox="-2 0 ${L + 4} ${altura}">${ESTILO}${corpo}</svg>`

export function quebrar(texto: string, porLinha: number, maxLinhas = 2): string[] {
  const palavras = texto.split(/\s+/).filter(Boolean)
  const linhas: string[] = []
  let atual = ''
  for (const p of palavras) {
    if ((atual + ' ' + p).trim().length <= porLinha) atual = (atual + ' ' + p).trim()
    else { if (atual) linhas.push(atual); atual = p }
  }
  if (atual) linhas.push(atual)
  if (linhas.length > maxLinhas) {
    const resto = linhas.slice(maxLinhas - 1).join(' ')
    return [...linhas.slice(0, maxLinhas - 1), resto.length > porLinha ? resto.slice(0, porLinha - 1).trimEnd() + '…' : resto]
  }
  return linhas.map(l => (l.length > porLinha ? l.slice(0, porLinha - 1) + '…' : l))
}

// Bloco de estado: rótulo, posição, o que está acontecendo e, se houver, o que cabe à pessoa.
function blocoEstado(r: Retrato, partes: string[], y0: number): number {
  let y = y0
  partes.push(`<circle cx="4" cy="${y + 7}" r="4" style="fill:${r.cor}"/>`)
  partes.push(`<text x="14" y="${y + 11}" class="cap forte" style="fill:${r.cor}">${esc(r.rotulo)}</text>`)
  const longo = r.rotulo.length > 12
  const posicao = r.estado === 'concluida' ? `${r.total} de ${r.total}` : r.atual ? (longo ? `${r.atual} de ${r.total}` : `Etapa ${r.atual} de ${r.total}`) : `${r.total} etapas`
  partes.push(`<text x="${L}" y="${y + 11}" text-anchor="end" class="t3 p">${esc(posicao)}</text>`)
  y += 20
  const detalhe = r.aviso ?? r.agora ?? null
  if (detalhe) {
    for (const l of quebrar(detalhe, 31)) {
      partes.push(`<text x="0" y="${y + 10}" class="${r.aviso ? 't1 forte' : 't2'} p">${esc(l)}</text>`)
      y += 17
    }
  }
  if (r.naEtapa && !r.aviso) {
    partes.push(`<text x="0" y="${y + 10}" class="t3 p">${esc(r.naEtapa)}</text>`)
    y += 17
  }
  if (r.erros && r.estado !== 'concluida') {
    for (const l of quebrar(r.erros > 1 ? `${r.erros} ações deram erro e foram refeitas` : '1 ação deu erro e foi refeita', 31)) {
      partes.push(`<text x="0" y="${y + 10}" class="p" style="fill:${COR.erro}">${esc(l)}</text>`)
      y += 17
    }
  }
  return y + 12
}

function blocoPercentual(r: Retrato, partes: string[], y0: number, antes: Anterior | null): number {
  let y = y0
  partes.push(`<text x="0" y="${y + 26}" class="t1 num">${r.percentual}<tspan class="pct">%</tspan></text>`)
  partes.push(`<text x="${L}" y="${y + 26}" text-anchor="end" class="t3 p">${r.feitas} de ${r.total} concluídas</text>`)
  y += 38
  const feita = r.total ? (r.feitas / r.total) * L : 0
  const emCurso = r.total ? (r.emCurso / r.total) * L : 0
  partes.push(`<rect x="0" y="${y}" width="${L}" height="${TRACO}" rx="${TRACO / 2}" class="trilho"/>`)
  if (emCurso > 0) partes.push(`<rect x="${feita.toFixed(1)}" y="${y}" width="${emCurso.toFixed(1)}" height="${TRACO}" rx="${TRACO / 2}" style="fill:${r.estado === 'esperando' ? COR.espera : COR.agora}" opacity=".55"/>`)
  if (feita > 0) partes.push(`<rect x="0" y="${y}" width="${feita.toFixed(1)}" height="${TRACO}" rx="${TRACO / 2}" style="fill:${COR.feita}">${anima('width', antes ? (antes.barra * L).toFixed(1) : '0', feita.toFixed(1))}</rect>`)
  return y + TRACO + 24
}

// Anel com o texto do centro sempre dentro do círculo: a fonte encolhe se o texto for longo.
function anel(partes: string[], cx: number, cy: number, diam: number, fracao: number, cor: string, valor: string, legenda: string, antes: number | null) {
  const ra = (diam - TRACO) / 2
  const volta = 2 * Math.PI * ra
  const cheio = Math.min(1, Math.max(0, fracao)) * volta
  partes.push(`<circle cx="${cx}" cy="${cy}" r="${ra}" fill="none" class="trilhoS" stroke-width="${TRACO}"/>`)
  if (cheio > 0.5) {
    const de = antes === null ? '0' : (Math.min(1, Math.max(0, antes)) * volta).toFixed(2)
    partes.push(`<circle cx="${cx}" cy="${cy}" r="${ra}" fill="none" style="stroke:${cor}" stroke-width="${TRACO}" stroke-linecap="round" stroke-dasharray="${cheio.toFixed(2)} ${volta.toFixed(2)}" transform="rotate(-90 ${cx} ${cy})">${anima('stroke-dasharray', `${de} ${volta.toFixed(2)}`, `${cheio.toFixed(2)} ${volta.toFixed(2)}`)}</circle>`)
  }
  const interno = (ra - TRACO) * 2 * 0.86
  const tamanho = Math.min(diam / 5.3, interno / Math.max(1, valor.length * 0.58))
  partes.push(`<text x="${cx}" y="${(cy + tamanho * 0.18).toFixed(1)}" text-anchor="middle" class="valor" font-size="${tamanho.toFixed(1)}">${esc(valor)}</text>`)
  if (legenda) partes.push(`<text x="${cx}" y="${(cy + tamanho * 0.18 + 16).toFixed(1)}" text-anchor="middle" class="t3 pp">${esc(legenda)}</text>`)
}

export type Anterior = { barra: number; anel: number }

// Painel completo: estado, percentual, distribuição e tempo (ou resumo, ao concluir).
export function svgPainel(r: Retrato, antes: Anterior | null): { svg: string; altura: number; agora: Anterior } {
  const partes: string[] = []
  let y = blocoEstado(r, partes, 0)
  y = blocoPercentual(r, partes, y, antes)
  const titulo = (texto: string) => { partes.push(`<text x="0" y="${y + 10}" class="cap">${esc(texto)}</text>`); y += 22 }

  titulo('DISTRIBUIÇÃO DAS ETAPAS')
  const cx = DIAM / 2, cy = y + DIAM / 2, raio = DIAM / 2
  const fatias: [number, string, string][] = [
    [r.feitas, COR.feita, 'Concluídas'], [r.emCurso, r.estado === 'esperando' ? COR.espera : COR.agora, 'Em andamento'], [r.pendentes, 'var(--pend)', 'Pendentes'],
  ]
  const presentes = fatias.filter(f => f[0] > 0)
  if (!r.total) partes.push(`<circle cx="${cx}" cy="${cy}" r="${raio}" class="trilho"/>`)
  else if (presentes.length === 1) partes.push(`<circle cx="${cx}" cy="${cy}" r="${raio}" style="fill:${(presentes[0] as [number, string, string])[1]}"/>`)
  else {
    // Cada fatia recua meio fio dos dois lados: o vão entre elas tem largura constante até o centro.
    const FIO = 2.5
    let a = -Math.PI / 2
    for (const [n, cor] of fatias) {
      if (!n) continue
      const f = n / r.total
      const b = a + f * 2 * Math.PI
      const meio = (a + b) / 2
      const recuo = Math.min(raio * 0.4, (FIO / 2) / Math.sin(Math.min(Math.PI / 2, (b - a) / 2)))
      const ox = cx + Math.cos(meio) * recuo, oy = cy + Math.sin(meio) * recuo
      const da = Math.asin(Math.min(1, (FIO / 2) / raio))
      const x0 = cx + raio * Math.cos(a + da), y0 = cy + raio * Math.sin(a + da)
      const x1 = cx + raio * Math.cos(b - da), y1 = cy + raio * Math.sin(b - da)
      partes.push(`<path d="M${ox.toFixed(2)},${oy.toFixed(2)} L${x0.toFixed(2)},${y0.toFixed(2)} A${raio},${raio} 0 ${f > 0.5 ? 1 : 0} 1 ${x1.toFixed(2)},${y1.toFixed(2)} Z" style="fill:${cor}"/>`)
      a = b
    }
  }
  y += DIAM + 14
  for (const [n, cor, nome] of fatias) {
    partes.push(`<circle cx="4" cy="${y + 5}" r="4" style="fill:${cor}"/>`)
    partes.push(`<text x="14" y="${y + 9}" class="t2 p">${nome}</text>`)
    partes.push(`<text x="${L}" y="${y + 9}" text-anchor="end" class="t1 p num2">${n}</text>`)
    y += 19
  }
  y += 18

  titulo(r.estado === 'concluida' ? 'RESUMO' : 'TEMPO')
  anel(partes, DIAM / 2, y + DIAM / 2, DIAM, r.tempo.fracao, r.tempo.cor, r.tempo.valor, r.tempo.legenda, antes?.anel ?? null)
  y += DIAM + 14
  r.tempo.linhas.forEach((linha, i) => {
    for (const parte of quebrar(linha, 31)) {
      partes.push(`<text x="0" y="${y + 9}" class="${i === 0 ? 't1' : 't3'} p">${esc(parte)}</text>`)
      y += 17
    }
  })
  y += 6
  const altura = Math.ceil(y)
  return { svg: envolver(partes.join(''), altura), altura, agora: { barra: r.total ? r.feitas / r.total : 0, anel: r.tempo.fracao } }
}

// Linha do tempo das etapas, com a duração das concluídas.
export function svgEtapas(r: Retrato): { svg: string; altura: number } {
  const partes: string[] = []
  let y = 0
  partes.push(`<text x="0" y="${y + 10}" class="cap">ETAPAS</text>`)
  y += 22
  let lista = r.etapas.map((e, i) => ({ ...e, n: i + 1 }))
  let recolhidas = 0
  const primeiraAtiva = lista.findIndex(e => e.situacao !== 'feita')
  if (lista.length > 7 && primeiraAtiva > 1) { recolhidas = primeiraAtiva - 1; lista = lista.slice(recolhidas) }
  const marcas: { y: number; situacao: string }[] = []
  if (recolhidas) {
    marcas.push({ y: y + 6, situacao: 'feita' })
    partes.push(`<text x="20" y="${y + 10}" class="t3 p">${recolhidas} etapa${recolhidas > 1 ? 's' : ''} já concluída${recolhidas > 1 ? 's' : ''}</text>`)
    y += 24
  }
  for (const e of lista.slice(0, 8)) {
    const reserva = e.duracao ? 6 : 0
    const linhas = quebrar(e.nome, 27 - reserva)
    marcas.push({ y: y + 6, situacao: e.situacao })
    const classe = e.situacao === 'agora' ? 't1 p forte' : e.situacao === 'feita' ? 't3 p' : 't2 p'
    linhas.forEach((l, i) => partes.push(`<text x="20" y="${y + 10 + i * 16}" class="${classe}">${esc(l)}</text>`))
    if (e.duracao) partes.push(`<text x="${L}" y="${y + 10}" text-anchor="end" class="t3 pp">${esc(e.duracao)}</text>`)
    y += 8 + linhas.length * 16
  }
  if (lista.length > 8) { partes.push(`<text x="20" y="${y + 10}" class="t3 p">e mais ${lista.length - 8}</text>`); y += 20 }
  const corAgora = r.estado === 'esperando' ? COR.espera : COR.agora
  for (let i = 0; i < marcas.length - 1; i++) {
    const de = marcas[i] as { y: number; situacao: string }, para = marcas[i + 1] as { y: number; situacao: string }
    const verde = de.situacao === 'feita' && para.situacao !== 'falta'
    partes.push(`<line x1="6" y1="${de.y + 7}" x2="6" y2="${para.y - 7}" stroke-width="1.5" ${verde ? `style="stroke:${COR.feita}"` : 'class="fio"'}/>`)
  }
  for (const m of marcas) {
    if (m.situacao === 'feita') {
      partes.push(`<circle cx="6" cy="${m.y}" r="6" style="fill:${COR.feita}"/><path d="M3.4,${m.y} l1.8,1.9 l3.5,-3.8" fill="none" stroke="#FAF9F5" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`)
    } else if (m.situacao === 'agora') {
      partes.push(`<circle cx="6" cy="${m.y}" r="5.25" fill="none" stroke-width="1.5" style="stroke:${corAgora}"/><circle cx="6" cy="${m.y}" r="2.6" style="fill:${corAgora}"><animate attributeName="opacity" values="1;.35;1" dur="2.4s" repeatCount="indefinite"/></circle>`)
    } else {
      partes.push(`<circle cx="6" cy="${m.y}" r="5.25" fill="none" stroke-width="1.5" class="fio"/>`)
    }
  }
  const altura = Math.ceil(y + 4)
  return { svg: envolver(partes.join(''), altura), altura }
}

// O que foi feito numa etapa escolhida.
export function svgDetalhe(r: Retrato, n: number): { svg: string; altura: number } | null {
  const e = r.etapas[n - 1]
  if (!e) return null
  const partes: string[] = []
  let y = 0
  const situacao = e.situacao === 'feita' ? `Concluída${e.duracao ? ` em ${e.duracao}` : ''}` : e.situacao === 'agora' ? 'Em andamento' : 'Ainda não começou'
  for (const l of quebrar(e.nome, 31)) { partes.push(`<text x="0" y="${y + 10}" class="t1 p forte">${esc(l)}</text>`); y += 17 }
  partes.push(`<text x="0" y="${y + 10}" class="t3 p">${esc(situacao)}</text>`)
  y += 22
  if (!e.acoes.length) { partes.push(`<text x="0" y="${y + 10}" class="t3 p">Nenhuma ação registrada.</text>`); y += 17 }
  for (const a of e.acoes.slice(-8)) {
    partes.push(`<circle cx="3" cy="${y + 6}" r="1.8" class="t3"/>`)
    for (const l of quebrar(a, 29)) { partes.push(`<text x="12" y="${y + 10}" class="t2 p">${esc(l)}</text>`); y += 17 }
  }
  const altura = Math.ceil(y + 6)
  return { svg: envolver(partes.join(''), altura), altura }
}

// Modo compacto: estado, percentual, anel pequeno e a etapa da vez, em um terço da altura.
export function svgCompacto(r: Retrato, antes: Anterior | null): { svg: string; altura: number; agora: Anterior } {
  const partes: string[] = []
  let y = blocoEstado(r, partes, 0)
  const d = 64
  const topo = y
  partes.push(`<text x="0" y="${y + 26}" class="t1 num">${r.percentual}<tspan class="pct">%</tspan></text>`)
  partes.push(`<text x="0" y="${y + 44}" class="t3 p">${r.feitas} de ${r.total} concluídas</text>`)
  const largura = L - d - 16
  const feita = r.total ? (r.feitas / r.total) * largura : 0
  const emCurso = r.total ? (r.emCurso / r.total) * largura : 0
  partes.push(`<rect x="0" y="${y + 54}" width="${largura}" height="${TRACO}" rx="${TRACO / 2}" class="trilho"/>`)
  if (emCurso > 0) partes.push(`<rect x="${feita.toFixed(1)}" y="${y + 54}" width="${emCurso.toFixed(1)}" height="${TRACO}" rx="${TRACO / 2}" style="fill:${r.estado === 'esperando' ? COR.espera : COR.agora}" opacity=".55"/>`)
  if (feita > 0) partes.push(`<rect x="0" y="${y + 54}" width="${feita.toFixed(1)}" height="${TRACO}" rx="${TRACO / 2}" style="fill:${COR.feita}">${anima('width', antes ? (antes.barra * largura).toFixed(1) : '0', feita.toFixed(1))}</rect>`)
  anel(partes, L - d / 2, topo + d / 2, d, r.tempo.fracao, r.tempo.cor, r.tempo.valor, '', antes?.anel ?? null)
  partes.push(`<text x="${L - d / 2}" y="${topo + d + 14}" text-anchor="middle" class="t3 pp">${esc(r.tempo.legenda)}</text>`)
  y = topo + d + 22
  const atual = r.etapas.find(e => e.situacao === 'agora')
  if (atual) {
    partes.push(`<text x="0" y="${y + 10}" class="cap">ETAPA ATUAL</text>`)
    y += 20
    for (const l of quebrar(atual.nome, 31)) { partes.push(`<text x="0" y="${y + 10}" class="t1 p forte">${esc(l)}</text>`); y += 17 }
  }
  const altura = Math.ceil(y + 6)
  return { svg: envolver(partes.join(''), altura), altura, agora: { barra: r.total ? r.feitas / r.total : 0, anel: r.tempo.fracao } }
}

export function textoAlternativo(r: Retrato): string {
  return `${r.rotulo.toLowerCase()}: ${r.percentual}% concluído, ${r.feitas} de ${r.total} etapas concluídas, `
    + `${r.emCurso} em andamento, ${r.pendentes} pendentes. Tempo: ${r.tempo.valor} ${r.tempo.legenda}. ${r.tempo.linhas.join('. ')}.`
    + (r.aviso ? ` ${r.aviso}` : '') + (r.agora ? ` Agora: ${r.agora}.` : '')
}
