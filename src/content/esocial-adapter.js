/*
 * esocial-adapter.js  (content script)
 * ==================================================================
 *  CAMADA DE MAPEAMENTO DO eSocial
 * ==================================================================
 *  Este e o UNICO arquivo que depende do layout/DOM do eSocial.
 *  Toda a navegacao e a leitura da pagina ficam concentradas aqui,
 *  de modo que, ao receber as capturas de tela reais do fluxo
 *  (requisito 9 do escopo), basta ajustar:
 *
 *    1) os seletores em SEL;
 *    2) se necessario, a sequencia de passos em `coletar()`.
 *
 *  O restante da extensao (UI, fila, downloads, recuperacao) NAO
 *  precisa ser alterado.
 *
 *  IMPORTANTE: os seletores abaixo sao um ponto de partida generico
 *  (heuristicas por atributo/texto). Eles devem ser confirmados com
 *  as telas reais do eSocial antes do uso em producao.
 */
;(function () {
  const NS = (self.IRRF = self.IRRF || {});

  /* ---------------------------------------------------------------
   *  SELETORES  (AJUSTAR CONFORME AS TELAS DO eSocial)
   * ------------------------------------------------------------- */
  const SEL = {
    // Caminho (pathname) da consulta de IRRF por colaborador.
    URL_CONSULTA: '/irrf',
    // Campo de competencia (mes/ano).
    CAMPO_COMPETENCIA:
      '#competencia, [name="competencia"], input[placeholder*="ompet" i], input[aria-label*="ompet" i]',
    // Campo de CPF do colaborador.
    CAMPO_CPF: '#cpf, [name="cpf"], input[placeholder*="CPF" i], input[aria-label*="CPF" i]',
    // Botao de consultar/pesquisar.
    BOTAO_CONSULTAR:
      'button#consultar, button[type="submit"], button[aria-label*="onsult" i], button[aria-label*="esquis" i]',
    // Elemento que exibe o nome do colaborador no resultado.
    NOME_COLABORADOR:
      '#nomeColaborador, #nomeTrabalhador, .nome-trabalhador, [data-nome], [data-nome-trabalhador]',
    // Links/botoes que levam ao XML.
    LINKS_XML:
      'a[href$=".xml" i], a[download$=".xml" i], a[href*="xml" i], button[aria-label*="XML" i], a[aria-label*="XML" i]',
    // Indicador de "nenhum registro encontrado".
    SEM_REGISTRO:
      '.sem-registro, .no-data, .nenhum-registro, [data-empty], .empty-state',
  };

  /* ---------------------------------------------------------------
   *  Helpers genericos de DOM.
   * ------------------------------------------------------------- */
  const TIMEOUT = (NS.CONFIG && NS.CONFIG.TIMEOUT_ELEMENTO_MS) || 20000;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const qs = (sel, root = document) => root.querySelector(sel);
  const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // Aguarda um seletor (string) ou uma funcao que retorna elemento/valor.
  async function waitFor(selOrFn, timeout = TIMEOUT) {
    const ini = Date.now();
    while (Date.now() - ini < timeout) {
      const el = typeof selOrFn === 'function' ? selOrFn() : qs(selOrFn);
      if (el) return el;
      await sleep(200);
    }
    return null;
  }

  // Encontra o primeiro elemento cujo texto contem `texto`.
  function porTexto(texto, tags = ['button', 'a', 'span', 'td', 'th', 'label']) {
    const alvo = String(texto).toLowerCase();
    for (const tag of tags) {
      for (const el of qsa(tag)) {
        if ((el.textContent || '').trim().toLowerCase().includes(alvo)) return el;
      }
    }
    return null;
  }

  // Define o valor de um input disparando os eventos que frameworks
  // (Angular/React) escutam.
  function setValor(el, valor) {
    if (!el) return false;
    const proto = Object.getPrototypeOf(el);
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    el.focus();
    if (desc && desc.set) desc.set.call(el, valor);
    else el.value = valor;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function clicar(el) {
    if (!el) return false;
    el.click();
    return true;
  }

  // Baixa um recurso (mesma sessao/cookies) e devolve o texto.
  async function fetchTexto(url) {
    const resp = await fetch(url, { credentials: 'include' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status + ' ao baixar XML');
    return await resp.text();
  }

  function lerNome() {
    const el = qs(SEL.NOME_COLABORADOR);
    const t = el && (el.textContent || el.getAttribute('data-nome'));
    return t ? t.trim().replace(/\s+/g, ' ') : null;
  }

  /* ---------------------------------------------------------------
   *  Fluxo principal de coleta de uma combinacao CPF x competencia.
   *
   *  Retorna:
   *   { ok:true,  colaborador, arquivos:[{conteudo, sufixo?}] }
   *   { ok:true,  semRegistro:true, colaborador }   // nada para baixar
   *   { ok:false, erro }                            // falha (sera re-tentada)
   * ------------------------------------------------------------- */
  async function coletar({ cpf, competencia }) {
    try {
      // 1) Garantir que estamos na tela de consulta de IRRF.
      //    Heuristica: a presenca do campo de competencia indica a tela.
      //    (Se o eSocial exigir navegacao por menus ate a consulta,
      //     implemente-a aqui usando porTexto()/clicar().)
      let campoComp = qs(SEL.CAMPO_COMPETENCIA) || (await waitFor(SEL.CAMPO_COMPETENCIA, 4000));
      if (!campoComp) {
        return {
          ok: false,
          erro:
            'Tela de consulta de IRRF nao encontrada. Ajuste SEL.URL_CONSULTA/seletores no esocial-adapter.js.',
        };
      }

      // 2) Preencher a competencia (formato comum MM/AAAA — ajustar se preciso).
      setValor(campoComp, NS.competencia.paraMMYYYY(competencia));

      // 3) Preencher o CPF (com mascara — ajustar se o campo exigir sem).
      const campoCpf = qs(SEL.CAMPO_CPF);
      if (campoCpf) setValor(campoCpf, NS.cpf.formatar(cpf));

      // 4) Consultar.
      const botao = qs(SEL.BOTAO_CONSULTAR) || porTexto('consultar') || porTexto('pesquisar');
      clicar(botao);

      // 5) Aguardar o resultado: links de XML, nome do colaborador, ou
      //    indicador de "sem registro".
      await waitFor(
        () => qs(SEL.LINKS_XML) || qs(SEL.SEM_REGISTRO) || qs(SEL.NOME_COLABORADOR),
        TIMEOUT
      );

      const colaborador = lerNome();

      if (qs(SEL.SEM_REGISTRO) && !qs(SEL.LINKS_XML)) {
        return { ok: true, semRegistro: true, colaborador };
      }

      // 6) Coletar os XMLs disponiveis.
      const links = qsa(SEL.LINKS_XML);
      if (!links.length) {
        return { ok: true, semRegistro: true, colaborador };
      }

      const arquivos = [];
      let semHref = 0;
      for (const lk of links) {
        const href = lk.getAttribute('href') || (lk.dataset && lk.dataset.href);
        if (href && /xml/i.test(href)) {
          const url = new URL(href, location.href).toString();
          const conteudo = await fetchTexto(url);
          arquivos.push({ conteudo });
        } else {
          // Botao que dispara o download via JavaScript (sem href direto).
          // Exigira tratamento especifico apos o mapeamento das telas.
          semHref++;
        }
      }

      if (!arquivos.length) {
        return {
          ok: false,
          erro:
            semHref > 0
              ? 'XML disponivel via botao JS (sem href). Ajustar a coleta no esocial-adapter.js.'
              : 'Nenhum XML fetchavel encontrado.',
        };
      }
      return { ok: true, colaborador, arquivos };
    } catch (err) {
      return { ok: false, erro: err && err.message ? err.message : String(err) };
    }
  }

  NS.adapter = {
    coletar,
    SEL,
    _helpers: { qs, qsa, waitFor, porTexto, setValor, clicar, fetchTexto, lerNome },
  };
})();
