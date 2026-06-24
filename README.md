# IRRF eSocial — Extensão para Google Chrome

Extensão (Manifest V3) que **automatiza a extração e o download dos arquivos
XML de IRRF por colaborador** diretamente no ambiente do eSocial (Web Geral).

O usuário faz login no eSocial e seleciona a empresa desejada; a extensão
percorre, para cada CPF informado e cada competência do período, a consulta de
**IRRF por trabalhador**, baixa os XMLs disponíveis e os organiza em pastas
individuais por colaborador.

---

## Sumário

- [Instalação](#instalação)
- [Como usar](#como-usar)
- [Estrutura de pastas dos downloads](#estrutura-de-pastas-dos-downloads)
- [Arquitetura](#arquitetura)
- [Mapeamento do eSocial](#mapeamento-do-esocial)
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

1. Faça **login no eSocial Web Geral** (`https://www.esocial.gov.br/portal/`) e
   entre na **empresa** desejada, deixando a aba aberta. Não é preciso abrir
   manualmente a tela de IRRF — a extensão a localiza pelo menu.
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
├── KAUA KALBUSCH BARBOSA/
│   ├── 2024-01.xml
│   ├── 2024-02.xml
│   └── ...
├── Ciclano de Souza/
│   ├── 2024-01.xml
│   └── ...
```

A pasta de cada colaborador usa o **nome identificado no eSocial** (campo
`#Nome` da consulta). Caso o nome não seja localizado, usa-se o **CPF** como
identificador. Se houver mais de um XML para a mesma competência, é adicionado
um sufixo com o `idEvento` (`2024-01-<idEvento>.xml`).

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
│   ├── esocial-adapter.js     *** mapeamento do eSocial (IRRF por trabalhador) ***
│   └── content-script.js      recebe ordens e devolve os XMLs
└── sidepanel/                 interface (UI)
    ├── panel.html
    ├── panel.css
    └── panel.js
```

**Fluxo:** a UI envia a configuração ao *service worker*, que monta uma fila de
tarefas (CPF × competência) e a percorre. Para cada tarefa, ele aciona o
*content script* da aba do eSocial, que **replica a consulta via `fetch`** (sem
navegar a aba) e devolve o nome do colaborador e o conteúdo do XML; o *service
worker* então grava cada arquivo na pasta do colaborador. Todo o progresso é
persistido a cada passo, permitindo retomada após quedas.

## Mapeamento do eSocial

Toda a lógica dependente do eSocial está isolada em
`src/content/esocial-adapter.js`, mapeada a partir da **inspeção real do DOM**
da tela **IRRF por trabalhador**
(`Folha de Pagamento → Totalizadores → Trabalhador → IRRF por trabalhador`):

| Elemento | Seletor / rota |
|----------|----------------|
| Link no menu | `#menuImpostoRendaTrabalhador` |
| Formulário de consulta | `form[action*="TotalizadorImpostoRenda"]` |
| Campo Período de Apuração | `#PeriodoApuracaoPesquisa` (formato `MMAAAA`, ex.: `012025`) |
| Campo CPF | `#CpfPesquisa` (11 dígitos, **sem** máscara) |
| Nome do trabalhador (resultado) | `#Nome` |
| Link "Baixar XML" | `a[href*="DownloadEvento"]` → `.../DownloadEvento?idEvento=<id>&recibo=` |

**Como funciona, em vez de clicar nos campos:** a tela é ASP.NET com *postback*
de página inteira (clicar em *Pesquisar* recarregaria a aba). Por isso o adapter
**replica o POST do formulário via `fetch`**, na mesma sessão/cookies do usuário
(o content script é first-party à página do eSocial). Ele então faz o *parse* do
HTML de resposta para obter o nome e o link do XML, e baixa o XML por `GET`. A
aba do eSocial **nunca navega**, o que torna a execução rápida e mantém a
interface estável.

> Se o eSocial alterar o layout/identificadores dessa tela, basta ajustar os
> seletores em `SEL` (e, se preciso, o fluxo em `coletar()`) — nenhum outro
> arquivo precisa mudar.

## Como os requisitos foram atendidos

| # | Requisito | Onde |
|---|-----------|------|
| 1 | Seleção do período (uma ou várias competências) | `panel.html` (`<input type="month">`), `competencia.js` (`gerarIntervalo`) |
| 2 | Lista de CPFs (um por linha, com/sem máscara) | `panel.js`, `cpf.js` (`parseLista`, validação, dedup) |
| 3 | Download dos XMLs por CPF × competência | `orchestrator.js`, `esocial-adapter.js`, `downloader.js` |
| 4 | Estrutura de pastas por colaborador | `downloader.js` (`montarCaminho`) |
| 5 | Performance (consulta via `fetch`, sem recarregar página) | `esocial-adapter.js`, `orchestrator.js` |
| 6 | Persistência da interface | Side panel + execução no *service worker* (independente da UI) |
| 7 | Recuperação e continuidade | `storage.js` + `orchestrator.js` (`recuperar`, fila persistida, anti-duplicação) |
| 8 | Controle de execução (status, contadores, pausar/retomar/cancelar) | `panel.html` / `panel.js` |
| 9 | Mapeamento do eSocial | `esocial-adapter.js` (mapeado para a tela IRRF por trabalhador) |

## Limitações e notas técnicas

- **Período de Apuração:** enviado no formato `MMAAAA` (ex.: `012025`), conforme
  observado na inspeção do campo `#PeriodoApuracaoPesquisa`. Décimo terceiro
  (período só com o ano) não é tratado de forma especial nesta versão.
- **Velocidade:** as tarefas são processadas **sequencialmente** para respeitar
  o portal. Como cada consulta é um `fetch` (sem renderizar página), é bem mais
  rápido do que automatizar cliques. O intervalo entre tarefas é configurável em
  `src/common/constants.js` (`INTERVALO_TAREFAS_MS`).
- **Recuperação:** o estado vive em `chrome.storage.local`. Se o eSocial cair, a
  conexão for perdida, a página for fechada ou o *service worker* for encerrado,
  ao reabrir/retomar a execução continua do último CPF/competência pendente,
  **sem rebaixar arquivos já concluídos**.
- **Sessão expirada:** se a sessão do eSocial expirar durante o lote, a extensão
  detecta a resposta inesperada, marca a tarefa para nova tentativa e, ao
  esgotar, sinaliza o erro no painel — basta refazer o login e **Retomar**.
- **Download dos XMLs:** o conteúdo é obtido por `fetch` e gravado via `data:`
  URL (os XMLs de IRRF são pequenos).
- **Ícones:** gerados programaticamente (placeholder); podem ser substituídos.
