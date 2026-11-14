import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Plano, Prazo, Vez } from '../types'
import { avancar, concluirTudo, contar, corDaPizza, corDoAnel, duracao, hora, lerPrazo, marcar, mosaico, situacaoDe, trocarEtapas } from './logica'
import { COR, L, retrato, svgCompacto, svgDetalhe, svgEtapas, svgPainel, textoAlternativo } from './desenho'
import type { Anterior } from './desenho'
import { acaoEmPalavras, arquivoGravado, nomeDoArquivo, registrar } from './acoes'

const PAINEL = 'progresso'
const TITULO = 'Andamento da tarefa'
const MIN = 60_000
// Mude a etiqueta quando o formato de um valor mudar: o valor antigo é ignorado.
const plano = atom({ plugin: 'progresso-da-tarefa', key: 'plano' } as const, null, { shape: 'plano-2' })
const prazo = atom({ plugin: 'progresso-da-tarefa', key: 'prazo' } as const, null, { shape: 'prazo-2' })
const ultimoPedido = atom({ plugin: 'progresso-da-tarefa', key: 'ultimoPedido' } as const, '')
const fechadoPelaPessoa = atom({ plugin: 'progresso-da-tarefa', key: 'fechadoPelaPessoa' } as const, false)
const vez = atom({ plugin: 'progresso-da-tarefa', key: 'vez' } as const, 'claude' as Vez)
const compacto = atom({ plugin: 'progresso-da-tarefa', key: 'compacto' } as const, false)
const etapaAberta = atom({ plugin: 'progresso-da-tarefa', key: 'etapaAberta' } as const, 0)
const turno = atom({ plugin: 'progresso-da-tarefa', key: 'turno' } as const, '')

// As listas de etapas que o Mod acompanha: a do app (abaixo das mensagens) e as do terminal.
const FERRAMENTAS = ['mcp__ccd_turn__update_plan', 'mcp__ccd_turn__wrap_up', 'TodoWrite', 'TaskCreate', 'TaskUpdate'] as const

type Args = Record<string, unknown>
type Eng = EngineInterface
const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : typeof v === 'string' ? jsonLista(v) : [])
function jsonLista(s: string): unknown[] {
  try { const v = JSON.parse(s); return Array.isArray(v) ? v : [] } catch { return [] }
}

// Percentual do limite de 5 horas na última resposta, quando o plano informa.
async function usoCincoHoras($: Eng): Promise<number | undefined> {
  try {
    const u = await $.session.usage()
    const janela = u.rateLimits.find(x => /five|5/.test(x.kind))
    return janela ? janela.percentUsed : undefined
  } catch { return undefined }
}

// Guarda o andamento fora da sessão, para sobreviver ao fechamento do app.
async function guardar($: Eng) {
  try {
    const id = await $.session.id()
    await $.store.set(`sessao:${id}`, { plano: await read($, plano), prazo: await read($, prazo), quando: await $.clock.now() })
  } catch { /* guardar é conveniência: falhar não pode atrapalhar a tarefa */ }
}

