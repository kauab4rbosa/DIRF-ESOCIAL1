/*
 * informe-core.js
 * ------------------------------------------------------------------
 * Parser do evento S-5002 (evtIrrfBenef) e montagem do modelo do
 * "Informe de Rendimentos" (regime de caixa, por ano-calendario).
 *
 * Roda tanto no side panel (para parsear os uploads) quanto na pagina
 * do informe. Usa DOMParser (disponivel nos dois contextos).
 *
 * Decisoes de alocacao (conforme layout do S-5002 e do informe):
 *  - A COLUNA do mes = perApur (mes de pagamento / caixa).
 *  - Totais mensais vem de totInfoIR/consolidApurMen (ja consolidado
 *    por perApur); se ausente, soma-se os totApurMen dos dmDev.
 *  - tpInfoIR = 7900 (verba transitada) NAO e rendimento: e ignorado
 *    (os campos consolidados ja nao o incluem).
 *  - 13o salario vai para a tributacao exclusiva (secao 5):
 *      base13 = vlrRendTrib13 - vlrPrevOficial13 - pensaoAlim(13o)
 *  - Pensao alimenticia (secao 7.3) por beneficiario: junta
 *    penAlim.cpfDep -> ideDep.nome.
 *  - Plano de saude (secao 7.1) subdividido por titular e dependentes,
 *    com o CNPJ da operadora.
 */
