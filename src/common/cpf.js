/*
 * cpf.js
 * ------------------------------------------------------------------
 * Utilitarios de CPF: normalizacao, formatacao, validacao (digitos
 * verificadores) e parsing da lista colada pelo usuario (um por linha,
 * com ou sem mascara, removendo duplicados).
 */
;(function () {
  const NS = (self.IRRF = self.IRRF || {});

  // Remove tudo que nao for digito.
  function normalizar(cpf) {
    return String(cpf || '').replace(/\D+/g, '');
  }

  // Aplica a mascara 000.000.000-00.
  function formatar(cpf) {
    const d = normalizar(cpf).padStart(11, '0').slice(0, 11);
    return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9, 11)}`;
  }

  // Valida os digitos verificadores do CPF.
  function valido(cpf) {
    const d = normalizar(cpf);
    if (d.length !== 11) return false;
    if (/^(\d)\1{10}$/.test(d)) return false; // todos iguais

    let soma = 0;
    for (let i = 0; i < 9; i++) soma += parseInt(d[i], 10) * (10 - i);
    let dv1 = 11 - (soma % 11);
    if (dv1 >= 10) dv1 = 0;
    if (dv1 !== parseInt(d[9], 10)) return false;

    soma = 0;
    for (let i = 0; i < 10; i++) soma += parseInt(d[i], 10) * (11 - i);
    let dv2 = 11 - (soma % 11);
    if (dv2 >= 10) dv2 = 0;
    return dv2 === parseInt(d[10], 10);
  }

  // Recebe o texto bruto do textarea e devolve:
  //   { validos: [11 digitos...], invalidos: ['texto original'...] }
  // Duplicados sao descartados (mantem a primeira ocorrencia).
  function parseLista(texto) {
    const linhas = String(texto || '').split(/\r?\n/);
    const validos = [];
    const invalidos = [];
    const vistos = new Set();

    for (const linha of linhas) {
      const bruto = linha.trim();
      if (!bruto) continue;
      const d = normalizar(bruto);
      if (!d) continue;
      if (vistos.has(d)) continue;
      vistos.add(d);
      if (valido(d)) validos.push(d);
      else invalidos.push(bruto);
    }
    return { validos, invalidos };
  }

  NS.cpf = { normalizar, formatar, valido, parseLista };
})();
