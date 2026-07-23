/*
 * informe-pdf.js
 * ------------------------------------------------------------------
 * Gera o "Informe de Rendimentos" como um PDF VETORIAL de verdade
 * (texto selecionavel), sem depender de bibliotecas externas nem de
 * rasterizacao (nada de html2canvas / imagem). O mesmo PDF e usado
 * tanto na previa (exibida num <iframe>) quanto no download — logo o
 * que aparece na tela e exatamente o que e baixado.
 *
 * Layout espelha o modelo oficial (IN RFB 2060): titulo, secoes 1 a 8,
 * tabelas mes-a-mes + TOTAL, cores e diagramacao do informe de
 * referencia. Fontes padrao do PDF (Helvetica / Helvetica-Bold), com
 * WinAnsiEncoding, portanto os acentos saem corretos e o arquivo fica
 * pequeno.
 */
;(function () {
  const NS = (self.IRRF = self.IRRF || {});
  const fmt = () => NS.informe.fmt;
  const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

  // ---------------- pagina / metricas (A4 retrato, pt) ----------------
  const W = 595.28;
  const H = 841.89;
  const MX = 30; // margem lateral
  const MTOP = 34; // margem superior
  const MBOT = 40; // margem inferior
  const CONTENT_W = W - 2 * MX;
  const LABEL_W = 148;
  const TOTAL_W = 46;
  const MONTHS_W = CONTENT_W - LABEL_W - TOTAL_W;
  const MONTH_COL = MONTHS_W / 12;
  const X_MONTHS = MX + LABEL_W;
  const X_TOTAL = MX + LABEL_W + MONTHS_W; // borda esquerda da coluna TOTAL

  // fontes
  const S_NUM = 5.9;
  const S_LBL = 6.4;
  const S_HEAD = 6.4;
  const S_SEC = 11;
  const S_VAL = 10;
  const S_TITLE = 19;
  const S_ANO = 12;
  const S_IDENT = 8.4;
  const S_NOTE = 7.6;

  // cores (0..1)
  const TEAL = [0.122, 0.584, 0.788];
  const PRETO = [0.105, 0.105, 0.11];
  const CINZA = [0.6, 0.63, 0.66];
  const BARRA = [0.933, 0.941, 0.945];
  const ZEBRA = [0.969, 0.976, 0.98];
  const LINHA = [0.79, 0.82, 0.85];
  const LINHA_SUAVE = [0.9, 0.92, 0.93];

  // ------------------------------------------------------------------
  //  Larguras Helvetica / Helvetica-Bold (AFM, por 1000) p/ alinhar e
  //  quebrar texto exatamente como o PDF vai renderizar.
  // ------------------------------------------------------------------
  // prettier-ignore
  const ASCII_REG = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
  // prettier-ignore
  const ASCII_BOLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];

  // acentos WinAnsi -> caractere-base ASCII (para pegar a largura)
  const ACENTO = (function () {
    const m = {};
    const g = (from, base) => from.split('').forEach((c) => (m[c.charCodeAt(0)] = base.charCodeAt(0)));
    g('ÀÁÂÃÄÅ', 'A'); g('Ç', 'C'); g('ÈÉÊË', 'E'); g('ÌÍÎÏ', 'I'); g('Ñ', 'N');
    g('ÒÓÔÕÖ', 'O'); g('ÙÚÛÜ', 'U'); g('Ý', 'Y');
    g('àáâãäå', 'a'); g('ç', 'c'); g('èéêë', 'e'); g('ìíîï', 'i'); g('ñ', 'n');
    g('òóôõö', 'o'); g('ùúûü', 'u'); g('ýÿ', 'y');
    m[0xb7] = 'o'.charCodeAt(0); // · (aprox.)
    m[0xba] = 'o'.charCodeAt(0); // º
    m[0xaa] = 'a'.charCodeAt(0); // ª
    return m;
  })();

  function larguraChar(code, bold) {
    if (code >= 32 && code <= 126) return (bold ? ASCII_BOLD : ASCII_REG)[code - 32];
    const base = ACENTO[code];
    if (base) return (bold ? ASCII_BOLD : ASCII_REG)[base - 32];
    return bold ? 556 : 556;
  }
  // normaliza pontuacao tipografica (fora do Latin-1) para ASCII equivalente.
  function normalizar(s) {
    return String(s == null ? '' : s)
      .replace(/[—–]/g, '-')
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/…/g, '...')
      .replace(/ /g, ' ');
  }
  function larguraTexto(str, size, bold) {
    let w = 0;
    const s = normalizar(str);
    for (let i = 0; i < s.length; i++) w += larguraChar(s.charCodeAt(i), bold);
    return (w * size) / 1000;
  }

  // string JS -> literal PDF ( ... ) em WinAnsi (acentos Latin-1 iguais).
  function litPdf(str) {
    const s = normalizar(str);
    let out = '(';
    for (let i = 0; i < s.length; i++) {
      let b = s.charCodeAt(i);
      if (b > 255) b = 0x3f; // fora do Latin-1 -> '?'
      if (b === 0x28) out += '\\(';
      else if (b === 0x29) out += '\\)';
      else if (b === 0x5c) out += '\\\\';
      else if (b < 32 || b > 126) out += '\\' + b.toString(8).padStart(3, '0');
      else out += String.fromCharCode(b);
    }
    return out + ')';
  }

  // ---------------- utilidades numericas / formatacao ----------------
  const n2 = (v) => Math.round((v || 0) * 100) / 100;
  const money = (v) => fmt().moeda(n2(v));
  const num = (v) => (Math.round((v || 0) * 100) / 100).toString();
  const rg = (c) => `${c[0].toFixed(3)} ${c[1].toFixed(3)} ${c[2].toFixed(3)}`;

  function quebrar(str, size, bold, maxW) {
    const palavras = String(str || '').split(/\s+/).filter(Boolean);
    const linhas = [];
    let atual = '';
    for (const p of palavras) {
      const tent = atual ? atual + ' ' + p : p;
      if (larguraTexto(tent, size, bold) > maxW && atual) {
        linhas.push(atual);
        atual = p;
      } else {
        atual = tent;
      }
    }
    if (atual) linhas.push(atual);
    return linhas.length ? linhas : [''];
  }

  // ---------------- documento (paginas de operadores de conteudo) ----------------
  function criarDoc() {
    const doc = { pages: [], cur: null, y: MTOP };
    doc.novaPagina = function () {
      doc.cur = { ops: [] };
      doc.pages.push(doc.cur);
      doc.y = MTOP;
      return doc.cur;
    };
    doc.op = (s) => doc.cur.ops.push(s);
    return doc;
  }

  function retang(doc, x, y, w, h, cor) {
    doc.op(`${rg(cor)} rg`);
    doc.op(`${num(x)} ${num(H - y - h)} ${num(w)} ${num(h)} re f`);
  }
  function linhaH(doc, x, y, w, cor, esp) {
    retang(doc, x, y, w, esp || 0.6, cor);
  }
  function linhaV(doc, x, y, h, cor, esp) {
    retang(doc, x, y, esp || 0.6, h, cor);
  }
  // baseline top-down (y = base da fonte, medido do topo)
  function texto(doc, x, baseline, str, o) {
    o = o || {};
    const size = o.size || S_NUM;
    const bold = !!o.bold;
    const cor = o.rgb || PRETO;
    let tx = x;
    if (o.align === 'right') tx = x - larguraTexto(str, size, bold);
    else if (o.align === 'center') tx = x - larguraTexto(str, size, bold) / 2;
    doc.op(
      `BT /${bold ? 'F2' : 'F1'} ${size} Tf ${rg(cor)} rg ` +
        `${num(tx)} ${num(H - baseline)} Td ${litPdf(str)} Tj ET`
    );
    if (o.strike) {
      const w = larguraTexto(str, size, bold);
      linhaH(doc, tx, baseline - size * 0.28, w, o.rgb || CINZA, 0.5);
    }
  }

  function espaco(doc, altura) {
    if (doc.y + altura > H - MBOT) doc.novaPagina();
  }

  // ---------------- blocos de alto nivel ----------------
  function tituloDoc(doc, ano) {
    texto(doc, MX, doc.y + S_TITLE * 0.8, 'Informe de Rendimentos', { size: S_TITLE, bold: true, rgb: TEAL });
    doc.y += S_TITLE + 6;
    texto(doc, MX, doc.y + S_ANO * 0.8, 'Ano Calendário ', { size: S_ANO, rgb: [0.27, 0.27, 0.27] });
    texto(doc, MX + larguraTexto('Ano Calendário ', S_ANO, false), doc.y + S_ANO * 0.8, String(ano), {
      size: S_ANO, bold: true, rgb: [0.2, 0.2, 0.2],
    });
    doc.y += S_ANO + 12;
  }

  function secao(doc, titulo, comValores) {
    doc.y += 13; // respiro antes do cabecalho da secao
    espaco(doc, 26);
    const y = doc.y;
    texto(doc, MX, y + S_SEC * 0.82, titulo, { size: S_SEC, bold: true, rgb: [0.18, 0.18, 0.19] });
    if (comValores) {
      texto(doc, W - MX, y + S_SEC * 0.82, 'Valores (R$)', { size: S_VAL, bold: true, rgb: TEAL, align: 'right' });
    }
    linhaH(doc, MX, y + S_SEC + 3, CONTENT_W, TEAL, 1.4);
    doc.y = y + S_SEC + 9;
  }

  // "Rótulo: **valor**" (rotulo normal + valor em negrito)
  function rotuloValor(doc, x, baseline, rotulo, valor, opts) {
    opts = opts || {};
    const size = opts.size || S_IDENT;
    if (opts.align === 'right') {
      const wv = larguraTexto(valor, size, true);
      const wr = larguraTexto(rotulo, size, false);
      const x0 = x - wv - wr;
      texto(doc, x0, baseline, rotulo, { size, rgb: [0.25, 0.25, 0.25] });
      texto(doc, x0 + wr, baseline, valor, { size, bold: true, rgb: PRETO });
    } else {
      texto(doc, x, baseline, rotulo, { size, rgb: [0.25, 0.25, 0.25] });
      texto(doc, x + larguraTexto(rotulo, size, false), baseline, valor, { size, bold: true, rgb: PRETO });
    }
  }

  function identLinha(doc, rotEsq, valEsq, rotDir, valDir) {
    const h = 17;
    const y = doc.y;
    const bl = y + 11;
    rotuloValor(doc, MX + 2, bl, rotEsq, valEsq || '—');
    if (rotDir) rotuloValor(doc, W - MX - 2, bl, rotDir, valDir || '—', { align: 'right' });
    doc.y = y + h;
  }

  function barra(doc, rotulo, valor) {
    const h = 16;
    const y = doc.y;
    retang(doc, MX, y, CONTENT_W, h, BARRA);
    rotuloValor(doc, MX + 6, y + 11, rotulo, valor);
    doc.y = y + h + 2;
  }

  // sub-cabecalho cinza (7.1, 7.2, 7.3 e "Operadora:")
  function subBarra(doc, texto1, valor) {
    const h = 15;
    const y = doc.y;
    retang(doc, MX, y, CONTENT_W, h, BARRA);
    if (valor != null) rotuloValor(doc, MX + 6, y + 10.5, texto1, valor, { size: S_IDENT });
    else texto(doc, MX + 6, y + 10.5, texto1, { size: S_IDENT, bold: true, rgb: [0.2, 0.2, 0.2] });
    doc.y = y + h + 2;
  }

  function notaLinha(doc, str) {
    const y = doc.y;
    texto(doc, MX + 2, y + S_NOTE, str, { size: S_NOTE, rgb: [0.28, 0.28, 0.28] });
    doc.y = y + S_NOTE + 5;
  }

  // ---------------- tabelas mes-a-mes ----------------
  function xDirMes(i) {
    return X_MONTHS + (i + 1) * MONTH_COL - 2;
  }
  const X_DIR_TOTAL = W - MX - 3;

  function cabecalhoTabela(doc, capLabel) {
    const y = doc.y;
    const bl = y + 3 + S_HEAD * 0.8;
    if (capLabel) texto(doc, MX + 4, bl, capLabel, { size: S_HEAD, bold: true, rgb: TEAL });
    for (let i = 0; i < 12; i++) {
      texto(doc, xDirMes(i), bl, MESES[i], { size: S_HEAD, bold: true, rgb: TEAL, align: 'right' });
    }
    texto(doc, X_DIR_TOTAL, bl, 'TOTAL', { size: S_HEAD, bold: true, rgb: TEAL, align: 'right' });
    const hCab = 3 + S_HEAD + 4;
    linhaH(doc, MX, y + hCab, CONTENT_W, LINHA, 0.7);
    doc.y = y + hCab + 1;
  }

  // linha de dados: label (com quebra) + 12 meses + total
  function linhaDados(doc, label, valores, idx, opts) {
    opts = opts || {};
    const linhasLbl = quebrar(label, S_LBL, false, LABEL_W - 8);
    const padTop = 3.2;
    const lineH = S_LBL * 1.18;
    const rowH = Math.max(lineH, linhasLbl.length * lineH) + padTop + 3.2;

    if (doc.y + rowH > H - MBOT) {
      doc.novaPagina();
      cabecalhoTabela(doc, opts.cap || '');
    }
    const y = doc.y;

    if (idx % 2 === 1) retang(doc, MX, y, CONTENT_W, rowH, ZEBRA);
    // separador vertical antes da coluna TOTAL
    linhaV(doc, X_TOTAL, y, rowH, LINHA_SUAVE, 0.6);

    const corLbl = opts.strike ? CINZA : PRETO;
    const blPrim = y + padTop + S_LBL * 0.8;
    linhasLbl.forEach((ln, k) => {
      texto(doc, MX + 4, blPrim + k * lineH, ln, { size: S_LBL, rgb: corLbl, strike: opts.strike });
    });

    let tot = 0;
    for (let i = 0; i < 12; i++) {
      const v = valores[i] || 0;
      tot += v;
      texto(doc, xDirMes(i), blPrim, money(v), { size: S_NUM, rgb: corLbl, align: 'right', strike: opts.strike });
    }
    const totMostrar = opts.total != null ? opts.total : tot;
    texto(doc, X_DIR_TOTAL, blPrim, money(totMostrar), {
      size: S_NUM, bold: true, rgb: corLbl, align: 'right', strike: opts.strike,
    });

    linhaH(doc, MX, y + rowH, CONTENT_W, LINHA_SUAVE, 0.4);
    doc.y = y + rowH;
  }

  function valoresDe(model, fn) {
    const a = [];
    for (let i = 1; i <= 12; i++) a.push(fn(model.meses[i]) || 0);
    return a;
  }

  // ------------------------------------------------------------------
  //  Secao 7 (complementares)
  // ------------------------------------------------------------------
  function mesesDeObj(obj) {
    const a = [];
    for (let i = 1; i <= 12; i++) a.push((obj && obj[i]) || 0);
    return a;
  }

  function planosSecao(doc, model) {
    const cnpjs = Object.keys(model.planos || {});
    if (!cnpjs.length) {
      subBarra(doc, 'Operadora do plano de saúde: ', '');
      notaLinha(doc, 'Pagamentos a planos de saúde no ano referência');
      cabecalhoTabela(doc, 'Titular (CPF)');
      linhaDados(doc, fmt().cpf(model.cpf), new Array(12).fill(0), 0);
      cabecalhoTabela(doc, 'Dependente (Nome / CPF)');
      linhaDados(doc, '', new Array(12).fill(0), 0);
      return;
    }
    cnpjs.forEach((cnpj) => {
      const pl = model.planos[cnpj];
      const oper = (pl.razao ? pl.razao + ' · ' : '') + fmt().cnpj(cnpj);
      subBarra(doc, 'Operadora do plano de saúde: ', oper);
      notaLinha(doc, 'Pagamentos a planos de saúde no ano referência');
      cabecalhoTabela(doc, 'Titular (CPF)');
      linhaDados(doc, fmt().cpf(model.cpf), mesesDeObj(pl.titMeses), 0);
      cabecalhoTabela(doc, 'Dependente (Nome / CPF)');
      const deps = Object.keys(pl.deps || {});
      if (deps.length) {
        deps.forEach((d, i) => {
          const dep = pl.deps[d];
          linhaDados(doc, `${dep.nome || ''} · ${fmt().cpf(d)}`, mesesDeObj(dep.meses), i);
        });
      } else {
        linhaDados(doc, '', new Array(12).fill(0), 0);
      }
    });
  }

  function pensoesSecao(doc, model) {
    cabecalhoTabela(doc, 'Dependente (Nome / CPF)');
    const cpfs = Object.keys(model.pensoes || {});
    if (cpfs.length) {
      cpfs.forEach((cpf, i) => {
        const p = model.pensoes[cpf];
        linhaDados(doc, `${p.nome || '(nome não informado)'} · ${fmt().cpf(cpf)}`, mesesDeObj(p.meses), i);
      });
    } else {
      linhaDados(doc, '', new Array(12).fill(0), 0);
    }
    // pensao alimenticia 13o (linha separada)
    const cpfs13 = Object.keys(model.pensoes13 || {}).filter((c) => (model.pensoes13[c].total || 0) > 0);
    if (cpfs13.length) {
      subBarra(doc, 'Pensão alimentícia 13º');
      cpfs13.forEach((cpf) => {
        const p = model.pensoes13[cpf];
        const y = doc.y;
        const bl = y + 3.2 + S_LBL * 0.8;
        const rowH = S_LBL * 1.18 + 6.4;
        linhaV(doc, X_TOTAL, y, rowH, LINHA_SUAVE, 0.6);
        texto(doc, MX + 4, bl, `${p.nome || '(nome não informado)'} · ${fmt().cpf(cpf)}`, { size: S_LBL, rgb: PRETO });
        texto(doc, X_DIR_TOTAL, bl, money(p.total), { size: S_NUM, bold: true, rgb: PRETO, align: 'right' });
        linhaH(doc, MX, y + rowH, CONTENT_W, LINHA_SUAVE, 0.4);
        doc.y = y + rowH;
      });
    }
  }

  function responsavelSecao(doc, model) {
    const hoje = new Date();
    const dd = String(hoje.getDate()).padStart(2, '0');
    const mm = String(hoje.getMonth() + 1).padStart(2, '0');
    const data = `${dd}/${mm}/${hoje.getFullYear()}`;
    doc.y += 2;
    rotuloValor(doc, MX + 2, doc.y + S_IDENT, 'Empresa: ', model.razaoSocial || '—');
    doc.y += S_IDENT + 6;
    rotuloValor(doc, MX + 2, doc.y + S_IDENT, 'CNPJ: ', model.cnpjFonte || fmt().cnpj(model.empregador.nrInsc));
    doc.y += S_IDENT + 6;
    rotuloValor(doc, MX + 2, doc.y + S_IDENT, 'Data: ', data);
    doc.y += S_IDENT + 12;
    notaLinha(doc, 'Aprovado pela IN RFB nº 2060, de 13 de dezembro de 2021.');
    doc.y += 2;
    const aviso =
      'Verifique as condições e o prazo para a apresentação da Declaração do Imposto sobre a Renda da Pessoa ' +
      'Física para este Ano-Calendário no sítio da Secretaria da Receita Federal do Brasil na Internet, no ' +
      'endereço www.receita.fazenda.gov.br';
    quebrar(aviso, S_NOTE, false, CONTENT_W - 4).forEach((ln) => notaLinha(doc, ln));
    doc.y += 4;
    texto(doc, MX + 2, doc.y + S_NOTE, '*Notas:', { size: S_NOTE, bold: true, rgb: [0.28, 0.28, 0.28] });
    doc.y += S_NOTE + 5;
    notaLinha(doc, 'Consulta realizada no período de janeiro a dezembro do referido ano.');
    const nota2 =
      'Informe gerado exclusivamente com base nas informações do evento S-5002 do eSocial; rendimentos não ' +
      'constantes no S-5002, como lucro e dividendos, não estão incluídos.';
    quebrar(nota2, S_NOTE, false, CONTENT_W - 4).forEach((ln) => notaLinha(doc, ln));
  }

  // ------------------------------------------------------------------
  //  Informe completo de 1 colaborador (assume pagina ja aberta).
  // ------------------------------------------------------------------
  function renderInforme(doc, model) {
    tituloDoc(doc, model.ano);

    secao(doc, '1. Identificação da fonte pagadora', false);
    identLinha(
      doc,
      'Razão Social: ', model.razaoSocial || '—',
      'CNPJ: ', model.cnpjFonte || fmt().cnpj(model.empregador.nrInsc)
    );

    secao(doc, '2. Pessoa física beneficiária dos rendimentos', false);
    identLinha(doc, 'Nome: ', model.nome || '—', 'CPF: ', fmt().cpf(model.cpf));
    barra(doc, 'Natureza do rendimento: ', model.natureza);

    // --- Secao 3 ---
    secao(doc, '3. Rendimentos tributáveis, deduções e imposto', true);
    cabecalhoTabela(doc, '');
    linhaDados(doc, '1. Total dos Rendimentos (inclusive férias)', valoresDe(model, (x) => x.rendTrib), 0);
    linhaDados(doc, '2. Contribuição Previdenciária Oficial', valoresDe(model, (x) => x.prevOficial), 1);
    linhaDados(
      doc,
      '3. Contribuições à previdência complementar pública ou privada, e a fundos de aposentadoria programada individual (Fapi) (preencher também o quadro 7)',
      valoresDe(model, (x) => x.prevCompl), 2
    );
    linhaDados(doc, '4. Pensão Alimentícia (inf beneficiário no campo 7)', valoresDe(model, (x) => x.pensao), 3);
    linhaDados(doc, '5. Imposto de Renda Retido', valoresDe(model, (x) => x.irrf), 4);

    // --- Secao 4 (isentos) ---
    secao(doc, '4. Rendimentos isentos e não tributáveis', true);
    cabecalhoTabela(doc, '');
    const zeros = new Array(12).fill(0);
    linhaDados(doc, '1. Parcela isenta dos proventos de aposentadoria (65 anos ou mais)', valoresDe(model, (x) => x.isen.p65), 0);
    linhaDados(doc, '2. Parcela isenta do 13º salário e aposentadoria, reserva remunerada, reforma e pensão (65 anos ou mais)', valoresDe(model, (x) => x.isen.p65_13), 1);
    linhaDados(doc, '3. Diárias e ajuda de custo', valoresDe(model, (x) => x.isen.diarias), 2);
    linhaDados(doc, '4. Pensão Proventos de Aposentadoria ou Reforma por Moléstia Grave e Aposentadoria ou Reforma por Acidente em Serviço', valoresDe(model, (x) => x.isen.moleGrave), 3);
    linhaDados(doc, '5. Lucro e Dividendo Apurado a partir de 1996 pago por PJ (Lucro Real, Presumido ou Arbitrado) *Ver nota no rodapé', zeros, 4, { strike: true });
    linhaDados(doc, '6. Valores Pagos ao Titular ou Sócio da Microempresa ou Empresa de Pequeno Porte, exceto Pró labore, Aluguéis ou Serviços Prestados', zeros, 5);
    linhaDados(doc, '7. Indenizações Rescisão Contrato Trabalho/PDV/AcTrab', valoresDe(model, (x) => x.isen.indeniz), 6);
    linhaDados(doc, '8. Juros de mora recebidos, devidos pelo atraso no pagamento de remuneração por exercício de emprego, cargo ou função', valoresDe(model, (x) => x.isen.juros), 7);
    // "Outros" (inclui abono pecuniário): so aparece quando ha valor.
    const outros = valoresDe(model, (x) => x.isen.outros);
    if (outros.some((v) => Math.abs(v) > 0.005)) {
      linhaDados(doc, '9. Outros Rendimentos', outros, 8);
    }

    // --- Secao 5 (tributacao exclusiva) ---
    secao(doc, '5. Rendimentos sujeitos à tributação exclusiva', true);
    cabecalhoTabela(doc, '');
    linhaDados(doc, '1. 13º (Décimo terceiro) salário', valoresDe(model, (x) => x.base13), 0);
    linhaDados(doc, '2. Imposto sobre a renda retido na fonte sobre 13º (décimo terceiro) salário', valoresDe(model, (x) => x.irrf13), 1);

    // --- Secao 6 ---
    secao(doc, '6. Rendimentos recebidos acumuladamente (Art 12-A Lei 7.713/88)', false);

    // --- Secao 7 ---
    secao(doc, '7. Informações Complementares', true);
    subBarra(doc, '7.1. Plano de saúde');
    planosSecao(doc, model);
    subBarra(doc, '7.2. Reembolso Plano de saúde');
    subBarra(doc, 'Operadora: ', '');
    cabecalhoTabela(doc, 'Dependente (Nome / CPF)');
    linhaDados(doc, '', new Array(12).fill(0), 0);
    subBarra(doc, '7.3. Pensão alimentícia');
    pensoesSecao(doc, model);

    // --- Secao 8 ---
    secao(doc, '8. Responsável pelas informações', false);
    responsavelSecao(doc, model);
  }

  // ------------------------------------------------------------------
  //  Emissao do PDF (objetos, xref, trailer).
  // ------------------------------------------------------------------
  function emitir(doc) {
    const enc = new TextEncoder();
    const partes = [];
    let len = 0;
    const off = [];
    const push = (x) => {
      const b = typeof x === 'string' ? enc.encode(x) : x;
      partes.push(b);
      len += b.length;
    };

    const N = doc.pages.length;
    // objetos: 1 catalog, 2 pages, 3 F1, 4 F2, depois (page, content) x N
    const pageObj = [];
    const contObj = [];
    let prox = 5;
    for (let i = 0; i < N; i++) {
      pageObj.push(prox++);
      contObj.push(prox++);
    }
    const totalObjs = prox - 1;

    push('%PDF-1.4\n%\xFF\xFF\xFF\xFF\n');

    off[1] = len;
    push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

    off[2] = len;
    push(
      `2 0 obj\n<< /Type /Pages /Kids [${pageObj.map((n) => `${n} 0 R`).join(' ')}] /Count ${N} ` +
        `/MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> >>\nendobj\n`
    );

    off[3] = len;
    push('3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n');
    off[4] = len;
    push('4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj\n');

    for (let i = 0; i < N; i++) {
      off[pageObj[i]] = len;
      push(`${pageObj[i]} 0 obj\n<< /Type /Page /Parent 2 0 R /Contents ${contObj[i]} 0 R >>\nendobj\n`);

      const stream = doc.pages[i].ops.join('\n') + '\n';
      const bytes = enc.encode(stream);
      off[contObj[i]] = len;
      push(`${contObj[i]} 0 obj\n<< /Length ${bytes.length} >>\nstream\n`);
      push(bytes);
      push('endstream\nendobj\n');
    }

    const xrefStart = len;
    const size = totalObjs + 1;
    let xref = `xref\n0 ${size}\n0000000000 65535 f \n`;
    for (let n = 1; n <= totalObjs; n++) xref += String(off[n]).padStart(10, '0') + ' 00000 n \n';
    push(xref);
    push(`trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`);

    const out = new Uint8Array(len);
    let o = 0;
    for (const b of partes) {
      out.set(b, o);
      o += b.length;
    }
    return out;
  }

  // ---------------- API ----------------
  function gerarUm(model) {
    const doc = criarDoc();
    doc.novaPagina();
    renderInforme(doc, model);
    return emitir(doc);
  }

  function gerarVarios(models) {
    const doc = criarDoc();
    models.forEach((m) => {
      doc.novaPagina();
      renderInforme(doc, m);
    });
    return emitir(doc);
  }

  function sanitizarNome(s) {
    return String(s || 'informe').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'informe';
  }
  function baixarBlob(blob, nome) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nome;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  NS.informePdf = { gerarUm, gerarVarios, emitir, sanitizarNome, baixarBlob, MESES };
})();