// Aviso do sistema (Central de Notificações do macOS), além do aviso dentro do app.
async function notificar($: Eng, texto: string) {
  $.ui.toast(texto, { timeoutMs: 8000 })
  const limpo = texto.replace(/["\\]/g, '')
  try { await $.process.run(['osascript', '-e', `display notification "${limpo}" with title "${TITULO}"`], { timeoutMs: 5000 }) } catch { /* sem aviso do sistema, fica o do app */ }
}

// Marca, troca ou retira o prazo, pelo comando ou pelos botões.
async function marcarPrazo($: Eng, texto: string): Promise<string> {
  const agora = await $.clock.now()
  const lido = lerPrazo(texto, agora)
  if (lido === 'invalido') return 'Não entendi o prazo. Exemplos: /prazo 30min, /prazo 1h30, /prazo 18:30, /prazo limpar.'
  await update($, prazo, () => lido as Prazo | null)
  await guardar($)
  if (!lido) return 'Prazo retirado. O círculo volta a mostrar a previsão pelo ritmo.'
  return `Prazo marcado para ${hora(lido.ate)} (daqui a ${duracao(lido.ate - agora)}).`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'progresso', description: 'Abre ou fecha o painel com o andamento da tarefa' })
    await $.command.register({ name: 'prazo', description: 'Marca o prazo da tarefa: /prazo 30min, /prazo 1h30, /prazo 18:30 ou /prazo limpar', argumentHint: '[30min | 1h30 | 18:30 | limpar]' })

    // Sessão retomada: recupera o andamento guardado e apaga o que tiver mais de 14 dias.
    try {
      const id = await $.session.id()
      const agora = await $.clock.now()
      if (!(await read($, plano))) {
        const salvo = (await $.store.get(`sessao:${id}`)) as { plano?: Plano | null; prazo?: Prazo | null } | undefined
        if (salvo?.plano) await update($, plano, () => salvo.plano ?? null)
        if (salvo?.prazo) await update($, prazo, () => salvo.prazo ?? null)
      }
      for (const chave of await $.store.keys()) {
        if (!chave.startsWith('sessao:')) continue
        const v = (await $.store.get(chave)) as { quando?: number } | undefined
        if (!v?.quando || agora - v.quando > 14 * 24 * 60 * MIN) await $.store.delete(chave)
      }
    } catch { /* sem memória guardada, começa vazio */ }

    // A cada 30 segundos: redesenha o relógio e confere os avisos de prazo.
    $.clock.every(30_000, () => {
      $.ui.invalidate('ui.render')
      void (async () => {
        const p = await read($, plano)
        const pr = await read($, prazo)
        if (!p || !pr || p.concluido) return
        const falta = pr.ate - (await $.clock.now())
        const c = contar(p)
        if (falta <= 0 && !pr.avisouVencido) {
          await update($, prazo, v => (v ? { ...v, avisou5: true, avisouVencido: true } : v))
          await notificar($, `O prazo das ${hora(pr.ate)} venceu. Faltam ${c.total - c.feitas} etapas.`)
        } else if (falta > 0 && falta <= 5 * MIN && !pr.avisou5) {
          await update($, prazo, v => (v ? { ...v, avisou5: true } : v))
          await notificar($, `Faltam ${duracao(falta)} para o prazo (${hora(pr.ate)}).`)
        }
      })()
    })
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    const texto = typeof e.text === 'string' ? e.text : ''
    if (texto && !texto.startsWith('/')) await update($, ultimoPedido, () => texto)
    await update($, vez, () => 'claude' as Vez)
    return next(e)
  })

  // De quem é a vez: o turno do Claude começa e termina.
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      await update($, turno, () => e.turnId)
      await update($, vez, () => 'claude' as Vez)
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      await update($, turno, () => '')
      const p = await read($, plano)
      if (p && p.etapas.length && !p.concluido) {
        await update($, vez, () => 'voce' as Vez)
        await update($, plano, v => (v ? { ...v, fazendo: undefined } : v))
        $.ui.toast('O Claude parou e espera sua resposta.', { timeoutMs: 6000 })
      }
      const uso = await usoCincoHoras($)
      if (uso !== undefined) await update($, plano, v => (v ? { ...v, usoAgora: uso } : v))
      await guardar($)
    }
    return next(e)
  })

  // Pedido de autorização: a vez passa a ser da pessoa até a chamada seguir.
  on('tool.check', async ($, e, next) => {
    const r = await next(e)
    if (r.decision === 'ask' && e.agentId === undefined) await update($, vez, () => 'autorizacao' as Vez)
    return r
  }).catch(($, e, next) => next(e))

  // Toda chamada: o que está sendo feito, na etapa atual, e o que ela produziu.
  on('tool.call', async ($, e, next) => {
    const a = e as unknown as Args
    const tool = String(a.tool)
    const frase = acaoEmPalavras(tool, a)
    const p0 = await read($, plano)
    const ativo = !!p0 && !p0.concluido && p0.etapas.length > 0
    let existia = true
    const caminho = arquivoGravado(tool, a)
    if (caminho) { try { existia = await $.fs.exists(caminho) } catch { existia = true } }
    if (tool === 'AskUserQuestion') await update($, vez, () => 'pergunta' as Vez)
    else if ((await read($, vez)) === 'autorizacao') await update($, vez, () => 'claude' as Vez)
    if (ativo && frase) await update($, plano, v => (v ? { ...v, fazendo: frase } : v))

    const resultado = await next(e)

    if (tool === 'AskUserQuestion') await update($, vez, () => 'claude' as Vez)
    if (ativo && frase) {
      const negado = 'deny' in resultado && !!resultado.deny
      const falhou = !negado && !!resultado.isError
      const gravou = !negado && !falhou ? caminho : null
      const agora = await $.clock.now()
      await update($, plano, v => (v ? registrar(v, frase, gravou, !existia, falhou, agora) : v))
    }
    return resultado
  }).catch(($, e, next) => next(e))

  // A lista de etapas: criada, avançada, marcada ou concluída.
  on('tool.call', { tool: FERRAMENTAS }, async ($, e, next) => {
    const resultado = await next(e)
    if ('deny' in resultado && resultado.deny) return resultado
    const a = e as unknown as Args
    const agora = await $.clock.now()
    const pedido = await read($, ultimoPedido)
    const antes = await read($, plano)
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
      depois.etapas.forEach((x, i) => { x.id = etapas[i]?.id; x.acoes = etapas[i]?.acoes })
    }

    if (depois && depois !== antes) {
      const novo = !antes || antes.concluido || antes.inicio !== depois.inicio
      if (novo) {
        const uso = await usoCincoHoras($)
        if (uso !== undefined) depois = { ...depois, usoInicio: uso, usoAgora: uso }
        await update($, etapaAberta, () => 0)
      }
      if (depois.concluido) depois = { ...depois, fazendo: undefined }
      const final = depois
      await update($, plano, () => final)
      if (final.concluido && !antes?.concluido) {
        await update($, vez, () => 'claude' as Vez)
        $.ui.toast(`Tarefa concluída em ${duracao(final.concluido - final.inicio)}.`, { timeoutMs: 8000 })
      }
      if (novo && final.etapas.length >= 2 && !(await read($, fechadoPelaPessoa))) {
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
      await update($, fechadoPelaPessoa, () => true)
      return { text: 'Painel do andamento fechado. Digite /progresso para abrir de novo.' }
    }
    await update($, fechadoPelaPessoa, () => false)
    await $.ui.open({ id: PAINEL, title: TITULO })
    return { text: 'Painel do andamento aberto.' }
  })

  on('command.run', { command: 'prazo' }, async ($, e) => {
    if (!e.args.trim()) {
      const p = await read($, prazo)
      const agora = await $.clock.now()
      return { text: p ? `Prazo marcado: ${hora(p.ate)} (faltam ${duracao(p.ate - agora)}). Para tirar: /prazo limpar.` : 'Nenhum prazo marcado. Exemplos: /prazo 30min, /prazo 1h30, /prazo 18:30.' }
    }
    return { text: await marcarPrazo($, e.args) }
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PAINEL && e.origin.kind === 'person') await update($, fechadoPelaPessoa, () => true)
    return next(e)
  })

  // Último desenho de cada superfície: a próxima versão anima a partir dele.
  const anteriores = new Map<string, Anterior>()

  on('ui.render', { component: 'Pane', requestId: PAINEL }, async ($, e) => {
    const { Box, Text, Button, Select } = $.ui.resolve(e)
    const p = await read($, plano)
    const pr = await read($, prazo)
    const agora = await $.clock.now()
    const aVez = await read($, vez)
    const recolhido = await read($, compacto)
    const aberta = await read($, etapaAberta)
    const turnoAtual = await read($, turno)

    if (!p || !p.etapas.length) {
      return (
        <Box flexDirection="column" gap={1} width={34}>
          <Text weight="semibold">Nenhuma tarefa em andamento</Text>
          <Text dimColor wrap="wrap">O andamento aparece aqui quando o Claude montar a lista de etapas de uma tarefa.</Text>
          <Text dimColor wrap="wrap">{pr ? `Prazo marcado: ${hora(pr.ate)}.` : 'Para marcar um prazo: /prazo 30min ou /prazo 18:30.'}</Text>
        </Box>
      )
    }

    const r = retrato(p, pr, agora, aVez)
    const ativa = r.estado !== 'concluida'
    const podeParar = ativa && aVez === 'claude' && !!turnoAtual

    // Controles: recolher ou expandir, parar o Claude e marcar o prazo com um clique.
    const controles = (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" gap={1}>
          <Button key="tamanho" label={recolhido ? 'Expandir' : 'Recolher'} onPress={() => update($, compacto, v => !v)} />
          {podeParar && <Button key="parar" label="Parar o Claude" onPress={async () => { await $.turn.abort({ turnId: turnoAtual }) }} />}
        </Box>
        {ativa && !recolhido && (
          <Box flexDirection="row" gap={1}>
            <Text dimColor>Prazo</Text>
            <Button key="p30" label="30 min" plain onPress={async () => { await marcarPrazo($, '30min') }} />
            <Button key="p60" label="1 h" plain onPress={async () => { await marcarPrazo($, '1h') }} />
            <Button key="p120" label="2 h" plain onPress={async () => { await marcarPrazo($, '2h') }} />
            {pr && <Button key="p0" label="Sem prazo" plain onPress={async () => { await marcarPrazo($, 'limpar') }} />}
          </Box>
        )}
      </Box>
    )

    const arquivos = !recolhido && r.arquivos.length > 0 && (
      <Box flexDirection="column">
        <Text dimColor>ARQUIVOS {r.estado === 'concluida' ? 'ENTREGUES' : 'DA TAREFA'}</Text>
        {r.arquivos.slice(-6).reverse().map(a => (
          <Button key={`abrir-${a.caminho}`} label={`${a.acao === 'criado' ? 'Novo' : 'Alterado'}: ${nomeDoArquivo(a.caminho)}`} plain onPress={async () => {
            await $.process.run(['open', a.caminho], { timeoutMs: 10_000 })
          }} />
        ))}
      </Box>
    )

    const comAcoes = r.etapas.map((x, i) => ({ ...x, n: i + 1 })).filter(x => x.situacao !== 'falta')
    const seletor = !recolhido && comAcoes.length > 0 && (
      <Select key="etapa" label="Ver o que foi feito numa etapa" value={String(aberta)}
        options={[{ value: '0', label: 'Escolha uma etapa' }, ...comAcoes.map(x => ({ value: String(x.n), label: `${x.n}. ${x.nome.length > 32 ? x.nome.slice(0, 31) + '…' : x.nome}` }))]}
        onSelect={v => { void update($, etapaAberta, () => Number(v) || 0) }} />
    )

    if (e.surface === 'terminal') {
      const { Raster, Progress } = $.ui.resolve(e)
      const c = contar(p)
      const lado = 14
      const marca = (s: string) => (s === 'feita' ? '✓' : s === 'agora' ? '●' : '○')
      return (
        <Box flexDirection="column" gap={1} width={30}>
          {controles}
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
          {arquivos}
        </Box>
      )
    }

    const { Svg } = $.ui.resolve(e)
    const chave = `${e.surface}:${recolhido ? 'c' : 'p'}`
    if (recolhido) {
      const d = svgCompacto(r, anteriores.get(chave) ?? null)
      anteriores.set(chave, d.agora)
      return (
        <Box flexDirection="column" gap={1}>
          {controles}
          <Svg source={d.svg} alt={textoAlternativo(r)} width={L + 4} height={d.altura} isInteractive />
        </Box>
      )
    }
    const d = svgPainel(r, anteriores.get(chave) ?? null)
    anteriores.set(chave, d.agora)
    const et = svgEtapas(r)
    const det = aberta ? svgDetalhe(r, aberta) : null
    return (
      <Box flexDirection="column" gap={1}>
        {controles}
        <Svg source={d.svg} alt={textoAlternativo(r)} width={L + 4} height={d.altura} isInteractive />
        <Svg source={et.svg} alt={`Etapas: ${r.etapas.map((x, i) => `${i + 1}. ${x.nome} (${x.situacao === 'feita' ? 'concluída' : x.situacao === 'agora' ? 'em andamento' : 'pendente'})`).join('; ')}`} width={L + 4} height={et.altura} isInteractive />
        {seletor}
        {det && <Svg source={det.svg} alt="O que foi feito na etapa escolhida" width={L + 4} height={det.altura} isInteractive />}
        {arquivos}
      </Box>
    )
  })

  // Faixa curta acima da caixa de texto: o mesmo retrato, numa linha.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const p = await read($, plano)
    if (e.props.hasSurvey || !p || !p.etapas.length || p.concluido) return next(e)
    const { Box, Text, Button, Progress } = $.ui.resolve(e)
    const r = retrato(p, await read($, prazo), await $.clock.now(), await read($, vez))
    const tempo = r.estado === 'vencida' ? `prazo vencido há ${r.tempo.valor}` : `${r.tempo.valor} ${r.tempo.legenda}`
    const texto = r.estado === 'esperando' ? `${r.rotulo.toLowerCase()} · ${r.percentual}%` : `${r.percentual}% · etapa ${r.atual || r.total} de ${r.total} · ${tempo}`
    return (
      <Box flexDirection="row" gap={1} alignItems="center">
        <Box width={14}>
          <Progress label="Trabalho concluído" value={r.feitas} max={Math.max(1, r.total)} valueText={`${r.percentual}%`} color={COR.feita} />
        </Box>
        <Text><Text color={r.cor}>●</Text> {texto}</Text>
        <Button key="ver" label="Ver painel" plain onPress={async () => {
          await update($, fechadoPelaPessoa, () => false)
          await $.ui.open({ id: PAINEL, title: TITULO })
        }} />
      </Box>
    )
  })
}
