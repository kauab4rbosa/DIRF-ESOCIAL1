/*
 * panel.js — logica da interface (side panel).
 * ------------------------------------------------------------------
 * A UI e apenas uma "vista" do estado mantido pelo service worker.
 * Toda a execucao roda no background, entao a janela pode ser fechada,
 * o usuario pode trocar de aba/navegar, e ao reabrir o painel o estado
 * atual e exibido novamente (requisitos 6, 7 e 8).
 *
 * A aba do eSocial e detectada automaticamente (sem selecao manual).
 */
(function () {
  const NS = self.IRRF;
  const $ = (id) => document.getElementById(id);

  // Configuracoes fixas (antes editaveis em "Opcoes avancadas").
  const PASTA_RAIZ = 'IRRF eSocial';
  const ORDEM = 'cpf';

  const el = {
    status: $('status'),
    esocial: $('esocial'),
    compInicial: $('compInicial'),
    compFinal: $('compFinal'),
    cpfs: $('cpfs'),
    resumoCpfs: $('resumoCpfs'),
    iniciar: $('iniciar'),
    formulario: $('formulario'),
    execucao: $('execucao'),
    barraProgresso: $('barraProgresso'),
    tTotalCpfs: $('tTotalCpfs'),
    tProgresso: $('tProgresso'),
    tXmls: $('tXmls'),
    tEta: $('tEta'),
    aCompetencia: $('aCompetencia'),
    aCpf: $('aCpf'),
    aColaborador: $('aColaborador'),
    pausar: $('pausar'),
    retomar: $('retomar'),
    cancelar: $('cancelar'),
    reiniciar: $('reiniciar'),
    erros: $('erros'),
  };

  // Aba do eSocial detectada automaticamente.
  let abaEsocial = null;

  // Envia mensagem ao service worker e devolve a resposta.
  function enviar(tipo, extra) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(Object.assign({ tipo }, extra || {}), (resp) => {
        void chrome.runtime.lastError; // ignora "no receiver"
        resolve(resp);
      });
    });
  }

  // ---- deteccao automatica da aba do eSocial ----
  async function detectarEsocial() {
    let abas = [];
    try {
      abas = await chrome.tabs.query({});
    } catch (_) {
      abas = [];
    }
    const esocial = abas.filter((a) => a.url && /esocial\.gov\.br/i.test(a.url));
    // Prefere a aba do portal Web Geral; depois a ativa; depois a primeira.
    const escolhida =
      esocial.find((a) => /\/portal\//i.test(a.url) && a.active) ||
      esocial.find((a) => /\/portal\//i.test(a.url)) ||
      esocial.find((a) => a.active) ||
      esocial[0];

    abaEsocial = escolhida ? { id: escolhida.id, title: escolhida.title || escolhida.url } : null;
    renderEsocial();
  }

  function renderEsocial() {
    if (abaEsocial) {
      el.esocial.className = 'esocial-status ok';
      el.esocial.textContent = '✓ eSocial detectado';
    } else {
      el.esocial.className = 'esocial-status off';
      el.esocial.textContent = '○ eSocial não encontrado — abra o portal e faça login na empresa';
    }
  }

  // ---- formatacao MM/AAAA enquanto digita ----
  function formatarCompetencia(e) {
    let d = e.target.value.replace(/\D/g, '').slice(0, 6); // MMAAAA
    if (d.length >= 3) d = d.slice(0, 2) + '/' + d.slice(2);
    e.target.value = d;
  }

  // ---- resumo dos CPFs ----
  function atualizarResumoCpfs() {
    const { validos, invalidos } = NS.cpf.parseLista(el.cpfs.value);
    let txt = `${validos.length} CPF(s) válido(s)`;
    if (invalidos.length) {
      const amostra = invalidos.slice(0, 3).join(', ');
      txt += ` · ${invalidos.length} inválido(s): ${amostra}${invalidos.length > 3 ? '…' : ''}`;
    }
    el.resumoCpfs.textContent = txt;
    el.resumoCpfs.classList.toggle('alerta', invalidos.length > 0);
  }

  // ---- iniciar ----
  async function iniciar() {
    await detectarEsocial(); // garante o id atual da aba
    const { validos, invalidos } = NS.cpf.parseLista(el.cpfs.value);

    if (!abaEsocial) {
      alert('Abra o eSocial Web Geral (logado na empresa desejada) em uma aba e tente novamente.');
      return;
    }
    if (!NS.competencia.valida(el.compInicial.value) || !NS.competencia.valida(el.compFinal.value)) {
      alert('Informe as competências inicial e final no formato MM/AAAA.');
      return;
    }
    if (!validos.length) {
      alert('Informe ao menos um CPF válido.');
      return;
    }
    if (
      invalidos.length &&
      !confirm(`${invalidos.length} CPF(s) inválido(s) serão ignorados. Continuar?`)
    ) {
      return;
    }

    const payload = {
      abaId: abaEsocial.id,
      compInicial: el.compInicial.value,
      compFinal: el.compFinal.value,
      cpfs: validos,
      pastaRaiz: PASTA_RAIZ,
      ordem: ORDEM,
    };
    const estado = await enviar(NS.MSG.INICIAR, { payload });
    if (estado && estado.erro) alert('Erro ao iniciar: ' + estado.erro);
    else render(estado);
  }

  // ---- formatacao de tempo ----
  function fmtTempo(ms) {
    if (!isFinite(ms) || ms <= 0) return '—';
    const s = Math.round(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const seg = s % 60;
    if (h) return `${h}h${String(m).padStart(2, '0')}m`;
    if (m) return `${m}m${String(seg).padStart(2, '0')}s`;
    return `${seg}s`;
  }

  // ---- render ----
  function render(estado) {
    if (!estado) return;
    const st = estado.status || NS.STATUS.OCIOSO;

    el.status.textContent = st;
    el.status.className = 'badge ' + st;

    const temExecucao = st !== NS.STATUS.OCIOSO && estado.fila && estado.fila.length > 0;
    el.execucao.classList.toggle('oculto', !temExecucao);

    // Habilita/desabilita controles conforme o status.
    el.iniciar.disabled = st === NS.STATUS.EXECUTANDO || st === NS.STATUS.PAUSADO;
    el.pausar.disabled = st !== NS.STATUS.EXECUTANDO;
    el.retomar.disabled = !(st === NS.STATUS.PAUSADO || st === NS.STATUS.ERRO);
    el.cancelar.disabled = !(
      st === NS.STATUS.EXECUTANDO ||
      st === NS.STATUS.PAUSADO ||
      st === NS.STATUS.ERRO
    );
    const finalizado = st === NS.STATUS.CONCLUIDO || st === NS.STATUS.CANCELADO;
    el.reiniciar.classList.toggle('oculto', !finalizado);

    if (!temExecucao) return;

    const stats = estado.stats || {};
    const total = stats.total || 0;
    const feitas = stats.concluidas || 0;

    el.tTotalCpfs.textContent = (estado.config && estado.config.cpfs.length) || 0;
    el.tProgresso.textContent = `${feitas}/${total}`;
    el.tXmls.textContent = stats.xmls || 0;
    el.barraProgresso.style.width = total ? `${Math.round((100 * feitas) / total)}%` : '0%';

    if (st === NS.STATUS.EXECUTANDO && feitas > 0 && stats.iniciadoEm) {
      const decorrido = Date.now() - stats.iniciadoEm;
      el.tEta.textContent = fmtTempo((decorrido / feitas) * (total - feitas));
    } else if (st === NS.STATUS.CONCLUIDO) {
      el.tEta.textContent = '✓';
    } else {
      el.tEta.textContent = '—';
    }

    const atual = estado.atual || {};
    el.aCompetencia.textContent = atual.competencia
      ? NS.competencia.paraMMYYYY(atual.competencia)
      : '—';
    el.aCpf.textContent = atual.cpf ? NS.cpf.formatar(atual.cpf) : '—';
    el.aColaborador.textContent = atual.colaborador || '—';

    // Falhas (erros definitivos).
    const erros = (estado.fila || []).filter((t) => t.status === NS.TAREFA.ERRO);
    if (erros.length) {
      const itens = erros
        .slice(0, 20)
        .map(
          (t) =>
            `<div class="erro-item">${NS.cpf.formatar(t.cpf)} · ${NS.competencia.paraMMYYYY(
              t.competencia
            )}: ${t.erro || ''}</div>`
        )
        .join('');
      el.erros.innerHTML = `<h3>Falhas (${erros.length})</h3>${itens}`;
    } else {
      el.erros.innerHTML = '';
    }
  }

  // ---- pre-preenche o formulario com a ultima configuracao ----
  function preencherFormulario(estado) {
    if (!estado || !estado.config) return;
    const c = estado.config;
    if (c.compInicial) el.compInicial.value = NS.competencia.paraMMYYYY(c.compInicial);
    if (c.compFinal) el.compFinal.value = NS.competencia.paraMMYYYY(c.compFinal);
    if (c.cpfs && c.cpfs.length) el.cpfs.value = c.cpfs.map(NS.cpf.formatar).join('\n');
    atualizarResumoCpfs();
  }

  // ---- eventos ----
  el.cpfs.addEventListener('input', atualizarResumoCpfs);
  el.compInicial.addEventListener('input', formatarCompetencia);
  el.compFinal.addEventListener('input', formatarCompetencia);
  el.iniciar.addEventListener('click', iniciar);
  el.pausar.addEventListener('click', async () => render(await enviar(NS.MSG.PAUSAR)));
  el.retomar.addEventListener('click', async () => render(await enviar(NS.MSG.RETOMAR)));
  el.cancelar.addEventListener('click', async () => {
    if (confirm('Cancelar a execução atual?')) render(await enviar(NS.MSG.CANCELAR));
  });
  el.reiniciar.addEventListener('click', async () => {
    const novo = await enviar(NS.MSG.REINICIAR);
    render(novo);
  });

  // Recebe atualizacoes de estado em tempo real.
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.tipo === NS.MSG.ESTADO_ATUALIZADO) render(msg.estado);
  });

  // ================= Gerador de Informe de Rendimentos =================
  const elGer = {
    pasta: $('pastaInforme'),
    resumo: $('resumoInforme'),
    gerar: $('gerarInforme'),
  };

  // Extrai o nome do colaborador a partir da pasta-pai do arquivo
  // (estrutura "IRRF eSocial/<NOME>/AAAA-MM.xml").
  function nomeDaPasta(path) {
    const p = String(path || '').split('/').filter(Boolean);
    if (p.length >= 2) {
      const pai = p[p.length - 2];
      if (!/^(irrf esocial|informes esocial|informes|xml|xmls|downloads)$/i.test(pai)) return pai;
    }
    return '';
  }

  function arquivosXml() {
    return Array.from(elGer.pasta.files || []).filter((f) => /\.xml$/i.test(f.name));
  }

  function atualizarResumoInforme() {
    const n = arquivosXml().length;
    elGer.resumo.textContent = n ? `${n} XML(s) selecionado(s).` : 'Nenhum XML na seleção.';
  }

  async function gerarInformes() {
    const arqs = arquivosXml();
    if (!arqs.length) {
      alert('Selecione uma pasta contendo arquivos XML do eSocial.');
      return;
    }
    elGer.gerar.disabled = true;
    elGer.resumo.textContent = 'Lendo arquivos…';

    const registros = [];
    const nomePorCpf = {};
    let ignorados = 0;
    for (const f of arqs) {
      try {
        const txt = await f.text();
        const r = NS.informe.parseXml(txt);
        if (r) {
          registros.push(r);
          const nm = nomeDaPasta(f.webkitRelativePath || f.name);
          if (nm && !nomePorCpf[r.cpf]) nomePorCpf[r.cpf] = nm;
        } else {
          ignorados++;
        }
      } catch (_) {
        ignorados++;
      }
    }

    if (!registros.length) {
      alert('Nenhum evento S-5002 (evtIrrfBenef) válido foi encontrado nos XMLs.');
      elGer.gerar.disabled = false;
      atualizarResumoInforme();
      return;
    }

    const modelos = NS.informe.construirModelos(registros, nomePorCpf);
    await chrome.storage.local.set({
      irrf_informe_modelos: { modelos, fonte: { razao: '', cnpj: '' }, geradoEm: Date.now() },
    });

    elGer.resumo.textContent =
      `${modelos.length} informe(s) a partir de ${registros.length} XML(s)` +
      (ignorados ? ` · ${ignorados} ignorado(s).` : '.');
    elGer.gerar.disabled = false;

    chrome.tabs.create({ url: chrome.runtime.getURL('src/informe/informe.html') });
  }

  if (elGer.pasta) {
    elGer.pasta.addEventListener('change', atualizarResumoInforme);
    elGer.gerar.addEventListener('click', gerarInformes);
  }

  // Re-detecta o eSocial ao focar o painel e periodicamente.
  window.addEventListener('focus', detectarEsocial);
  setInterval(detectarEsocial, 5000);

  // ---- init ----
  (async () => {
    await detectarEsocial();
    atualizarResumoCpfs();
    const estado = await enviar(NS.MSG.OBTER_ESTADO);
    preencherFormulario(estado);
    render(estado);
  })();
})();
