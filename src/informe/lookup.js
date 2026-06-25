/*
 * lookup.js — resolve a razao social a partir do CNPJ (BrasilAPI).
 * Usado para preencher automaticamente a fonte pagadora e a(s)
 * operadora(s) de plano de saude. Resultado em cache (memoria +
 * chrome.storage). Falha de forma silenciosa (campos ficam editaveis).
 *
 * Requer host permission para https://brasilapi.com.br/*.
 */
;(function () {
  const NS = (self.IRRF = self.IRRF || {});
  const KEY = 'irrf_cnpj_cache';
  const mem = {};
  let carregado = false;

  async function carregarCache() {
    if (carregado) return;
    carregado = true;
    try {
      const o = await chrome.storage.local.get(KEY);
      Object.assign(mem, o[KEY] || {});
    } catch (_) {}
  }

  async function salvarCache() {
    try {
      await chrome.storage.local.set({ [KEY]: mem });
    } catch (_) {}
  }

  function normaliza(cnpj) {
    return String(cnpj || '').replace(/\D/g, '');
  }

  // Retorna a razao social (string) ou null.
  async function razaoSocial(cnpj) {
    const d = normaliza(cnpj);
    if (d.length !== 14) return null;
    await carregarCache();
    if (Object.prototype.hasOwnProperty.call(mem, d)) return mem[d] || null;

    let razao = null;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 7000);
      const resp = await fetch('https://brasilapi.com.br/api/cnpj/v1/' + d, {
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (resp.ok) {
        const j = await resp.json();
        razao = (j && (j.razao_social || j.nome_fantasia)) || null;
        if (razao) razao = String(razao).trim();
      }
    } catch (_) {
      razao = null;
    }

    // Cacheia inclusive resultado nulo (evita repetir falha na mesma sessao,
    // mas só persiste quando há valor).
    mem[d] = razao || '';
    if (razao) salvarCache();
    return razao;
  }

  NS.informeLookup = { razaoSocial };
})();
