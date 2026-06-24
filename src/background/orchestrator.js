/*
 * orchestrator.js  (service worker)
 * ------------------------------------------------------------------
 * Maquina de estados que coordena toda a execucao:
 *   - monta a fila de tarefas (CPF x competencia);
 *   - percorre a fila conversando com o content script da aba do
 *     eSocial (que faz a navegacao/DOM e devolve os XMLs);
 *   - baixa cada XML na pasta do colaborador;
 *   - persiste o progresso a cada passo (retomada e anti-duplicacao);
 *   - trata pausar / retomar / cancelar;
 *   - se recupera automaticamente apos quedas (recuperar()).
 *
 * O laco (tick) e tolerante a reinicios: o estado e sempre relido do
 * storage, entao se o service worker for encerrado no meio, o proximo
 * disparo (mensagem da UI ou alarme watchdog) continua de onde parou.
 */
;(function () {
  const NS = (self.IRRF = self.IRRF || {});
  const { STATUS, TAREFA, MSG, CONFIG } = NS;

  // Trava de reentrancia: garante um unico laco ativo POR worker vivo.
  let processando = false;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------------------------------------------------------------
  //  Broadcast de estado para a UI (ignora ausencia de ouvintes).
  // ---------------------------------------------------------------
  async function broadcast(estado) {
    try {
      await chrome.runtime.sendMessage({ tipo: MSG.ESTADO_ATUALIZADO, estado });
    } catch (_) {
      /* nenhuma UI aberta — tudo bem */
    }
  }

  async function salvarEBroadcast(estado) {
    await NS.storage.salvar(estado);
    await broadcast(estado);
  }

  // ---------------------------------------------------------------
  //  Construcao da fila de tarefas.
  // ---------------------------------------------------------------
  function construirFila(cpfs, competencias, ordem) {
    const fila = [];
    const add = (cpf, competencia) =>
      fila.push({
        id: `${cpf}|${competencia}`,
        cpf,
        competencia,
        status: TAREFA.PENDENTE,
        colaborador: null,
        xmls: 0,
        tentativas: 0,
        erro: null,
      });

    if (ordem === 'competencia') {
      for (const c of competencias) for (const cpf of cpfs) add(cpf, c);
    } else {
      // padrao: por colaborador (CPF externo), competencia interna
      for (const cpf of cpfs) for (const c of competencias) add(cpf, c);
    }
    return fila;
  }

  // ===============================================================
  //  API publica (acionada pelas mensagens da UI)
  // ===============================================================

  async function iniciar(payload) {
    const competencias = NS.competencia.gerarIntervalo(
      payload.compInicial,
      payload.compFinal
    );
    if (!competencias.length) throw new Error('Intervalo de competencias invalido.');
    if (!payload.cpfs || !payload.cpfs.length) throw new Error('Nenhum CPF informado.');
    if (!payload.abaId) throw new Error('Aba do eSocial nao definida.');

    const ordem = payload.ordem || CONFIG.ORDEM;
    const fila = construirFila(payload.cpfs, competencias, ordem);

    const estado = NS.storage.estadoInicial();
    estado.status = STATUS.EXECUTANDO;
    estado.config = {
      compInicial: NS.competencia.normalizar(payload.compInicial),
      compFinal: NS.competencia.normalizar(payload.compFinal),
      cpfs: payload.cpfs,
      pastaRaiz: payload.pastaRaiz || CONFIG.PASTA_RAIZ,
      ordem,
    };
    estado.abaId = payload.abaId;
    estado.competencias = competencias;
    estado.fila = fila;
    estado.cursor = 0;
    estado.stats = {
      total: fila.length,
      concluidas: 0,
      xmls: 0,
      iniciadoEm: Date.now(),
      atualizadoEm: Date.now(),
    };
    estado.atual = null;
    estado.ultimoErro = null;

    await salvarEBroadcast(estado);
    garantirKeepalive();
    tick(); // dispara o laco sem aguardar
    return estado;
  }

  async function pausar() {
    const estado = await NS.storage.carregar();
    if (estado.status === STATUS.EXECUTANDO) {
      estado.status = STATUS.PAUSADO;
      await salvarEBroadcast(estado);
    }
    return estado;
  }

  async function retomar() {
    const estado = await NS.storage.carregar();
    if (estado.status === STATUS.PAUSADO || estado.status === STATUS.ERRO) {
      estado.status = STATUS.EXECUTANDO;
      // tarefas que ficaram "processando" voltam para a fila
      for (const t of estado.fila) {
        if (t.status === TAREFA.PROCESSANDO) t.status = TAREFA.PENDENTE;
      }
      await salvarEBroadcast(estado);
      garantirKeepalive();
      tick();
    }
    return estado;
  }

  async function cancelar() {
    const estado = await NS.storage.carregar();
    estado.status = STATUS.CANCELADO;
    estado.atual = null;
    await salvarEBroadcast(estado);
    pararKeepalive();
    return estado;
  }

  // Limpa tudo e volta ao formulario.
  async function reiniciar() {
    pararKeepalive();
    const novo = await NS.storage.limpar();
    await broadcast(novo);
    return novo;
  }

  // Recuperacao automatica: chamada no startup do service worker e
  // pelo alarme watchdog. Se havia execucao em andamento, retoma o laco.
  async function recuperar() {
    const estado = await NS.storage.carregar();
    if (estado.status === STATUS.EXECUTANDO) {
      garantirKeepalive();
      tick();
    }
    return estado;
  }

  // ===============================================================
  //  Laco de processamento
  // ===============================================================
  async function tick() {
    if (processando) return; // ja existe um laco ativo neste worker
    processando = true;
    try {
      while (true) {
        let estado = await NS.storage.carregar();
        if (estado.status !== STATUS.EXECUTANDO) break;

        // Proxima tarefa nao finalizada (pula concluidas -> sem duplicar).
        const idx = estado.fila.findIndex(
          (t) => t.status === TAREFA.PENDENTE || t.status === TAREFA.PROCESSANDO
        );
        if (idx === -1) {
          estado.status = STATUS.CONCLUIDO;
          estado.atual = null;
          await salvarEBroadcast(estado);
          pararKeepalive();
          break;
        }

        const tarefa = estado.fila[idx];
        estado.cursor = idx;
        tarefa.status = TAREFA.PROCESSANDO;
        tarefa.tentativas += 1;
        estado.atual = {
          cpf: tarefa.cpf,
          competencia: tarefa.competencia,
          colaborador: tarefa.colaborador,
        };
        await salvarEBroadcast(estado);

        // Executa a tarefa (navegacao + coleta + download).
        let resultado;
        try {
          resultado = await executarTarefa(estado, tarefa);
        } catch (err) {
          resultado = { ok: false, erro: err && err.message ? err.message : String(err) };
        }

        // Relê o estado (pode ter sido pausado/cancelado durante a coleta).
        estado = await NS.storage.carregar();
        const t = estado.fila[idx];
        if (!t) break;

        if (resultado.ok) {
          t.status = TAREFA.CONCLUIDA;
          t.colaborador = resultado.colaborador || t.colaborador;
          t.xmls = resultado.xmls || 0;
          t.erro = null;
          estado.stats.concluidas += 1;
          estado.stats.xmls += resultado.xmls || 0;
        } else if (resultado.semRegistro) {
          t.status = TAREFA.SEM_REGISTRO;
          t.colaborador = resultado.colaborador || t.colaborador;
          estado.stats.concluidas += 1;
        } else if (t.tentativas >= CONFIG.MAX_TENTATIVAS) {
          t.status = TAREFA.ERRO;
          t.erro = resultado.erro || 'erro desconhecido';
          estado.stats.concluidas += 1;
          estado.ultimoErro = `${t.cpf} ${t.competencia}: ${t.erro}`;
        } else {
          // falha temporaria: volta para a fila para nova tentativa
          t.status = TAREFA.PENDENTE;
        }

        // Propaga o nome do colaborador para as demais tarefas do mesmo CPF.
        if (t.colaborador) {
          for (const o of estado.fila) {
            if (o.cpf === t.cpf && !o.colaborador) o.colaborador = t.colaborador;
          }
        }

        // Se o status global ainda for "executando", segue; senao salva e para.
        await salvarEBroadcast(estado);
        if (estado.status !== STATUS.EXECUTANDO) break;

        await sleep(CONFIG.INTERVALO_TAREFAS_MS);
      }
    } finally {
      processando = false;
    }
  }

  // Executa uma tarefa conversando com o content script da aba.
  async function executarTarefa(estado, tarefa) {
    const abaId = estado.abaId;
    if (!abaId) return { ok: false, erro: 'Aba do eSocial nao definida.' };

    await garantirContentScript(abaId);

    const resposta = await enviarParaAba(abaId, {
      tipo: MSG.COLETAR,
      cpf: tarefa.cpf,
      competencia: tarefa.competencia,
    });

    if (!resposta) return { ok: false, erro: 'Sem resposta do content script.' };
    if (resposta.semRegistro) {
      return { ok: false, semRegistro: true, colaborador: resposta.colaborador };
    }
    if (!resposta.ok) return { ok: false, erro: resposta.erro || 'Falha na coleta.' };

    const arquivos = resposta.arquivos || [];
    if (!arquivos.length) {
      return { ok: false, semRegistro: true, colaborador: resposta.colaborador };
    }

    let n = 0;
    for (let i = 0; i < arquivos.length; i++) {
      const arq = arquivos[i];
      const caminho = NS.downloader.montarCaminho({
        pastaRaiz: estado.config.pastaRaiz,
        colaborador: resposta.colaborador || tarefa.cpf,
        competencia: tarefa.competencia,
        sufixo: arquivos.length > 1 ? arq.sufixo || String(i + 1) : arq.sufixo || '',
      });
      await NS.downloader.baixar({ conteudo: arq.conteudo, caminho });
      n++;
    }
    return { ok: true, xmls: n, colaborador: resposta.colaborador || tarefa.cpf };
  }

  // ---------------------------------------------------------------
  //  Comunicacao com a aba do eSocial.
  // ---------------------------------------------------------------
  function enviarParaAba(abaId, msg) {
    return new Promise((resolve) => {
      try {
        chrome.tabs.sendMessage(abaId, msg, (resp) => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, erro: chrome.runtime.lastError.message });
          } else {
            resolve(resp);
          }
        });
      } catch (err) {
        resolve({ ok: false, erro: err.message });
      }
    });
  }

  // Garante que o content script esteja presente na aba (reinjeta se
  // necessario, por ex. apos navegacoes/reloads do eSocial).
  async function garantirContentScript(abaId) {
    const ping = await enviarParaAba(abaId, { tipo: MSG.PING });
    if (ping && ping.ok) return true;
    try {
      await chrome.scripting.executeScript({
        target: { tabId: abaId },
        files: [
          'src/common/namespace.js',
          'src/common/constants.js',
          'src/common/cpf.js',
          'src/common/competencia.js',
          'src/content/esocial-adapter.js',
          'src/content/content-script.js',
        ],
      });
      await sleep(300);
      return true;
    } catch (err) {
      throw new Error('Nao foi possivel injetar na aba do eSocial: ' + err.message);
    }
  }

  // ---------------------------------------------------------------
  //  Keepalive / watchdog do service worker.
  //  O alarme acorda o worker periodicamente; recuperar() recoloca o
  //  laco em andamento caso ele tenha sido encerrado.
  // ---------------------------------------------------------------
  function garantirKeepalive() {
    chrome.alarms.create(CONFIG.ALARM_KEEPALIVE, { periodInMinutes: 0.25 });
  }
  function pararKeepalive() {
    chrome.alarms.clear(CONFIG.ALARM_KEEPALIVE);
  }

  NS.orchestrator = {
    iniciar,
    pausar,
    retomar,
    cancelar,
    reiniciar,
    recuperar,
    tick,
    garantirKeepalive,
    pararKeepalive,
  };
})();
