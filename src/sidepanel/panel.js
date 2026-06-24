/*
 * panel.js — logica da interface (side panel).
 * ------------------------------------------------------------------
 * A UI e apenas uma "vista" do estado mantido pelo service worker.
 * Toda a execucao roda no background, entao a janela pode ser fechada,
 * o usuario pode trocar de aba/navegar, e ao reabrir o painel o estado
 * atual e exibido novamente (requisitos 6, 7 e 8).
 */
(function () {
  const NS = self.IRRF;
  const $ = (id) => document.getElementById(id);

  const el = {
    status: $('status'),
    aba: $('aba'),
    recarregarAbas: $('recarregarAbas'),
    compInicial: $('compInicial'),
    compFinal: $('compFinal'),
    cpfs: $('cpfs'),
    resumoCpfs: $('resumoCpfs'),
    pastaRaiz: $('pastaRaiz'),
    ordem: $('ordem'),
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

  // Envia mensagem ao service worker e devolve a resposta.
  function enviar(tipo, extra) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(Object.assign({ tipo }, extra || {}), (resp) => {
        void chrome.runtime.lastError; // ignora "no receiver"
        resolve(resp);
      });
    });
  }

  // ---- abas do eSocial ----
  async function carregarAbas() {
    const selecionadaAntes = el.aba.value;
    const abas = await chrome.tabs.query({});
    const esocial = abas.filter((a) => a.url && /esocial\.gov\.br/i.test(a.url));
    el.aba.innerHTML = '';

    if (!esocial.length) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'Nenhuma aba do eSocial encontrada';
      el.aba.appendChild(opt);
      return;
    }
    for (const a of esocial) {
      const opt = document.createElement('option');
      opt.value = String(a.id);
      opt.textContent = (a.title || a.url).slice(0, 70);
      if (String(a.id) === selecionadaAntes || (!selecionadaAntes && a.active)) {
        opt.selected = true;
      }
      el.aba.appendChild(opt);
    }
  }

  // ---- resumo dos CPFs ----
  function atualizarResumoCpfs() {
    const { validos, invalidos } = NS.cpf.parseLista(el.cpfs.value);
    let txt = `${validos.length} CPF(s) valido(s)`;
    if (invalidos.length) {
      const amostra = invalidos.slice(0, 3).join(', ');
      txt += ` · ${invalidos.length} invalido(s): ${amostra}${invalidos.length > 3 ? '…' : ''}`;
    }
    el.resumoCpfs.textContent = txt;
    el.resumoCpfs.classList.toggle('alerta', invalidos.length > 0);
  }

  // ---- iniciar ----
  async function iniciar() {
    const { validos, invalidos } = NS.cpf.parseLista(el.cpfs.value);
    if (!el.aba.value) {
      alert('Selecione a aba do eSocial (faca login e entre na empresa desejada).');
      return;
    }
    if (!el.compInicial.value || !el.compFinal.value) {
      alert('Informe as competencias inicial e final.');
      return;
    }
    if (!validos.length) {
      alert('Informe ao menos um CPF valido.');
      return;
    }
    if (
      invalidos.length &&
      !confirm(`${invalidos.length} CPF(s) invalido(s) serao ignorados. Continuar?`)
    ) {
      return;
    }

    const payload = {
      abaId: Number(el.aba.value),
      compInicial: el.compInicial.value,
      compFinal: el.compFinal.value,
      cpfs: validos,
      pastaRaiz: el.pastaRaiz.value.trim() || 'IRRF eSocial',
      ordem: el.ordem.value,
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
    const finalizado =
      st === NS.STATUS.CONCLUIDO || st === NS.STATUS.CANCELADO;
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
    el.aCompetencia.textContent = atual.competencia || '—';
    el.aCpf.textContent = atual.cpf ? NS.cpf.formatar(atual.cpf) : '—';
    el.aColaborador.textContent = atual.colaborador || '—';

    // Falhas (erros definitivos).
    const erros = (estado.fila || []).filter((t) => t.status === NS.TAREFA.ERRO);
    if (erros.length) {
      const itens = erros
        .slice(0, 20)
        .map(
          (t) =>
            `<div class="erro-item">${NS.cpf.formatar(t.cpf)} · ${t.competencia}: ${
              t.erro || ''
            }</div>`
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
    if (c.compInicial) el.compInicial.value = c.compInicial;
    if (c.compFinal) el.compFinal.value = c.compFinal;
    if (c.cpfs && c.cpfs.length) el.cpfs.value = c.cpfs.map(NS.cpf.formatar).join('\n');
    if (c.pastaRaiz) el.pastaRaiz.value = c.pastaRaiz;
    if (c.ordem) el.ordem.value = c.ordem;
    atualizarResumoCpfs();
  }

  // ---- eventos ----
  el.cpfs.addEventListener('input', atualizarResumoCpfs);
  el.recarregarAbas.addEventListener('click', carregarAbas);
  el.iniciar.addEventListener('click', iniciar);
  el.pausar.addEventListener('click', async () => render(await enviar(NS.MSG.PAUSAR)));
  el.retomar.addEventListener('click', async () => render(await enviar(NS.MSG.RETOMAR)));
  el.cancelar.addEventListener('click', async () => {
    if (confirm('Cancelar a execucao atual?')) render(await enviar(NS.MSG.CANCELAR));
  });
  el.reiniciar.addEventListener('click', async () => {
    const novo = await enviar(NS.MSG.REINICIAR);
    render(novo);
  });

  // Recebe atualizacoes de estado em tempo real.
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.tipo === NS.MSG.ESTADO_ATUALIZADO) render(msg.estado);
  });

  // ---- init ----
  (async () => {
    await carregarAbas();
    atualizarResumoCpfs();
    const estado = await enviar(NS.MSG.OBTER_ESTADO);
    preencherFormulario(estado);
    render(estado);
  })();
})();
