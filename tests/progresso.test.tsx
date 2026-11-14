import { expect, test } from 'claude-code/testing'

const PAINEL = {
  plugin: 'progresso-da-tarefa',
  component: 'Pane',
  requestId: 'progresso',
  props: { title: 'Andamento da tarefa', isFocused: false, bodyColumns: 70, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

const FAIXA = {
  plugin: 'progresso-da-tarefa',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isCollapsed: false, isWorking: true, maxRows: 3, bodyColumns: 90, scroll: { offset: 0, bodyRows: 3 }, view: {} },
} as const

let relogio = Date.UTC(2026, 10, 14, 17, 0, 0)
const guardado = new Map<string, unknown>()
const abertos: string[] = []
const avisos: string[] = []

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function motor(on: any) {
  guardado.clear(); abertos.length = 0; avisos.length = 0
  on('clock.now', () => ({ value: relogio }))
  on('clock.every', () => ({ value: null }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.toast', (_: unknown, e: { text?: string }) => { avisos.push(String(e?.text ?? '')); return { value: undefined } })
  on('command.register', (_: unknown, e: { name: string }) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'sessao-teste' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: [{ kind: 'five_hour', percentUsed: 12 }] } }))
  on('store.get', (_: unknown, e: { key: string }) => ({ value: guardado.get(e.key) }))
  on('store.set', (_: unknown, e: { key: string; value: unknown }) => { guardado.set(e.key, e.value); return { value: undefined } })
  on('store.keys', () => ({ value: [...guardado.keys()] }))
  on('store.delete', () => ({ value: undefined }))
  on('fs.exists', () => ({ value: false }))
  on('process.run', (_: unknown, e: { argv: string[] }) => { abertos.push(e.argv.join(' ')); return { value: { code: 0, stdout: '', stderr: '' } } })
  on('tool.call', () => ({ result: {} }))
  on('prompt.submit', (_: unknown, e: { text: string }) => ({ text: e.text }))
  on('command.run', () => ({ text: '' }))
  on('turn.start', (_: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
}

const chamar = ($: { tool: { call: unknown } }, x: unknown) => ($.tool.call as unknown as (x: unknown) => Promise<unknown>)(x)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function desenhos($: any, surface: 'desktop' | 'vscode' = 'desktop') {
  const ui = await $.ui.mount({ ...PAINEL, surface })
  const svgs = await ui.findAll({ type: 'Svg' })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const todos = svgs.map((s: any) => String(s?.props?.source ?? '')).join('\n')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const alt = String((svgs[0] as any)?.props?.alt ?? '')
  return { ui, todos, alt }
}

const PLANO = [
  { content: 'Ler os documentos', status: 'completed' },
  { content: 'Escrever o relatório', status: 'completed' },
  { content: 'Conferir as citações', status: 'completed' },
  { content: 'Revisar', status: 'in_progress' },
  { content: 'Enviar', status: 'pending' },
]

test('todos os indicadores contam o mesmo estado, sem azul e com o texto do círculo inteiro', async ($, on) => {
  motor(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true } as never)
  await chamar($, { tool: 'mcp__ccd_turn__update_plan', scope: 'new_task', items: PLANO })
  const { ui, todos, alt } = await desenhos($)
  expect(todos).toContain('>60<tspan')
  expect(todos).toContain('3 de 5 concluídas')
  expect(todos).toContain('Etapa 4 de 5')
  expect(todos).toContain('EM ANDAMENTO')
  expect(todos).toContain('&lt;1 min')
  expect(todos).not.toContain('>menos de 1 min<')
  expect(todos.toLowerCase()).not.toContain('#6a9bcc')
  expect(alt).toContain('60% concluído, 3 de 5 etapas concluídas, 1 em andamento, 1 pendentes')
  await ui.unmount()

  const faixa = await $.ui.mount({ ...FAIXA, surface: 'desktop' } as never)
  expect(await faixa.find({ type: 'Text', text: /60% · etapa 4 de 5/ })).toBeTruthy()
  await faixa.unmount()
})

test('mostra o que está sendo feito, registra arquivos e abre o arquivo com um clique', async ($, on) => {
  motor(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true } as never)
  await chamar($, { tool: 'mcp__ccd_turn__update_plan', scope: 'new_task', items: PLANO })
  await chamar($, { tool: 'mcp__stj__stj_jurisprudencia_buscar', termo: 'x' })
  await chamar($, { tool: 'Write', file_path: '/tmp/Parecer final.docx', content: 'x' })
  const { ui, todos } = await desenhos($)
  expect(todos).toContain('Escrevendo Parecer final.docx')
  const botao = await ui.find({ type: 'Button', key: 'abrir-/tmp/Parecer final.docx' })
  expect(botao).toBeTruthy()
  await ui.press({ key: 'abrir-/tmp/Parecer final.docx' })
  expect(abertos.some(x => x.startsWith('open /tmp/Parecer final.docx'))).toBe(true)

  await ui.select({ key: 'etapa', value: '4' })
  await ui.unmount()
  const depois = await desenhos($)
  expect(depois.todos).toContain('Consultando o STJ')
  await depois.ui.unmount()
})

