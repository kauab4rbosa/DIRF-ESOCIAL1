/*
 * content-script.js
 * ------------------------------------------------------------------
 * Roda nas paginas do eSocial. Recebe ordens do service worker e
 * delega ao adapter a navegacao/coleta, devolvendo os XMLs.
 *
 * O guard abaixo evita registrar o listener duas vezes quando o
 * script e injetado tanto pelo manifest quanto por executeScript().
 */
;(function () {
  const NS = (self.IRRF = self.IRRF || {});
  if (NS.__contentPronto) return;
  NS.__contentPronto = true;

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || !msg.tipo) return;

    if (msg.tipo === NS.MSG.PING) {
      sendResponse({ ok: true });
      return; // sincrono
    }

    if (msg.tipo === NS.MSG.COLETAR) {
      NS.adapter
        .coletar({ cpf: msg.cpf, competencia: msg.competencia })
        .then((res) => sendResponse(res))
        .catch((err) =>
          sendResponse({ ok: false, erro: err && err.message ? err.message : String(err) })
        );
      return true; // resposta assincrona
    }
  });
})();
