/*
 * esocial-adapter.js  (content script)
 * ==================================================================
 *  CAMADA DE MAPEAMENTO DO eSocial
 *  Tela: "IRRF por trabalhador"
 *  (Folha de Pagamento > Totalizadores > Trabalhador > IRRF por trabalhador)
 *  Rota: /portal/Totalizador/TotalizadorImpostoRenda?id=<GUID>
 * ==================================================================
 *
 *  Estrategia: em vez de preencher campos e clicar (a tela e ASP.NET com
 *  POST de pagina inteira, o que recarregaria a aba a cada consulta), nos
 *  REPLICAMOS o POST do formulario via fetch, na mesma sessao/cookies do
 *  usuario (o content script roda no contexto da pagina, first-party).
 *
 *  Vantagens:
 *   - a aba do eSocial NUNCA navega (interface permanece ativa);
 *   - muito mais rapido (sem renderizar pagina a cada CPF/competencia);
 *   - o content script permanece vivo durante todo o lote.
 *
 *  Fluxo por (CPF x competencia):
 *   1) descobrir o endpoint do formulario (action com o id de sessao);
 *   2) POST { PeriodoApuracaoPesquisa = MMAAAA, CpfPesquisa = 11 digitos };
 *   3) ler o nome (#Nome) e o(s) link(s) "Baixar XML" (DownloadEvento);
 *   4) baixar o XML (GET) e devolver o conteudo ao service worker.
 *
 *  Observacoes confirmadas pela inspecao do DOM:
 *   - Periodo de Apuracao aceito no formato MMAAAA (ex.: 012025).
 *   - CPF enviado sem mascara (ex.: 14336875936).
 *   - Link do XML: /portal/Totalizador/TotalizadorImpostoRenda/DownloadEvento
 *                  ?idEvento=<id>&recibo=
 */
