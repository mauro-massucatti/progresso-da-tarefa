// O que o Claude está fazendo, dito em palavras comuns, e o registro do que a tarefa produziu.
import type { Arquivo, Plano } from '../types'

const base = (caminho: unknown): string => {
  const s = String(caminho ?? '')
  const nome = s.split('/').filter(Boolean).pop() ?? s
  return nome.length > 34 ? nome.slice(0, 31) + '...' : nome
}
const curto = (s: unknown, n = 40): string => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n - 3).trimEnd() + '...' : t
}

// Servidores conhecidos, pelo trecho do nome da ferramenta (mcp__<servidor>__<ferramenta>).
const SERVIDORES: [RegExp, string][] = [
  [/^stj$/, 'Consultando o STJ'],
  [/^tjes$/, 'Consultando o TJES'],
  [/^jusia$/, 'Consultando a Jus IA'],
  [/^legislacao$/, 'Conferindo a lei no Planalto'],
  [/^datajud$/, 'Consultando processos no DataJud'],
  [/^notebooklm$/, 'Consultando o NotebookLM'],
  [/^gemini$/, 'Consultando o Gemini'],
  [/^zotero$/, 'Consultando o Zotero'],
  [/^(mcp-obsidian|qmd|graphify)$/, 'Consultando o vault'],
  [/^brasilapi$/, 'Consultando dados públicos'],
  [/^diligencia$/, 'Pesquisando em fontes públicas'],
  [/^(docling|adeu)$/, 'Lendo um documento'],
  [/^devonthink$/, 'Consultando o DEVONthink'],
  [/^apple-events$/, 'Consultando lembretes e agenda'],
  [/^transcribex$/, 'Transcrevendo áudio'],
  [/^(claude-in-chrome|Claude_Browser)$/, 'Usando o navegador'],
  [/^computer-use$/, 'Usando o computador'],
  [/^scheduled-tasks$/, 'Cuidando de uma rotina agendada'],
]

// Ferramentas internas que não são trabalho visível para a pessoa.
const SILENCIO = /^(TodoWrite|TaskCreate|TaskUpdate|TaskGet|TaskList|ToolSearch|mcp__ccd_.*|mcp__plugin-authoring__.*)$/

// A descrição do comando só aparece quando já está em português; senão, uma frase pelo tipo de comando.
const PORTUGUES = /[áàâãéêíóôõúç]|\b(da|de|para|com|dos|das|uma|nos|nas|pela|pelo|que|sem)\b/i
const COMANDOS: [RegExp, string][] = [
  [/^git (commit|push|tag)\b/, 'Salvando uma versão'],
  [/^git\b/, 'Conferindo o histórico de versões'],
  [/^gh\b/, 'Usando o GitHub'],
  [/^claude plugin (test|validate)\b|^(npm|bun|yarn|pnpm) (run )?test\b|^(pytest|tsc|vitest|jest)\b/, 'Testando'],
  [/^(npm|brew|pip3?|uv|bun|yarn|pnpm) (install|add|sync|upgrade)\b/, 'Instalando um programa'],
  [/^(grep|rg|find|ls|fd|mdfind)\b/, 'Procurando nos arquivos'],
  [/^(cat|head|tail|less|wc|sed -n|jq)\b/, 'Lendo arquivos'],
  [/^(rm|trash)\b/, 'Removendo arquivos'],
  [/^(cp|mv|rsync|mkdir|sed -i|ln|touch|unzip|zip|tar)\b/, 'Organizando arquivos'],
  [/^(curl|wget)\b/, 'Consultando a internet'],
  [/^(osascript|open|shortcuts)\b/, 'Usando um app do Mac'],
  [/^(python3?|node|npx|bun|deno|uv run|swift|ruby|perl)\b/, 'Executando um programa'],
  [/^claude\b/, 'Usando o Claude Code'],
]
function fraseDoComando(comando: unknown, descricao: unknown): string {
  const d = String(descricao ?? '').trim()
  if (d && PORTUGUES.test(d)) return curto(d)
  // Primeiro comando que faz algo: pula cd, export, variáveis e afins.
  const partes = String(comando ?? '').split(/&&|\|\||;|\n|\|/).map(x => x.trim().replace(/^(sudo|env|time|command)\s+/, '').replace(/^[A-Z_]+=\S*\s+/, ''))
  const uteis = partes.filter(p => p && !/^[A-Za-z_][A-Za-z0-9_]*=\S*$/.test(p) && !/^(cd|export|set|source|\.|echo|printf|true|:|if|then|fi|for|do|done|else)\b/.test(p))
  // O que mais pesa decide: salvar versão vence ler o histórico, testar vence procurar.
  for (const [rx, frase] of COMANDOS) if (uteis.some(p => rx.test(p))) return frase
  return 'Executando um comando'
}

