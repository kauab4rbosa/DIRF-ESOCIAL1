/*
 * keepalive.js  (service worker)
 * ------------------------------------------------------------------
 * Mantem viva a sessao do eSocial. O portal encerra a sessao apos 15
 * minutos sem "salvar, confirmar informacoes ou mudar de pagina".
 *
 * A cada ~10 minutos (CONFIG.SESSAO_MIN), para cada aba do eSocial
 * aberta, injetamos no MUNDO PRINCIPAL da pagina uma rotina que:
 *   1) faz uma requisicao XHR autenticada a uma pagina do portal — o
 *      que renova a sessao no servidor E aciona os hooks de atividade
 *      que o proprio portal usa para reiniciar o contador (cabecalho.js
 *      costuma interceptar XHR da pagina);
 *   2) dispara eventos sinteticos de atividade (mousemove/keydown) como
 *      reforco para rastreadores baseados em atividade do usuario.
 *
 * Rodar no mundo principal (world: 'MAIN') e essencial: o contador de
 * sessao do portal vive no contexto da pagina, fora do alcance do
 * mundo isolado dos content scripts.
 */
;(function () {
  const NS = (self.IRRF = self.IRRF || {});

  // Esta funcao e serializada e executada no contexto da pagina (MAIN).
  // Precisa ser autocontida (sem referencias externas).
  function rotinaPagina() {
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', location.origin + '/portal/', true);
      xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
      xhr.send();
    } catch (e) {}
    try {
      var alvos = [document, window];
      for (var i = 0; i < alvos.length; i++) {
        alvos[i].dispatchEvent(new Event('mousemove', { bubbles: true }));
        alvos[i].dispatchEvent(new Event('keydown', { bubbles: true }));
        alvos[i].dispatchEvent(new Event('click', { bubbles: true }));
      }
    } catch (e) {}
  }

  async function manterSessao() {
    let abas = [];
    try {
      abas = await chrome.tabs.query({ url: ['*://*.esocial.gov.br/*'] });
    } catch (_) {
      return 0;
    }
    let n = 0;
    for (const aba of abas) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: aba.id },
          world: 'MAIN',
          func: rotinaPagina,
        });
        n++;
      } catch (_) {
        /* aba sem permissao / descarregada — ignora */
      }
    }
    return n;
  }

  // Garante o alarme periodico sem reiniciá-lo a cada wake do worker.
  async function garantirAlarme() {
    try {
      const a = await chrome.alarms.get(NS.CONFIG.ALARM_SESSAO);
      if (!a) {
        chrome.alarms.create(NS.CONFIG.ALARM_SESSAO, {
          periodInMinutes: NS.CONFIG.SESSAO_MIN,
          delayInMinutes: NS.CONFIG.SESSAO_MIN,
        });
      }
    } catch (_) {}
  }

  NS.keepalive = { manterSessao, garantirAlarme };
})();
