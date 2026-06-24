# IRRF eSocial — Extensão para Google Chrome

Extensão (Manifest V3) que **automatiza a extração e o download dos arquivos
XML de IRRF por colaborador** diretamente no ambiente do eSocial.

O usuário faz login no eSocial e seleciona a empresa desejada; a extensão
percorre, para cada CPF informado e cada competência do período, a consulta de
IRRF, baixa os XMLs disponíveis e os organiza em pastas individuais por
colaborador.

---

## Sumário

- [Instalação](#instalação)
- [Como usar](#como-usar)
- [Estrutura de pastas dos downloads](#estrutura-de-pastas-dos-downloads)
- [Arquitetura](#arquitetura)
- [⚠️ Mapeamento do eSocial (ajuste obrigatório)](#️-mapeamento-do-esocial-ajuste-obrigatório)
- [Como os requisitos foram atendidos](#como-os-requisitos-foram-atendidos)
- [Limitações e notas técnicas](#limitações-e-notas-técnicas)

---

## Instalação

1. Abra o Chrome em `chrome://extensions`.
2. Ative o **Modo do desenvolvedor** (canto superior direito).
3. Clique em **Carregar sem compactação** e selecione a pasta deste projeto
   (a que contém o `manifest.json`).
4. O ícone do **IRRF eSocial** aparecerá na barra de extensões. Clicar nele
   abre o **painel lateral** (side panel).

> Requer Chrome 116+ (uso de `chrome.sidePanel`).

## Como usar

1. Faça **login no eSocial** e entre na **empresa** desejada, deixando a aba
   aberta.
2. Clique no ícone da extensão para abrir o painel lateral.
3. Em **Aba do eSocial**, selecione a aba onde o eSocial está aberto
   (use ↻ para atualizar a lista).
4. Informe a **competência inicial** e a **competência final**
   (pode ser a mesma para baixar apenas um mês).
5. Cole a **lista de CPFs** — um por linha, com ou sem máscara
   (`123.456.789-00` ou `12345678900`). CPFs inválidos/duplicados são
   sinalizados e descartados.
6. (Opcional) Em **Opções avançadas**, ajuste a pasta raiz e a ordem de
   varredura.
7. Clique em **Iniciar**.

Durante a execução o painel mostra progresso, competência/CPF atuais, total de
XMLs baixados, tempo restante estimado e botões **Pausar / Retomar / Cancelar**.
A execução roda em segundo plano: você pode trocar de aba, navegar e até fechar
o painel — ao reabri-lo o estado atual é exibido novamente.

## Estrutura de pastas dos downloads

Os arquivos são salvos na pasta de Downloads do navegador:

```
IRRF eSocial/
├── Fulano de Tal/
│   ├── 2024-01.xml
│   ├── 2024-02.xml
│   └── ...
├── Ciclano de Souza/
│   ├── 2024-01.xml
│   └── ...
```

A pasta de cada colaborador usa o **nome identificado no eSocial**. Caso o nome
não seja localizado, usa-se o **CPF** como identificador. Quando há mais de um
XML para a mesma competência, é adicionado um sufixo numérico
(`2024-01-1.xml`, `2024-01-2.xml`).

## Arquitetura

Scripts clássicos compartilhando um namespace global (`self.IRRF`), sem etapa de
build/bundler.

```
manifest.json
icons/                         ícones 16/48/128
src/
├── common/                    código compartilhado por todos os contextos
│   ├── namespace.js           cria o namespace global
│   ├── constants.js           mensagens, status, config padrão
│   ├── cpf.js                 normaliza/valida/parseia CPFs
│   ├── competencia.js         gera intervalos de competências
│   └── storage.js             persistência do estado (chrome.storage.local)
├── background/                service worker (orquestração)
│   ├── service-worker.js      ponto de entrada; roteia mensagens
│   ├── orchestrator.js        máquina de estados / fila / recuperação
│   └── downloader.js          grava os XMLs com a estrutura de pastas
├── content/                   roda nas páginas do eSocial
│   ├── esocial-adapter.js     *** mapeamento do DOM do eSocial ***
│   └── content-script.js      recebe ordens e devolve os XMLs
└── sidepanel/                 interface (UI)
    ├── panel.html
    ├── panel.css
    └── panel.js
```

**Fluxo:** a UI envia a configuração ao *service worker*, que monta uma fila de
tarefas (CPF × competência) e a percorre. Para cada tarefa, ele aciona o
*content script* da aba do eSocial, que navega/consulta e devolve o conteúdo dos
XMLs; o *service worker* então grava cada arquivo na pasta do colaborador. Todo
o progresso é persistido a cada passo, permitindo retomada após quedas.

## ⚠️ Mapeamento do eSocial (ajuste obrigatório)

> **Importante:** O escopo (item 9) prevê o fornecimento de **capturas de tela
> do fluxo do eSocial** para identificar os elementos da página. Como essas
> telas ainda não foram fornecidas, **toda a lógica que depende do DOM do
> eSocial está isolada em um único arquivo**:
>
> ```
> src/content/esocial-adapter.js
> ```
>
> Os seletores atuais (`SEL`) e a sequência de passos em `coletar()` são um
> **ponto de partida genérico** (heurísticas por atributo/texto) e **precisam
> ser confirmados/ajustados** com as telas reais antes do uso em produção.
>
> O restante da extensão (interface, fila, downloads, recuperação, controles)
> está completo e **não precisa ser alterado** quando os seletores forem
> ajustados. Basta:
>
> 1. atualizar os seletores em `SEL`;
> 2. se necessário, adaptar a navegação em `coletar()` (ex.: passar por menus
>    até a consulta, tratar download via botão JavaScript em vez de link
>    direto, ajustar o formato da competência/CPF).

## Como os requisitos foram atendidos

| # | Requisito | Onde |
|---|-----------|------|
| 1 | Seleção do período (uma ou várias competências) | `panel.html` (`<input type="month">`), `competencia.js` (`gerarIntervalo`) |
| 2 | Lista de CPFs (um por linha, com/sem máscara) | `panel.js`, `cpf.js` (`parseLista`, validação, dedup) |
| 3 | Download dos XMLs por CPF × competência | `orchestrator.js`, `esocial-adapter.js`, `downloader.js` |
| 4 | Estrutura de pastas por colaborador | `downloader.js` (`montarCaminho`) |
| 5 | Performance (intervalo mínimo, respeitando o portal) | `orchestrator.js` (`INTERVALO_TAREFAS_MS`) |
| 6 | Persistência da interface | Side panel + execução no *service worker* (independente da UI) |
| 7 | Recuperação e continuidade | `storage.js` + `orchestrator.js` (`recuperar`, fila persistida, anti-duplicação) |
| 8 | Controle de execução (status, contadores, pausar/retomar/cancelar) | `panel.html` / `panel.js` |
| 9 | Mapeamento do eSocial | `esocial-adapter.js` (isolado; pendente das telas) |

## Limitações e notas técnicas

- **Velocidade:** as tarefas são processadas **sequencialmente** para respeitar
  o portal e evitar bloqueios. O intervalo entre tarefas é configurável em
  `src/common/constants.js` (`INTERVALO_TAREFAS_MS`).
- **Recuperação:** o estado vive em `chrome.storage.local`. Se o eSocial cair, a
  conexão for perdida, a página for fechada ou o *service worker* for encerrado,
  ao reabrir/retomar a execução continua do último CPF/competência pendente,
  **sem rebaixar arquivos já concluídos**.
- **Download dos XMLs:** o conteúdo é gravado via `data:` URL (os XMLs de IRRF
  são pequenos). Se algum XML for disponibilizado apenas via botão JavaScript
  (sem link direto), o `esocial-adapter.js` precisará de tratamento específico.
- **Ícones:** gerados programaticamente (placeholder); podem ser substituídos.
