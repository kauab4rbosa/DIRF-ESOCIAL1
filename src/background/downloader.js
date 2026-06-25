/*
 * downloader.js  (service worker)
 * ------------------------------------------------------------------
 * Responsavel por gravar os XMLs no disco com a estrutura de pastas:
 *
 *   <PastaRaiz>/<Colaborador>/<YYYY-MM>.xml
 *
 * Usamos data: URLs em vez de Blob/URL.createObjectURL porque o ultimo
 * nao esta disponivel no service worker do MV3. Os XMLs de IRRF sao
 * pequenos (poucos KB), portanto data: URL e adequado.
 */
;(function () {
  const NS = (self.IRRF = self.IRRF || {});

  // Caracteres de controle (0x00-0x1F) — construido sem escapes literais
  // no codigo-fonte para manter o arquivo 100% ASCII.
  const CONTROLE = new RegExp('[' + String.fromCharCode(0) + '-' + String.fromCharCode(31) + ']+', 'g');

  // Remove caracteres invalidos para nomes de pasta/arquivo, preservando
  // hifens legitimos (ex.: nomes compostos / competencia AAAA-MM).
  function sanitizar(nome) {
    const limpo = String(nome || '')
      .replace(/[\\/:*?"<>|]+/g, ' ') // proibidos em sistemas de arquivos
      .replace(CONTROLE, ' ') // caracteres de controle
      .replace(/\s+/g, ' ') // colapsa espacos em branco
      .trim()
      .slice(0, 120);
    return limpo || 'sem_nome';
  }

  // Converte o conteudo XML (texto) em data: URL.
  function xmlParaDataUrl(conteudo) {
    return 'data:application/xml;charset=utf-8,' + encodeURIComponent(conteudo);
  }

  // Monta o caminho relativo final do arquivo.
  function montarCaminho({ pastaRaiz, colaborador, competencia, sufixo }) {
    const raiz = sanitizar(pastaRaiz || NS.CONFIG.PASTA_RAIZ);
    const pasta = sanitizar(colaborador);
    const base = String(competencia) + (sufixo ? `-${sanitizar(sufixo)}` : '');
    return `${raiz}/${pasta}/${base}.xml`;
  }

  // Dispara o download. Resolve com o downloadId.
  function baixar({ conteudo, caminho }) {
    return new Promise((resolve, reject) => {
      chrome.downloads.download(
        {
          url: xmlParaDataUrl(conteudo),
          filename: caminho,
          conflictAction: 'overwrite',
          saveAs: false,
        },
        (id) => {
          const err = chrome.runtime.lastError;
          if (err) reject(new Error(err.message));
          else resolve(id);
        }
      );
    });
  }

  // Grava um arquivo de texto (ex.: sidecar JSON com dados da empresa).
  function baixarTexto({ conteudo, caminho, mime }) {
    const url = `data:${mime || 'text/plain'};charset=utf-8,` + encodeURIComponent(conteudo);
    return new Promise((resolve, reject) => {
      chrome.downloads.download({ url, filename: caminho, conflictAction: 'overwrite', saveAs: false }, (id) => {
        const err = chrome.runtime.lastError;
        if (err) reject(new Error(err.message));
        else resolve(id);
      });
    });
  }

  NS.downloader = { sanitizar, xmlParaDataUrl, montarCaminho, baixar, baixarTexto };
})();
