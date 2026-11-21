import type { EngineInterface, Register } from 'claude-code'

import type { Limites, Plano, Vez } from '../types/valores'
import { avancar, concluirTudo, contar, corDaPizza, corDoAnel, duracao, hora, marcar, mosaico, situacaoDe, trocarEtapas } from './logica'
import { COR, LARG, corDoUso, linhasRecursos, novosAnteriores, svgRecursos, textoRecursos, novosUsos, renovaEm, retrato, svgUso, textoUso, svgCompacto, svgDetalhe, svgEtapas, svgPainel, textoAlternativo } from './desenho'
import type { UsoVisto } from './desenho'
import { est } from './estado'
import type { Estado } from './estado'
import { acaoEmPalavras, anotarRecurso, arquivoGravado, marcarNaEtapa, nomeDoArquivo, recursoDe, registrar } from './acoes'

const PAINEL = 'progresso'
const TITULO = 'Andamento da tarefa'
const MIN = 60_000

// As listas de etapas que o Mod acompanha: a do app (abaixo das mensagens) e as do terminal.
const FERRAMENTAS = ['mcp__ccd_turn__update_plan', 'mcp__ccd_turn__wrap_up', 'TodoWrite', 'TaskCreate', 'TaskUpdate'] as const

type Args = { [chave: string]: unknown };
type Eng = EngineInterface;
const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : typeof v === 'string' ? jsonLista(v) : [])
function jsonLista(s: string): unknown[] {
  try { const v = JSON.parse(s); return Array.isArray(v) ? v : [] } catch { return [] }
}

// Percentual do limite de 5 horas na última resposta, quando o plano informa.
async function usoCincoHoras($: Eng) {
  try {
    const u = await $.session.usage()
    const janela = u.rateLimits.find(x => /five|5/.test(x.kind))
    return janela ? janela.percentUsed : undefined
  } catch { return undefined }
}

// Muda um valor do estado e pede para redesenhar o painel e a faixa.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mudar($: Eng, chave: keyof Estado, fn: (v: any) => unknown) {
  (est as { [k: string]: unknown })[chave] = fn(est[chave])
  $.ui.invalidate('ui.render')
}

// Guarda o andamento fora da sessão, para sobreviver ao fechamento do app.
async function guardar($: Eng) {
  try {
    const id = await $.session.id()
    await $.store.set(`sessao:${id}`, { plano: est.plano, quando: await $.clock.now() })
  } catch { /* guardar é conveniência: falhar não pode atrapalhar a tarefa */ }
}

// Aviso dentro do app.
async function notificar($: Eng, texto: string) {
  $.ui.toast(texto, { timeoutMs: 8000 })
}

