/*
 * competencia.js
 * ------------------------------------------------------------------
 * Utilitarios de competencia (mes/ano). Internamente trabalhamos com
 * o formato 'YYYY-MM' (mesmo do <input type="month">). Aceitamos na
 * entrada tambem 'MM/YYYY' e 'YYYYMM'.
 */
;(function () {
  const NS = (self.IRRF = self.IRRF || {});

  // Normaliza qualquer entrada conhecida para 'YYYY-MM' ou null.
  function normalizar(valor) {
    const s = String(valor || '').trim();
    let m;
    if ((m = s.match(/^(\d{4})-(\d{2})$/))) return `${m[1]}-${m[2]}`;
    if ((m = s.match(/^(\d{2})\/(\d{4})$/))) return `${m[2]}-${m[1]}`;
    if ((m = s.match(/^(\d{4})(\d{2})$/))) return `${m[1]}-${m[2]}`;
    return null;
  }

  function valida(valor) {
    const n = normalizar(valor);
    if (!n) return false;
    const mes = parseInt(n.slice(5, 7), 10);
    return mes >= 1 && mes <= 12;
  }

  // 'YYYY-MM' -> numero absoluto de meses (para iterar intervalos).
  function paraIndice(comp) {
    const [ano, mes] = comp.split('-').map(Number);
    return ano * 12 + (mes - 1);
  }

  function deIndice(idx) {
    const ano = Math.floor(idx / 12);
    const mes = (idx % 12) + 1;
    return `${String(ano).padStart(4, '0')}-${String(mes).padStart(2, '0')}`;
  }

  // Gera todas as competencias entre inicial e final (inclusive).
  // Se a ordem vier invertida, corrige automaticamente.
  function gerarIntervalo(inicial, final) {
    const ini = normalizar(inicial);
    const fim = normalizar(final);
    if (!ini || !fim) return [];
    let a = paraIndice(ini);
    let b = paraIndice(fim);
    if (a > b) [a, b] = [b, a];
    const out = [];
    for (let i = a; i <= b; i++) out.push(deIndice(i));
    return out;
  }

  // 'YYYY-MM' -> 'MM/YYYY' (formato exibido no eSocial).
  function paraMMYYYY(comp) {
    const n = normalizar(comp);
    if (!n) return comp;
    return `${n.slice(5, 7)}/${n.slice(0, 4)}`;
  }

  // 'YYYY-MM' -> 'MMYYYY' (formato aceito pelo campo PeriodoApuracaoPesquisa
  // da tela "IRRF por trabalhador", ex.: 012025).
  function paraMMAAAA(comp) {
    const n = normalizar(comp);
    if (!n) return comp;
    return `${n.slice(5, 7)}${n.slice(0, 4)}`;
  }

  NS.competencia = {
    normalizar,
    valida,
    gerarIntervalo,
    paraMMYYYY,
    paraMMAAAA,
    paraIndice,
    deIndice,
  };
})();