test('quando o turno termina com a tarefa aberta, a vez é da pessoa', async ($, on) => {
  motor(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true } as never)
  await $.turn.start({ text: 'faz', turnId: 't1' } as never)
  await chamar($, { tool: 'mcp__ccd_turn__update_plan', scope: 'new_task', items: PLANO })
  const antes = await desenhos($)
  expect(await antes.ui.find({ type: 'Button', key: 'parar' })).toBeTruthy()
  await antes.ui.unmount()
  await $.turn.complete({ turnId: 't1', answer: '', durationMs: 1, isAborted: false } as never)
  const { ui, todos } = await desenhos($)
  expect(todos).toContain('AGUARDANDO VOCÊ')
  expect(todos).toContain('O Claude parou e espera sua')
  expect(await ui.find({ type: 'Button', key: 'parar' })).toBeFalsy()
  await ui.unmount()
  // O andamento ficou guardado para a sessão retomada.
  expect(guardado.has('sessao:sessao-teste')).toBe(true)
})

test('modo compacto', async ($, on) => {
  motor(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true } as never)
  await chamar($, { tool: 'mcp__ccd_turn__update_plan', scope: 'new_task', items: PLANO })
  const { ui, todos } = await desenhos($)
  expect(todos).not.toContain('prazo')
  expect(await ui.find({ type: 'Button', key: 'p30' })).toBeFalsy()
  await ui.press({ key: 'tamanho' })
  await ui.unmount()
  const compacto = await desenhos($)
  expect(compacto.todos).toContain('ETAPA ATUAL')
  expect(compacto.todos).not.toContain('DISTRIBUIÇÃO')
  await compacto.ui.unmount()
})

test('ao concluir, mostra o resumo e nenhuma estimativa', async ($, on) => {
  motor(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true } as never)
  await chamar($, { tool: 'mcp__ccd_turn__update_plan', scope: 'new_task', items: PLANO })
  relogio += 5 * 60_000
  await chamar($, { tool: 'mcp__ccd_turn__update_plan', advance: true })
  relogio += 5 * 60_000
  await chamar($, { tool: 'mcp__ccd_turn__wrap_up', recap: 'pronto' })
  const { ui, todos } = await desenhos($)
  expect(todos).toContain('CONCLUÍDA')
  expect(todos).toContain('RESUMO')
  expect(todos).toContain('>100<tspan')
  expect(todos).toContain('5 etapas concluídas')
  expect(todos).not.toContain('restantes')
  expect(todos).not.toContain('Término previsto')
  await ui.unmount()
  expect(avisos.some(a => a.startsWith('Tarefa concluída'))).toBe(true)
  const faixa = await $.ui.mount({ ...FAIXA, surface: 'desktop' } as never)
  expect(await faixa.find({ type: 'Text', text: /%/ })).toBeFalsy()
  await faixa.unmount()
})

test('sem tarefa, o painel explica o que vai aparecer', async ($, on) => {
  motor(on)
  const ui = await $.ui.mount({ ...PAINEL, surface: 'desktop' } as never)
  expect((await ui.find({ type: 'Text', text: /Nenhuma tarefa/ }))?.text).toBe('Nenhuma tarefa em andamento')
  await ui.unmount()
})
