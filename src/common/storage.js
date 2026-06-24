/*
 * storage.js
 * ------------------------------------------------------------------
 * Camada de persistencia do estado em chrome.storage.local.
 *
 * Todo o progresso vive aqui. Como o service worker do MV3 pode ser
 * encerrado a qualquer momento, o estado e SEMPRE lido/gravado no
 * storage. Isso da suporte a:
 *   - retomada apos queda do eSocial, perda de conexao, fechamento da
 *     pagina ou encerramento do service worker;
 *   - continuidade exatamente do ultimo CPF/competencia processados;
 *   - ausencia de downloads duplicados (tarefas concluidas sao puladas).
 *
 * Formato do estado:
 * {
 *   status: STATUS,
 *   config: { compInicial, compFinal, cpfs:[...], pastaRaiz, ordem },
 *   abaId: <id da aba do eSocial>,
 *   competencias: ['YYYY-MM', ...],
 *   fila: [ { id, cpf, competencia, status, colaborador, xmls,
 *             tentativas, erro } ],
 *   cursor: <indice da tarefa atual>,
 *   stats: { total, concluidas, xmls, iniciadoEm, atualizadoEm },
 *   atual: { cpf, competencia, colaborador } | null,
 *   ultimoErro: string | null
 * }
 */
;(function () {
  const NS = (self.IRRF = self.IRRF || {});
  const KEY = NS.STORAGE_KEY;

  function estadoInicial() {
    return {
      status: NS.STATUS.OCIOSO,
      config: null,
      abaId: null,
      competencias: [],
      fila: [],
      cursor: 0,
      stats: { total: 0, concluidas: 0, xmls: 0, iniciadoEm: null, atualizadoEm: null },
      atual: null,
      ultimoErro: null,
    };
  }

  async function carregar() {
    const obj = await chrome.storage.local.get(KEY);
    return obj[KEY] || estadoInicial();
  }

  async function salvar(estado) {
    estado.stats = estado.stats || {};
    estado.stats.atualizadoEm = Date.now();
    await chrome.storage.local.set({ [KEY]: estado });
    return estado;
  }

  async function limpar() {
    const novo = estadoInicial();
    await chrome.storage.local.set({ [KEY]: novo });
    return novo;
  }

  NS.storage = { KEY, estadoInicial, carregar, salvar, limpar };
})();
