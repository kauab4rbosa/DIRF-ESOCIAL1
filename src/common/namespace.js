/*
 * namespace.js
 * ------------------------------------------------------------------
 * Cria o namespace global compartilhado por TODOS os contextos da
 * extensao (service worker, content scripts e UI do side panel).
 *
 * Optamos por scripts classicos (sem ES modules) para que:
 *   - o service worker possa carregar tudo via importScripts();
 *   - os content scripts (que sao sempre classicos quando declarados
 *     no manifest) compartilhem o mesmo objeto global no "mundo
 *     isolado";
 *   - as paginas de UI carreguem os mesmos arquivos via <script>.
 *
 * Assim evitamos a necessidade de um bundler / etapa de build.
 */
;(function (root) {
  root.IRRF = root.IRRF || {};
})(typeof self !== 'undefined' ? self : this);