// Lê os limites do plano (5 horas e semana) e o gasto da conversa; só grava se algo mudou,
// para não redesenhar o painel à toa.
type Medida = { rateLimits: { kind: string; percentUsed: number; resetsAt?: string }[]; cost?: { usd: number } }
function janelaDe(m: Medida, rx: RegExp) {
  const x = m.rateLimits.find(r => rx.test(r.kind))
  return x ? { pct: x.percentUsed, renova: x.resetsAt } : undefined
}
async function anotarLimites($: Eng, m: Medida) {
  const novo: Limites = { sessao: janelaDe(m, /five|5_?h/), semana: janelaDe(m, /seven|7_?d|week/), custo: m.cost ? Math.round(m.cost.usd * 100) / 100 : undefined, lido: await $.clock.now() }
  const antes = est.limites
  const igual = !!antes && JSON.stringify({ ...antes, lido: 0 }) === JSON.stringify({ ...novo, lido: 0 })
  if (!igual) mudar($, 'limites', () => novo)
}
async function lerLimites($: Eng) {
  try { await anotarLimites($, await $.session.usage()) } catch { /* sem leitura, fica a anterior */ }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'progresso', description: 'Abre ou fecha o painel com o andamento da tarefa' })

    // Sessão retomada: recupera o andamento guardado e apaga o que tiver mais de 14 dias.
    try {
      const id = await $.session.id()
      const agora = await $.clock.now()
      if (!(est.plano)) {
        const salvo = (await $.store.get(`sessao:${id}`)) as { plano?: Plano | null } | undefined
        if (salvo?.plano) await mudar($, 'plano', () => salvo.plano ?? null)
      }
      for (const chave of await $.store.keys()) {
        if (!chave.startsWith('sessao:')) continue
        const v = (await $.store.get(chave)) as { quando?: number } | undefined
        if (!v?.quando || agora - v.quando > 14 * 24 * 60 * MIN) await $.store.delete(chave)
      }
    } catch { /* sem memória guardada, começa vazio */ }

    // A cada 30 segundos: redesenha o relógio.
    await lerLimites($)
    $.clock.every(30_000, () => { $.ui.invalidate('ui.render') })
    return next(e)
  })

  // Limites em tempo real: o motor avisa quando uma janela anda um ponto ou o gasto cresce.
  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits') || e.changed.includes('cost')) await anotarLimites($, e)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('prompt.submit', async ($, e, next) => {
    const texto = typeof e.text === 'string' ? e.text : ''
    if (texto && !texto.startsWith('/')) await mudar($, 'ultimoPedido', () => texto)
    await mudar($, 'vez', () => 'claude' as Vez)
    return next(e)
  })

  // De quem é a vez: o turno do Claude começa e termina.
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      await mudar($, 'turno', () => e.turnId)
      await mudar($, 'vez', () => 'claude' as Vez)
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      await mudar($, 'turno', () => '')
      const p = est.plano
      if (p && p.etapas.length && !p.concluido) {
        await mudar($, 'vez', () => 'voce' as Vez)
        await mudar($, 'plano', v => (v ? { ...v, fazendo: undefined } : v))
        await notificar($, 'O Claude parou e espera sua resposta.')
      }
      const uso = await usoCincoHoras($)
      if (uso !== undefined) await mudar($, 'plano', v => (v ? { ...v, usoAgora: uso } : v))
      await guardar($)
    }
    return next(e)
  })

  // Toda chamada: o que está sendo feito, na etapa atual, e o que ela produziu.
  on('tool.call', async ($, e, next) => {
    const a = e as unknown as Args
    const tool = String(a.tool)
    const frase = acaoEmPalavras(tool, a)
    const p0 = est.plano
    const ativo = !!p0 && !p0.concluido && p0.etapas.length > 0
    const caminho = arquivoGravado(tool, a)
    const existia = tool !== 'Write'
    if (tool === 'AskUserQuestion') await mudar($, 'vez', () => 'pergunta' as Vez)
    if (ativo && frase && p0?.fazendo !== frase) await mudar($, 'plano', v => (v ? { ...v, fazendo: frase } : v))

    const resultado = await next(e)

    if (tool === 'AskUserQuestion') await mudar($, 'vez', () => 'claude' as Vez)
    const negado = 'deny' in resultado && !!resultado.deny
    const rec = recursoDe(tool, a)
    if (rec || negado) {
      const agora = await $.clock.now()
      await mudar($, 'recursos', v => {
        let lista = v
        if (rec && !negado) lista = anotarRecurso(lista, rec, agora, !!resultado.isError)
        if (negado) lista = anotarRecurso(lista, { tipo: 'bloqueio', nome: frase ?? tool }, agora)
        return lista
      })
      if (negado) $.ui.toast(`Barrado: ${frase ?? tool}`, { timeoutMs: 6000 })
      if (rec && ativo && !negado) await mudar($, 'plano', v => (v ? marcarNaEtapa(v, rec) : v))
    }
    if (ativo && frase) {
      const falhou = !negado && !!resultado.isError
      const gravou = !negado && !falhou ? caminho : null
      const agora = await $.clock.now()
      await mudar($, 'plano', v => (v ? registrar(v, frase, gravou, !existia, falhou, agora) : v))
    }
    return resultado
  }).catch(($, e, next) => next(e))

  // A lista de etapas: criada, avançada, marcada ou concluída.
  on('tool.call', { tool: FERRAMENTAS }, async ($, e, next) => {
    const resultado = await next(e)
    if ('deny' in resultado && resultado.deny) return resultado
    const a = e as unknown as Args
    const agora = await $.clock.now()
    const pedido = est.ultimoPedido
    const antes = est.plano
    let depois: Plano | null = antes
    const nome = String(a.tool)

    if (nome.endsWith('update_plan')) {
      const itens = lista(a.items)
      if (itens.length) {
        const novas = itens.map(i => {
          const x = i as Args
          return { nome: String(x.content ?? 'Etapa'), situacao: situacaoDe(x.status) }
        })
        depois = trocarEtapas(antes, novas, agora, pedido, a.scope === 'new_task' || a.scope === 'first_task')
      } else if (antes && a.advance) {
        depois = avancar(antes, agora)
      } else if (antes && (a.done !== undefined || a.start !== undefined)) {
        depois = marcar(antes, lista(a.done).map(Number), a.start === undefined ? undefined : Number(a.start), agora)
      }
    } else if (nome.endsWith('wrap_up')) {
      if (antes && !antes.concluido) depois = concluirTudo(antes, agora)
    } else if (nome === 'TodoWrite') {
      const novas = lista(a.todos).map(i => {
        const x = i as Args
        return { nome: String(x.content ?? 'Etapa'), situacao: situacaoDe(x.status) }
      })
      depois = trocarEtapas(antes, novas, agora, pedido, false)
    } else if (nome === 'TaskCreate') {
      const r = (resultado as { result?: { task?: { id?: string } } }).result
      const base = antes && !antes.concluido ? antes : trocarEtapas(null, [], agora, pedido, true)
      depois = { ...base, etapas: [...base.etapas, { nome: String(a.subject ?? 'Etapa'), situacao: 'falta', id: r?.task?.id }], atualizado: agora }
      delete depois.concluido
    } else if (nome === 'TaskUpdate' && antes) {
      const id = String(a.taskId ?? '')
      const status = a.status
      let etapas = antes.etapas.map(x => ({ ...x }))
      if (status === 'deleted') etapas = etapas.filter(x => x.id !== id)
      else {
        const alvo = etapas.find(x => x.id === id)
        if (alvo && status) {
          const s = situacaoDe(status)
          if (s === 'agora' && !alvo.inicio) alvo.inicio = agora
          if (s === 'feita') { alvo.fim = agora; alvo.inicio = alvo.inicio ?? agora }
          alvo.situacao = s
        }
        if (alvo && typeof a.subject === 'string') alvo.nome = a.subject
      }
      depois = trocarEtapas(antes, etapas.map(x => ({ nome: x.nome, situacao: x.situacao })), agora, pedido, false)
      depois.etapas.forEach((x, i) => { x.id = etapas[i]?.id; x.acoes = etapas[i]?.acoes; x.usou = etapas[i]?.usou })
    }

    if (depois && depois !== antes) {
      const novo = !antes || antes.concluido || antes.inicio !== depois.inicio
      if (novo) {
        const uso = await usoCincoHoras($)
        if (uso !== undefined) depois = { ...depois, usoInicio: uso, usoAgora: uso }
        await mudar($, 'etapaAberta', () => 0)
      }
      if (depois.concluido) depois = { ...depois, fazendo: undefined }
      const final = depois
      await mudar($, 'plano', () => final)
      if (final.concluido && !antes?.concluido) {
        await mudar($, 'vez', () => 'claude' as Vez)
        await notificar($, `Tarefa concluída em ${duracao(final.concluido - final.inicio)}.`)
      }
      if (novo && final.etapas.length >= 2 && !(est.fechadoPelaPessoa)) {
        void $.ui.open({ id: PAINEL, title: TITULO })
      }
      await guardar($)
    }
    return resultado
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'progresso' }, async $ => {
    const abertos = await $.ui.panes()
    if (abertos.some(p => p.id === PAINEL)) {
      await $.ui.close({ id: PAINEL })
      await mudar($, 'fechadoPelaPessoa', () => true)
      return { text: 'Painel do andamento fechado. Digite /progresso para abrir de novo.' }
    }
    await mudar($, 'fechadoPelaPessoa', () => false)
    await $.ui.open({ id: PAINEL, title: TITULO })
    return { text: 'Painel do andamento aberto.' }
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PAINEL && e.origin.kind === 'person') await mudar($, 'fechadoPelaPessoa', () => true)
    return next(e)
  })

  // Último desenho de cada superfície: a próxima versão anima a partir dele.
  const anteriores = novosAnteriores()
  const usosAnteriores = novosUsos()

  on('ui.render', { component: 'Pane', requestId: PAINEL }, async ($, e) => {
    const { Box, Text, Button, Select } = $.ui.resolve(e)
    const p = est.plano
    const agora = await $.clock.now()
    const aVez = est.vez
    const recolhido = est.compacto
    const aberta = est.etapaAberta
    const turnoAtual = est.turno
    const lim: UsoVisto = est.limites ?? {}
    const recolhido0 = recolhido && !!p && p.etapas.length > 0

    // Uso do plano: anéis no app, barras no terminal.
    let uso: JSX.Element
    if (e.surface === 'terminal') {
      const { Progress } = $.ui.resolve(e)
      const linha = (nome: string, j: { pct: number; renova?: string } | undefined, semanal: boolean) => j && (
        <Box flexDirection="column">
          <Text>{nome} <Text weight="semibold" color={corDoUso(j.pct)}>{Math.round(j.pct)}%</Text> <Text dimColor>· {renovaEm(j.renova, agora, semanal)}</Text></Text>
          <Progress label={`${nome}: uso do limite`} value={Math.min(100, j.pct)} max={100} valueText={`${Math.round(j.pct)}%`} color={corDoUso(j.pct)} />
        </Box>
      )
      uso = (
        <Box flexDirection="column">
          <Text dimColor>USO DO PLANO</Text>
          {!lim.sessao && !lim.semana && <Text dimColor wrap="wrap">Os limites aparecem depois da primeira resposta.</Text>}
          {linha('Sessão atual', lim.sessao, false)}
          {linha('Semana', lim.semana, true)}
          {lim.custo !== undefined && <Text dimColor>Esta conversa: US$ {lim.custo.toFixed(2).replace('.', ',')}</Text>}
        </Box>
      )
    } else {
      const { Svg } = $.ui.resolve(e)
      const chaveUso = `${e.surface}:${recolhido0 ? 'c' : 'p'}`
      const u = svgUso(lim, agora, usosAnteriores.get(chaveUso) ?? null, recolhido0)
      usosAnteriores.set(chaveUso, u.agora)
      uso = <Svg source={u.svg} alt={textoUso(lim, agora)} width={LARG} height={u.altura} />
    }

    // Recursos da conversa: o que entrou no trabalho, com os bloqueios primeiro.
    const usados = est.recursos
    let rec: JSX.Element
    if (e.surface === 'terminal') {
      const linhas = linhasRecursos(usados)
      rec = (
        <Box flexDirection="column">
          <Text dimColor>RECURSOS DA CONVERSA</Text>
          {!linhas.length && <Text dimColor wrap="wrap">Nenhum ainda.</Text>}
          {linhas.map(x => <Text color={x.problema ? COR.erro : undefined} wrap="truncate-end">{x.texto}</Text>)}
        </Box>
      )
    } else {
      const { Svg } = $.ui.resolve(e)
      const d = svgRecursos(usados)
      rec = <Svg source={d.svg} alt={textoRecursos(usados)} width={LARG} height={d.altura} />
    }

    if (!p || !p.etapas.length) {
      return (
        <Box flexDirection="column" gap={1} width={e.surface === 'terminal' ? 34 : undefined} paddingX={e.surface === 'terminal' ? 0 : 'sm'}>
          {uso}
          <Text weight="semibold">Nenhuma tarefa em andamento</Text>
          <Text dimColor wrap="wrap">O andamento aparece aqui quando o Claude montar a lista de etapas de uma tarefa.</Text>
          {rec}
        </Box>
      )
    }

    const r = retrato(p, agora, aVez)
    const ativa = r.estado !== 'concluida'
    const podeParar = ativa && aVez === 'claude' && !!turnoAtual

    // Controles: recolher ou expandir e parar o Claude.
    const controles = (
      <Box flexDirection="row" gap={1}>
        <Button key="tamanho" label={recolhido ? 'Expandir' : 'Recolher'} onPress={() => mudar($, 'compacto', v => !v)} />
        {podeParar && <Button key="parar" label="Parar o Claude" onPress={async () => { await $.turn.abort({ turnId: turnoAtual }) }} />}
      </Box>
    )

    const arquivos = !recolhido && r.arquivos.length > 0 && (
      <Box flexDirection="column">
        <Text dimColor>ARQUIVOS {r.estado === 'concluida' ? 'ENTREGUES' : 'DA TAREFA'}</Text>
        {r.arquivos.slice(-6).reverse().map(a => (
          <Text key={`arquivo-${a.caminho}`} wrap="truncate-end">{`${a.acao === 'criado' ? 'Novo' : 'Alterado'}: ${nomeDoArquivo(a.caminho)}`}</Text>
        ))}
      </Box>
    )

    const comAcoes = r.etapas.map((x, i) => ({ ...x, n: i + 1 })).filter(x => x.situacao !== 'falta')
    const seletor = !recolhido && comAcoes.length > 0 && (
      // Texto em cima e seletor embaixo, os dois dentro da largura da coluna dos desenhos.
      <Box flexDirection="column" gap={0} alignSelf="flex-start" alignItems="stretch">
        <Text dimColor wrap="wrap">Ver o que foi feito numa etapa</Text>
        <Select key="etapa" value={String(aberta)}
          options={[{ value: '0', label: 'Escolha uma etapa' }, ...comAcoes.map(x => ({ value: String(x.n), label: `${x.n}. ${x.nome.length > 22 ? x.nome.slice(0, 21).trimEnd() + '…' : x.nome}` }))]}
          onSelect={v => { void mudar($, 'etapaAberta', () => Number(v) || 0) }} />
      </Box>
    )

    if (e.surface === 'terminal') {
      const { Raster, Progress } = $.ui.resolve(e)
      const c = contar(p)
      const lado = 14
      const marca = (s: string) => (s === 'feita' ? '✓' : s === 'agora' ? '●' : '○')
      return (
        <Box flexDirection="column" gap={1} width={30}>
          {uso}
          <Box flexDirection="column">
            <Text weight="semibold" color={r.cor}>● {r.rotulo}</Text>
            {(r.aviso ?? r.agora) && <Text wrap="wrap">{r.aviso ?? r.agora}</Text>}
            {r.naEtapa && !r.aviso && <Text dimColor>{r.naEtapa}</Text>}
          </Box>
          <Box flexDirection="column">
            <Text weight="semibold">{r.percentual}% <Text dimColor>· {r.feitas} de {r.total} concluídas</Text></Text>
            <Progress label="Trabalho concluído" value={r.feitas} max={Math.max(1, r.total)} valueText={`${r.percentual}%`} color={COR.feita} />
          </Box>
          {!recolhido && (
            <Box flexDirection="column">
              <Text dimColor>DISTRIBUIÇÃO</Text>
              <Raster key="pizza" columns={lado} rows={lado / 2} cells={mosaico(lado, lado / 2, corDaPizza(c, lado))} />
              <Text><Text color={COR.feita}>●</Text> Concluídas {r.feitas}</Text>
              <Text><Text color={COR.agora}>●</Text> Em andamento {r.emCurso}</Text>
              <Text><Text dimColor>●</Text> Pendentes {r.pendentes}</Text>
            </Box>
          )}
          <Box flexDirection="column">
            <Text dimColor>{r.estado === 'concluida' ? 'RESUMO' : 'TEMPO'}</Text>
            {!recolhido && <Raster key="anel" columns={lado} rows={lado / 2} cells={mosaico(lado, lado / 2, corDoAnel(r.tempo.fracao, r.tempo.cor, lado))} />}
            <Text weight="semibold" color={r.tempo.cor}>{r.tempo.valor} {r.tempo.legenda}</Text>
            {!recolhido && r.tempo.linhas.map(l => <Text dimColor wrap="wrap">{l}</Text>)}
          </Box>
          {!recolhido && (
            <Box flexDirection="column">
              <Text dimColor>ETAPAS</Text>
              {r.etapas.slice(0, 10).map(x => (
                <Text color={x.situacao === 'feita' ? COR.feita : x.situacao === 'agora' ? COR.agora : undefined} dimColor={x.situacao === 'falta'} weight={x.situacao === 'agora' ? 'semibold' : 'regular'} wrap="truncate-end">
                  {marca(x.situacao)} {x.nome}{x.duracao ? `  ${x.duracao}` : ''}
                </Text>
              ))}
            </Box>
          )}
          {!recolhido && rec}
          {arquivos}
          {controles}
        </Box>
      )
    }

    const { Svg } = $.ui.resolve(e)
    const chave = `${e.surface}:${recolhido ? 'c' : 'p'}`
    if (recolhido) {
      const d = svgCompacto(r, anteriores.get(chave) ?? null)
      anteriores.set(chave, d.agora)
      return (
        <Box flexDirection="column" gap={1} paddingX="sm">
          {uso}
          <Svg source={d.svg} alt={textoAlternativo(r)} width={LARG} height={d.altura} />
          {controles}
        </Box>
      )
    }
    const d = svgPainel(r, anteriores.get(chave) ?? null)
    anteriores.set(chave, d.agora)
    const et = svgEtapas(r)
    const det = aberta ? svgDetalhe(r, aberta) : null
    return (
      <Box flexDirection="column" gap={1} paddingX="sm">
        {uso}
        <Svg source={d.svg} alt={textoAlternativo(r)} width={LARG} height={d.altura} />
        <Svg source={et.svg} alt={`Etapas: ${r.etapas.map((x, i) => `${i + 1}. ${x.nome} (${x.situacao === 'feita' ? 'concluída' : x.situacao === 'agora' ? 'em andamento' : 'pendente'})`).join('; ')}`} width={LARG} height={et.altura} />
        {seletor}
        {det && <Svg source={det.svg} alt="O que foi feito na etapa escolhida" width={LARG} height={det.altura} />}
        {rec}
        {arquivos}
        {controles}
      </Box>
    )
  })

  // Faixa curta acima da caixa de texto: o mesmo retrato, numa linha.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const p = est.plano
    if (e.props.hasSurvey || !p || !p.etapas.length || p.concluido) return next(e)
    const { Box, Text, Button, Progress } = $.ui.resolve(e)
    const r = retrato(p, await $.clock.now(), est.vez)
    const tempo = `${r.tempo.valor} ${r.tempo.legenda}`
    const texto = r.estado === 'esperando' ? `${r.rotulo.toLowerCase()} · ${r.percentual}%` : `${r.percentual}% · etapa ${r.atual || r.total} de ${r.total} · ${tempo}`
    return (
      <Box flexDirection="row" gap={1} alignItems="center">
        <Box width={14}>
          <Progress label="Trabalho concluído" value={r.feitas} max={Math.max(1, r.total)} valueText={`${r.percentual}%`} color={COR.feita} />
        </Box>
        <Text><Text color={r.cor}>●</Text> {texto}</Text>
        <Button key="ver" label="Ver painel" plain onPress={async () => {
          await mudar($, 'fechadoPelaPessoa', () => false)
          await $.ui.open({ id: PAINEL, title: TITULO })
        }} />
      </Box>
    )
  })
}