;(function () {
  const NS = (self.IRRF = self.IRRF || {});

  // Seletores/rotas reais da tela de IRRF por trabalhador.
  const SEL = {
    MENU_IRRF: '#menuImpostoRendaTrabalhador', // link no menu (em qualquer pagina do portal)
    FORM_IRRF: 'form[action*="TotalizadorImpostoRenda"]', // formulario de consulta
    CAMPO_PERIODO: '#PeriodoApuracaoPesquisa', // name=PeriodoApuracaoPesquisa (MMAAAA)
    CAMPO_CPF: '#CpfPesquisa', // name=CpfPesquisa (11 digitos)
    NOME: '#Nome', // nome do trabalhador no resultado
    LINK_XML: 'a[href*="DownloadEvento"]', // botao "Baixar XML"
    MENSAGEM: '#mensagemGeral',
  };

  // Endpoint do POST (action do form, ja com o id de sessao correto).
  // Fica em cache pois a aba nao navega durante o lote.
  let endpoint = null;

  // ---------------------------------------------------------------
  //  Helpers
  // ---------------------------------------------------------------
  async function fetchTexto(url, opts) {
    const resp = await fetch(url, Object.assign({ credentials: 'include' }, opts || {}));
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    return resp.text();
  }

  function parseHtml(html) {
    return new DOMParser().parseFromString(html, 'text/html');
  }

  function pareceLogin(doc) {
    // Sem o formulario de consulta nem o nome => provavelmente login/sessao expirada.
    return !doc.querySelector(SEL.CAMPO_PERIODO) && !doc.querySelector(SEL.NOME);
  }

  // Descobre a URL do formulario (com o id de sessao).
  async function descobrirEndpoint() {
    // 1) Se ja estamos na tela de IRRF, o form esta na pagina.
    const fAtual = document.querySelector(SEL.FORM_IRRF);
    if (fAtual) return new URL(fAtual.getAttribute('action'), location.origin).href;

    // 2) Senao, segue o link do menu (presente em qualquer pagina do portal)
    //    e le o action do form na resposta.
    const link = document.querySelector(SEL.MENU_IRRF);
    if (link && link.getAttribute('href')) {
      const url = new URL(link.getAttribute('href'), location.origin).href;
      const doc = parseHtml(await fetchTexto(url));
      const f2 = doc.querySelector(SEL.FORM_IRRF);
      if (f2) return new URL(f2.getAttribute('action'), location.origin).href;
    }

    throw new Error(
      'Tela "IRRF por trabalhador" nao encontrada. Abra o eSocial Web Geral na empresa desejada.'
    );
  }

  async function obterEndpoint() {
    if (!endpoint) endpoint = await descobrirEndpoint();
    return endpoint;
  }

  // Executa a consulta (POST) e devolve o documento resultante.
  async function pesquisar(cpf, competencia) {
    const url = await obterEndpoint();
    const body = new URLSearchParams();
    body.set('PeriodoApuracaoPesquisa', NS.competencia.paraMMAAAA(competencia));
    body.set('CpfPesquisa', NS.cpf.normalizar(cpf));

    const html = await fetchTexto(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: body.toString(),
    });
    return parseHtml(html);
  }

  // Captura, da pagina do portal, o CNPJ COMPLETO (com o estabelecimento
  // real) e a razao social da empresa selecionada. Best-effort: procura um
  // CNPJ formatado no cabecalho/menu e um nome proximo. Como o gerador so
  // aplica o resultado quando a raiz (8 primeiros digitos) bate com a do
  // S-5002, uma captura incorreta e simplesmente ignorada.
  // TODO: se nao capturar no portal real, ajustar os escopos abaixo com o
  // HTML do cabecalho da empresa.
  function capturarEmpresa() {
    const re = /(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/;
    const escopos = [
      document.querySelector('#header'),
      document.querySelector('.navbar'),
      document.querySelector('#barra-governo-container'),
      document.body,
    ].filter(Boolean);
    for (const sc of escopos) {
      const t = sc.innerText || sc.textContent || '';
      const m = t.match(re);
      if (!m) continue;
      const cnpj = m[1];
      const idx = t.indexOf(cnpj);
      // Texto antes do CNPJ, sem o rotulo "CNPJ" e separadores finais.
      let antes = t
        .slice(Math.max(0, idx - 180), idx)
        .replace(/cnpj\s*:?\s*$/i, '')
        .replace(/[\-–—|:.\s]+$/, '');
      // Ultimo trecho parecido com nome de empresa (rotulo ":" nao entra).
      let razao = '';
      const m2 = antes.match(/([A-Za-z0-9À-ÿ][A-Za-z0-9À-ÿ&.\-/ ]{4,})$/);
      if (m2) {
        const c = m2[1]
          .replace(/\b(empregador|empregado|contribuinte|raz[aã]o\s*social)\b\s*:?/gi, '')
          .replace(/\s+/g, ' ')
          .trim();
        if (c.length >= 5) razao = c;
      }
      return { cnpj, razao };
    }
    return { cnpj: '', razao: '' };
  }

  // ---------------------------------------------------------------
  //  Coleta de uma combinacao CPF x competencia.
  //  Retorna:
  //    { ok:true, colaborador, arquivos:[{conteudo, sufixo}] }
  //    { ok:true, semRegistro:true, colaborador }
  //    { ok:false, erro }
  // ---------------------------------------------------------------
  async function coletar({ cpf, competencia }) {
    try {
      const doc = await pesquisar(cpf, competencia);

      if (pareceLogin(doc)) {
        endpoint = null; // forca redescoberta na proxima tentativa
        return { ok: false, erro: 'Sessao do eSocial expirada ou pagina inesperada.' };
      }

      const nomeEl = doc.querySelector(SEL.NOME);
      const colaborador = nomeEl ? (nomeEl.getAttribute('value') || '').trim() : null;
      const empresa = capturarEmpresa();

      const links = Array.from(doc.querySelectorAll(SEL.LINK_XML));
      if (!links.length) {
        // Trabalhador sem IRRF nesta competencia.
        return { ok: true, semRegistro: true, colaborador, empresa };
      }

      const arquivos = [];
      for (const a of links) {
        const xmlUrl = new URL(a.getAttribute('href'), location.origin).href;
        const conteudo = await fetchTexto(xmlUrl);

        // Guarda contra resposta HTML (ex.: sessao expirou no meio do lote).
        const ini = conteudo.slice(0, 200).toLowerCase();
        if (ini.includes('<!doctype html') || ini.includes('<html')) {
          endpoint = null;
          return { ok: false, erro: 'Conteudo do XML invalido (sessao expirada?).' };
        }

        const idEvento = new URL(xmlUrl).searchParams.get('idEvento') || '';
        arquivos.push({ conteudo, sufixo: idEvento });
      }

      return { ok: true, colaborador: colaborador || NS.cpf.normalizar(cpf), arquivos, empresa };
    } catch (err) {
      return { ok: false, erro: err && err.message ? err.message : String(err) };
    }
  }

  NS.adapter = {
    coletar,
    SEL,
    _internal: { descobrirEndpoint, obterEndpoint, pesquisar, parseHtml, fetchTexto, capturarEmpresa },
  };
})();