;(function () {
  const NS = (self.IRRF = self.IRRF || {});

  // ------------------------------------------------------------------
  //  Helpers de leitura de XML (sem depender de namespaces).
  // ------------------------------------------------------------------
  function* iterar(node) {
    for (const c of node.children) {
      yield c;
      yield* iterar(c);
    }
  }
  function acharTodos(node, nome) {
    const out = [];
    if (!node) return out;
    for (const el of iterar(node)) if (el.localName === nome) out.push(el);
    return out;
  }
  function acharUm(node, nome) {
    if (!node) return null;
    for (const el of iterar(node)) if (el.localName === nome) return el;
    return null;
  }
  function filhosDir(node, nome) {
    if (!node) return [];
    return Array.from(node.children).filter((c) => c.localName === nome);
  }
  function txt(node, nome) {
    const e = acharUm(node, nome);
    return e ? (e.textContent || '').trim() : '';
  }
  function nmero(node, nome) {
    const t = txt(node, nome);
    if (!t) return 0;
    const n = parseFloat(t);
    return isNaN(n) ? 0 : n;
  }

  // ------------------------------------------------------------------
  //  Formatadores.
  // ------------------------------------------------------------------
  function fmtMoeda(n) {
    return (n || 0).toLocaleString('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
  function fmtCpf(cpf) {
    const d = String(cpf || '').replace(/\D/g, '').padStart(11, '0').slice(0, 11);
    return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9, 11)}`;
  }
  function fmtCnpj(nr) {
    const d = String(nr || '').replace(/\D/g, '');
    if (d.length === 14) {
      return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
    }
    if (d.length === 8) {
      // S-5002 traz apenas a raiz (8 digitos). Completar e responsabilidade do usuario.
      return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/____-__`;
    }
    return d;
  }

  // Natureza do rendimento a partir do CR / categoria.
  function naturezaRendimento(crSet) {
    // 0561 - trabalho assalariado (056107/056108/056111...), 0588 sem vinculo,
    // 0561 cobre a maioria; mantemos simples.
    if (crSet.has('353301')) return '0561 - Rendimento trabalho assalariado';
    if (crSet.has('058806')) return '0588 - Rendimento do trabalho sem vinculo';
    if (crSet.has('356201')) return '0561 - Rendimento trabalho assalariado';
    return '0561 - Rendimento trabalho assalariado';
  }

  // ------------------------------------------------------------------
  //  Parse de um arquivo XML -> registro de um mes (perApur) de uma pessoa.
  //  Retorna null se nao for um evtIrrfBenef valido.
  // ------------------------------------------------------------------
  function parseXml(xmlString) {
    let doc;
    try {
      doc = new DOMParser().parseFromString(xmlString, 'text/xml');
    } catch (_) {
      return null;
    }
    const evt = acharUm(doc, 'evtIrrfBenef');
    if (!evt) return null;

    const perApur = txt(acharUm(evt, 'ideEvento'), 'perApur'); // AAAA-MM
    const m = /^(\d{4})-(\d{2})$/.exec(perApur);
    if (!m) return null;
    const ano = parseInt(m[1], 10);
    const mes = parseInt(m[2], 10);

    const ideEmp = acharUm(evt, 'ideEmpregador');
    const empregador = { tpInsc: txt(ideEmp, 'tpInsc'), nrInsc: txt(ideEmp, 'nrInsc') };

    const ideTrab = acharUm(evt, 'ideTrabalhador');
    const cpf = txt(ideTrab, 'cpfBenef');

    // ---- valores: totApurMen, por dmDev (somados aqui). consolidApurMen,
    // quando presente, e a consolidacao desses mesmos valores. ----
    let consolids = acharTodos(ideTrab, 'totApurMen');
    if (!consolids.length) {
      const totInfoIR = acharUm(ideTrab, 'totInfoIR');
      consolids = acharTodos(totInfoIR, 'consolidApurMen');
    }

    const crSet = new Set();
    const v = {
      rendTrib: 0, prevOficial: 0, irrf: 0,
      rendTrib13: 0, prevOficial13: 0, irrf13: 0,
      p65: 0, p65_13: 0, diarias: 0, moleGrave: 0, indeniz: 0, abonoPec: 0, juros: 0, outros: 0,
    };
    for (const c of consolids) {
      const cr = txt(c, 'CRMen');
      if (cr) crSet.add(cr);
      v.rendTrib += nmero(c, 'vlrRendTrib');
      v.prevOficial += nmero(c, 'vlrPrevOficial');
      v.irrf += nmero(c, 'vlrCRMen');
      v.rendTrib13 += nmero(c, 'vlrRendTrib13');
      v.prevOficial13 += nmero(c, 'vlrPrevOficial13');
      v.irrf13 += nmero(c, 'vlrCR13Men');
      v.p65 += nmero(c, 'vlrParcIsenta65');
      v.p65_13 += nmero(c, 'vlrParcIsenta65Dec');
      v.diarias += nmero(c, 'vlrDiarias') + nmero(c, 'vlrAjudaCusto');
      v.moleGrave += nmero(c, 'vlrRendMoleGrave') + nmero(c, 'vlrRendMoleGrave13');
      v.indeniz += nmero(c, 'vlrIndResContrato');
      v.abonoPec += nmero(c, 'vlrAbonoPec');
      v.juros += nmero(c, 'vlrJurosMora');
      v.outros +=
        nmero(c, 'vlrIsenOutros') +
        nmero(c, 'vlrAuxMoradia') +
        nmero(c, 'vlrBolsaMedico') +
        nmero(c, 'vlrBolsaMedico13');
    }

    // ---- informacoes complementares ----
    const complem = acharUm(ideTrab, 'infoIRComplem');

    // dependentes (cpf -> nome)
    const deps = acharTodos(complem, 'ideDep').map((d) => ({
      cpf: txt(d, 'cpfDep'),
      nome: txt(d, 'nome'),
      tpDep: txt(d, 'tpDep'),
      depIRRF: txt(d, 'depIRRF'),
    }));

    // pensao alimenticia: mensal (tpRend != 12) separada do 13o (tpRend = 12),
    // para que o detalhamento (7.3) bata com o totalizador mensal (3.4).
    let pensaoMensal = 0;
    let pensao13 = 0;
    const pensaoPorCpf = {}; // mensal, por beneficiario
    const pensao13PorCpf = {}; // 13o, por beneficiario
    for (const p of acharTodos(complem, 'penAlim')) {
      const tpRend = txt(p, 'tpRend');
      const cpfDep = txt(p, 'cpfDep');
      const val = nmero(p, 'vlrDedPenAlim');
      if (tpRend === '12') {
        pensao13 += val;
        pensao13PorCpf[cpfDep] = (pensao13PorCpf[cpfDep] || 0) + val;
      } else {
        pensaoMensal += val;
        pensaoPorCpf[cpfDep] = (pensaoPorCpf[cpfDep] || 0) + val;
      }
    }

    // previdencia complementar (mensal)
    let prevCompl = 0;
    for (const pc of acharTodos(complem, 'previdCompl')) prevCompl += nmero(pc, 'vlrDedPC');

    // planos de saude
    const planos = acharTodos(complem, 'planSaude').map((ps) => ({
      cnpjOper: txt(ps, 'cnpjOper'),
      regANS: txt(ps, 'regANS'),
      vlrTit: nmero(ps, 'vlrSaudeTit'),
      deps: filhosDir(ps, 'infoDepSau').map((d) => ({
        cpf: txt(d, 'cpfDep'),
        vlr: nmero(d, 'vlrSaudeDep'),
      })),
    }));

    // 13o no informe = rendimento tributavel bruto (sem deduzir impostos).
    // O IRRF do 13o aparece em linha propria (vlrCR13Men).
    const base13 = v.rendTrib13;

    return {
      cpf,
      ano,
      mes,
      perApur,
      empregador,
      natureza: naturezaRendimento(crSet),
      mensal: {
        rendTrib: v.rendTrib,
        prevOficial: v.prevOficial,
        prevCompl,
        pensao: pensaoMensal,
        irrf: v.irrf,
        isen: {
          p65: v.p65,
          p65_13: v.p65_13,
          diarias: v.diarias,
          moleGrave: v.moleGrave,
          indeniz: v.indeniz,
          abonoPec: v.abonoPec,
          juros: v.juros,
          outros: v.outros,
        },
        base13,
        irrf13: v.irrf13,
      },
      deps,
      pensaoPorCpf,
      pensao13PorCpf,
      planos,
    };
  }

  // ------------------------------------------------------------------
  //  Agrupa varios registros (varios meses / pessoas) em modelos
  //  por (cpf, ano). `nomePorCpf` mapeia cpf -> nome (vindo da pasta).
  // ------------------------------------------------------------------
  function mesVazio() {
    return {
      rendTrib: 0, prevOficial: 0, prevCompl: 0, pensao: 0, irrf: 0,
      isen: { p65: 0, p65_13: 0, diarias: 0, moleGrave: 0, indeniz: 0, abonoPec: 0, juros: 0, outros: 0 },
      base13: 0, irrf13: 0,
    };
  }

  function construirModelos(registros, nomePorCpf) {
    nomePorCpf = nomePorCpf || {};
    const mapa = new Map(); // chave `${cpf}|${ano}`

    for (const r of registros) {
      if (!r) continue;
      const chave = `${r.cpf}|${r.ano}`;
      let mdl = mapa.get(chave);
      if (!mdl) {
        mdl = {
          cpf: r.cpf,
          ano: r.ano,
          nome: nomePorCpf[r.cpf] || '',
          empregador: r.empregador,
          natureza: r.natureza,
          meses: {},
          nomesDep: {}, // cpf -> nome
          pensoes: {}, // cpf -> { meses:{}, total }  (mensal)
          pensoes13: {}, // cpf -> { total }  (13o)
          planos: {}, // cnpjOper -> { regANS, titMeses:{}, deps:{cpf:{meses:{}}} }
        };
        for (let i = 1; i <= 12; i++) mdl.meses[i] = mesVazio();
        mapa.set(chave, mdl);
      }

      // mescla nomes de dependentes
      for (const d of r.deps) if (d.cpf && d.nome) mdl.nomesDep[d.cpf] = d.nome;

      const mes = mdl.meses[r.mes];
      const mm = r.mensal;
      mes.rendTrib += mm.rendTrib;
      mes.prevOficial += mm.prevOficial;
      mes.prevCompl += mm.prevCompl;
      mes.pensao += mm.pensao;
      mes.irrf += mm.irrf;
      mes.base13 += mm.base13;
      mes.irrf13 += mm.irrf13;
      for (const k of Object.keys(mes.isen)) mes.isen[k] += mm.isen[k];

      // pensoes mensais (secao 7.3) — sem o 13o, p/ bater com o totalizador
      for (const cpfDep of Object.keys(r.pensaoPorCpf)) {
        if (!mdl.pensoes[cpfDep]) mdl.pensoes[cpfDep] = { meses: {}, total: 0 };
        const pen = mdl.pensoes[cpfDep];
        pen.meses[r.mes] = (pen.meses[r.mes] || 0) + r.pensaoPorCpf[cpfDep];
        pen.total += r.pensaoPorCpf[cpfDep];
      }
      // pensao alimenticia 13o (linha separada)
      for (const cpfDep of Object.keys(r.pensao13PorCpf || {})) {
        if (!mdl.pensoes13[cpfDep]) mdl.pensoes13[cpfDep] = { total: 0 };
        mdl.pensoes13[cpfDep].total += r.pensao13PorCpf[cpfDep];
      }

      // planos (secao 7.1)
      for (const ps of r.planos) {
        if (!mdl.planos[ps.cnpjOper]) {
          mdl.planos[ps.cnpjOper] = { regANS: ps.regANS, titMeses: {}, deps: {} };
        }
        const pl = mdl.planos[ps.cnpjOper];
        if (ps.regANS) pl.regANS = ps.regANS;
        pl.titMeses[r.mes] = (pl.titMeses[r.mes] || 0) + ps.vlrTit;
        for (const d of ps.deps) {
          if (!pl.deps[d.cpf]) pl.deps[d.cpf] = { meses: {} };
          pl.deps[d.cpf].meses[r.mes] = (pl.deps[d.cpf].meses[r.mes] || 0) + d.vlr;
        }
      }
    }

    // resolve nomes das pensoes a partir dos dependentes
    const modelos = Array.from(mapa.values());
    for (const mdl of modelos) {
      for (const cpfDep of Object.keys(mdl.pensoes)) {
        mdl.pensoes[cpfDep].nome = mdl.nomesDep[cpfDep] || '';
      }
      for (const cpfDep of Object.keys(mdl.pensoes13)) {
        mdl.pensoes13[cpfDep].nome = mdl.nomesDep[cpfDep] || '';
      }
      for (const cnpj of Object.keys(mdl.planos)) {
        const pl = mdl.planos[cnpj];
        for (const cpfDep of Object.keys(pl.deps)) {
          pl.deps[cpfDep].nome = mdl.nomesDep[cpfDep] || '';
        }
      }
    }
    modelos.sort((a, b) => (a.nome || a.cpf).localeCompare(b.nome || b.cpf) || a.ano - b.ano);
    return modelos;
  }

  // Calcula os 2 digitos verificadores de um CNPJ a partir dos 12 primeiros.
  function dvCnpj(base12) {
    const calc = (nums) => {
      const pesos =
        nums.length === 12
          ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
          : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
      let s = 0;
      for (let i = 0; i < nums.length; i++) s += nums[i] * pesos[i];
      const r = s % 11;
      return r < 2 ? 0 : 11 - r;
    };
    const arr = base12.split('').map(Number);
    const d1 = calc(arr);
    const d2 = calc(arr.concat(d1));
    return '' + d1 + d2;
  }

  // Deriva o CNPJ completo (14 dig.) da matriz (0001) a partir da raiz de 8 dig.
  // do S-5002. Pode divergir se o estabelecimento nao for a matriz — por isso
  // o campo permanece editavel na pagina.
  function cnpjMatriz(raiz) {
    const r = String(raiz || '').replace(/\D/g, '').padStart(8, '0').slice(0, 8);
    const base = r + '0001';
    return base + dvCnpj(base);
  }

  NS.informe = {
    parseXml,
    construirModelos,
    cnpjMatriz,
    fmt: { moeda: fmtMoeda, cpf: fmtCpf, cnpj: fmtCnpj },
    _util: { acharTodos, acharUm, txt, nmero },
  };
})();
