/*
 * service-worker.js  (ponto de entrada do background)
 * ------------------------------------------------------------------
 * Service worker CLASSICO (sem "type":"module") para podermos usar
 * importScripts() e compartilhar o mesmo namespace global dos demais
 * contextos. Os caminhos com "/" inicial sao resolvidos a partir da
 * raiz da extensao.
 */
importScripts(
  '/src/common/namespace.js',
  '/src/common/constants.js',
  '/src/common/cpf.js',
  '/src/common/competencia.js',
  '/src/common/storage.js',
  '/src/background/downloader.js',
  '/src/background/orchestrator.js',
  '/src/background/keepalive.js'
);

const NS = self.IRRF;

// Abre o side panel ao clicar no icone da extensao.
function configurarSidePanel() {
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch(() => {});
  }
}
chrome.runtime.onInstalled.addListener(() => {
  configurarSidePanel();
  NS.keepalive.garantirAlarme();
});
chrome.runtime.onStartup.addListener(() => {
  NS.orchestrator.recuperar();
  NS.keepalive.garantirAlarme();
});
configurarSidePanel();

// Recuperacao + keepalive de sessao ao (re)iniciar o service worker.
NS.orchestrator.recuperar();
NS.keepalive.garantirAlarme();

// Mensagens vindas da UI.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || !msg.tipo) return;

  // Broadcast de estado nao precisa de tratamento aqui.
  if (msg.tipo === NS.MSG.ESTADO_ATUALIZADO) return;

  (async () => {
    try {
      switch (msg.tipo) {
        case NS.MSG.INICIAR:
          sendResponse(await NS.orchestrator.iniciar(msg.payload));
          break;
        case NS.MSG.PAUSAR:
          sendResponse(await NS.orchestrator.pausar());
          break;
        case NS.MSG.RETOMAR:
          sendResponse(await NS.orchestrator.retomar());
          break;
        case NS.MSG.CANCELAR:
          sendResponse(await NS.orchestrator.cancelar());
          break;
        case NS.MSG.REINICIAR:
          sendResponse(await NS.orchestrator.reiniciar());
          break;
        case NS.MSG.OBTER_ESTADO:
          sendResponse(await NS.storage.carregar());
          break;
        default:
          sendResponse({ ok: false, erro: 'mensagem desconhecida' });
      }
    } catch (err) {
      sendResponse({ ok: false, erro: err && err.message ? err.message : String(err) });
    }
  })();

  return true; // resposta assincrona
});

// Watchdog/keepalive: mantem o laco vivo durante a execucao.
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === NS.CONFIG.ALARM_KEEPALIVE) {
    NS.orchestrator.recuperar();
  } else if (alarm.name === NS.CONFIG.ALARM_SESSAO) {
    NS.keepalive.manterSessao();
  }
});