export function acaoEmPalavras(tool: string, a: Record<string, unknown>): string | null {
  if (SILENCIO.test(tool)) return null
  switch (tool) {
    case 'Read': return `Lendo ${base(a.file_path)}`
    case 'Write': return `Escrevendo ${base(a.file_path)}`
    case 'Edit': case 'MultiEdit': case 'NotebookEdit': return `Editando ${base(a.file_path ?? a.notebook_path)}`
    case 'Bash': return fraseDoComando(a.command, a.description)
    case 'Grep': case 'Glob': return 'Procurando nos arquivos'
    case 'WebFetch': return 'Lendo uma página da web'
    case 'WebSearch': return a.query ? `Pesquisando na web: ${curto(a.query, 28)}` : 'Pesquisando na web'
    case 'Agent': case 'Task': return 'Pedindo ajuda a um assistente'
    case 'AskUserQuestion': return 'Fazendo uma pergunta a você'
    case 'Skill': return a.skill ? `Usando a habilidade ${curto(a.skill, 24)}` : 'Usando uma habilidade'
    case 'Artifact': return 'Preparando uma página'
    case 'SendUserFile': return 'Enviando um arquivo a você'
  }
  const m = tool.match(/^mcp__(.+?)__(.+)$/)
  if (m) {
    const servidor = m[1] ?? ''
    for (const [rx, frase] of SERVIDORES) if (rx.test(servidor)) return frase
    return `Usando ${servidor.replace(/[-_]/g, ' ')}`
  }
  return 'Usando uma ferramenta'
}

// Ferramentas que gravam arquivo, e onde fica o caminho.
export function arquivoGravado(tool: string, a: Record<string, unknown>): string | null {
  if (tool === 'Write' || tool === 'Edit' || tool === 'MultiEdit') return typeof a.file_path === 'string' ? a.file_path : null
  if (tool === 'NotebookEdit') return typeof a.notebook_path === 'string' ? a.notebook_path : null
  return null
}

// Junta o que aconteceu numa chamada ao plano: ação da etapa atual, arquivo entregue, erro.
export function registrar(plano: Plano, frase: string | null, arquivo: string | null, novo: boolean, erro: boolean, agora: number): Plano {
  const p: Plano = { ...plano, etapas: plano.etapas.map(e => ({ ...e })), atualizado: agora }
  const atual = p.etapas.find(e => e.situacao === 'agora')
  if (frase && atual) {
    const lista = atual.acoes ?? []
    if (lista[lista.length - 1] !== frase) atual.acoes = [...lista, frase].slice(-12)
  }
  if (arquivo) {
    const lista = (p.arquivos ?? []).filter(x => x.caminho !== arquivo)
    const antes = (p.arquivos ?? []).find(x => x.caminho === arquivo)
    p.arquivos = [...lista, { caminho: arquivo, acao: (antes?.acao === 'criado' || novo ? 'criado' : 'alterado') as Arquivo['acao'], quando: agora }].slice(-12)
  }
  if (erro && frase) p.erros = [...(p.erros ?? []), { quando: agora, oque: frase }].slice(-10)
  return p
}

export const nomeDoArquivo = base
