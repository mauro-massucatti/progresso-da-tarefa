# Andamento da tarefa (progresso-da-tarefa)

Mod do Claude Code que mostra, em linguagem simples, quanto da tarefa em andamento na sessão já foi feito e quanto falta.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/tela-escuro.png">
  <img alt="Painel do Mod em cinco situações: em andamento, aguardando você, no começo, concluída, e o modo compacto com o detalhe de uma etapa" src="docs/tela-claro.png">
</picture>

Tema claro: [docs/tela-claro.png](docs/tela-claro.png). Tema escuro: [docs/tela-escuro.png](docs/tela-escuro.png).

## O que aparece

Uma coluna estreita (cerca de 200 px), lida de cima para baixo, desenhada com a paleta da Anthropic (verde oliva para concluída, laranja do Claude para em andamento, kraft para esperando você, cinzas quentes para o resto; nenhum azul):

1. **Estado**: em andamento, aguardando você (o Claude parou e espera sua resposta ou autorização) ou concluída, e a etapa da vez ("Etapa 4 de 5"). Logo abaixo, em palavras comuns, o que está sendo feito agora ("Consultando o STJ", "Escrevendo Parecer.docx"), há quanto tempo na etapa atual e quantas ações deram erro e foram refeitas.
2. **Percentual e barra**: etapas concluídas sobre o total, um único cálculo usado em todo o Mod. A barra mostra o feito e, em laranja claro, a etapa em andamento.
3. **Pizza**: concluídas, em andamento e pendentes, com a tabela das quantidades logo abaixo.
4. **Círculo do tempo**, com o mesmo traço da barra: a previsão de término pelo ritmo das etapas já concluídas; antes da primeira terminar, o tempo decorrido; concluída, a duração total.
5. **Etapas**: linha do tempo vertical com as concluídas, a atual em destaque e as próximas.
6. **Faixa acima da caixa de texto**: uma linha com o percentual, a etapa e o tempo, e o botão "Ver painel"; quando a vez é sua, ela avisa.
7. **Arquivos entregues**: cada arquivo criado ou alterado na tarefa, com botão para abrir.
8. **Resumo ao concluir**: horário de início e fim, etapas, arquivos, ações com erro e quanto do limite de 5 horas a tarefa usou.

## Botões no painel

No fim do painel, juntos: "Recolher" (reduz o painel a percentual, círculo e etapa atual) e "Parar o Claude" (interrompe o trabalho em curso). Acima deles, "Ver o que foi feito numa etapa" mostra a lista do que o Claude fez na etapa escolhida, e cada arquivo entregue tem o botão "Abrir".

## Avisos

Notificação do Mac e aviso na tela quando a tarefa termina e quando o Claude para esperando você.

## Memória entre sessões

O andamento fica guardado por sessão (por até 14 dias): retomar uma sessão traz o painel como estava.

Todos os indicadores saem de um só retrato do estado, então mudam juntos. Ao concluir, estimativas e barras de andamento dão lugar à duração total.

O painel abre sozinho quando o Claude monta uma lista com duas ou mais etapas (se você o fechou, não volta a abrir sozinho na mesma sessão).

## Comandos

`/progresso` abre ou fecha o painel.

## De onde vêm os dados

Da lista de etapas que o Claude mantém na sessão: a do app (abaixo das mensagens, na aba Code) e a do terminal (TodoWrite, TaskCreate e TaskUpdate). O Mod lê essas listas, o texto do seu último pedido (para dar nome à tarefa), o nome das ferramentas que o Claude usa (para dizer, sempre em português, o que está sendo feito) e o percentual do limite de uso. Só executa dois programas do Mac: `open`, quando você aperta "Abrir" num arquivo, e `osascript`, para mostrar a notificação. Não acessa a rede e nada sai do Mac.

## Onde funciona

Terminal e aba Code do app Desktop (no terminal, a pizza e o círculo são desenhados com blocos coloridos), e o painel também na extensão do VS Code. Não aparece no Chat nem no Cowork.

## Instalar

No terminal, na caixa de texto do Claude Code:

```
/plugin install progresso-da-tarefa --marketplace mauro-massucatti/progresso-da-tarefa
```

Responda `y` para adicionar o marketplace e escolha o escopo. Pelo shell:

```bash
claude plugin install progresso-da-tarefa --marketplace mauro-massucatti/progresso-da-tarefa
```

No app Desktop, onde `/plugin` não funciona: clique em + ao lado da caixa de texto, depois Plugins, Add marketplace com `mauro-massucatti/progresso-da-tarefa` e Add plugin.
