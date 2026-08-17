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

  // Quando embutimos uma fonte TTF (comprovante oficial), as larguras vêm
  // dela; caso contrário usamos as métricas da Helvetica padrão.
  let FONTE_ATUAL = null; // { reg: {widths[256]}, bold: {widths[256]} } ou null
  function larguraChar(code, bold) {
    if (FONTE_ATUAL) {
      const ws = (bold ? FONTE_ATUAL.bold : FONTE_ATUAL.reg).widths;
      return ws[code] || ws[0x3f] || 500;
    }
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

  // ==================================================================
  //  MODELO OFICIAL — Comprovante de Rendimentos (IN RFB 2.060/2021),
  //  com totais anuais (não mês a mês) e o brasão da República.
  // ==================================================================
  function imagemDoc(doc, x, yTop, w, h) {
    doc.op(`q ${num(w)} 0 0 ${num(h)} ${num(x)} ${num(H - yTop - h)} cm /ImBrasao Do Q`);
  }
  function brasaoImagem() {
    const b = NS.brasao;
    if (!b || !b.b64) return null;
    const bin = atob(b.b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    // filter: 'flate' -> imagem sem perdas (raw + zlib); senão JPEG (DCTDecode).
    return { bytes: u, w: b.w, h: b.h, cs: b.cs || 'DeviceRGB', bpc: b.bpc || 8, filter: b.filter || 'dct' };
  }

  // Soma os 12 meses do modelo -> totais anuais para o comprovante oficial.
  function totaisAno(model) {
    const t = {
      rendTrib: 0, prevOficial: 0, prevCompl: 0, pensao: 0, irrf: 0,
      p65: 0, p65_13: 0, diarias: 0, moleGrave: 0, indeniz: 0, juros: 0, outros: 0,
      abonoPec: 0, auxMoradia: 0, bolsaMedico: 0, isenOutros: 0,
      base13: 0, irrf13: 0, plr: 0, plrIrrf: 0, mMin: 13, mMax: 0,
    };
    for (let i = 1; i <= 12; i++) {
      const m = model.meses[i];
      t.rendTrib += m.rendTrib; t.prevOficial += m.prevOficial; t.prevCompl += m.prevCompl;
      t.pensao += m.pensao; t.irrf += m.irrf; t.base13 += m.base13; t.irrf13 += m.irrf13;
      t.plr += m.plr || 0; t.plrIrrf += m.plrIrrf || 0;
      t.p65 += m.isen.p65;         // 70
      t.p65_13 += m.isen.p65_13;   // 71
      t.diarias += m.isen.diarias; // 72 + 73
      t.moleGrave += m.isen.moleGrave; // 76 + 77
      t.indeniz += m.isen.indeniz; // 74
      t.juros += m.isen.juros;     // juros de mora
      t.outros += m.isen.outros;   // 75 (abono) + 79 + 700
      t.abonoPec += m.isen.abonoPec || 0;
      t.auxMoradia += m.isen.auxMoradia || 0;
      t.bolsaMedico += m.isen.bolsaMedico || 0;
      t.isenOutros += m.isen.isenOutros || 0;
      const isen = m.isen;
      const any = m.rendTrib || m.prevOficial || m.irrf || m.pensao || m.base13 || m.irrf13 || m.plr ||
        isen.p65 || isen.p65_13 || isen.diarias || isen.moleGrave || isen.indeniz || isen.juros || isen.outros;
      if (any) { if (i < t.mMin) t.mMin = i; if (i > t.mMax) t.mMax = i; }
    }
    if (t.mMax === 0) { t.mMin = 1; t.mMax = 12; }
    return t;
  }
  const pad2 = (n) => String(n).padStart(2, '0');

  // Estilo do comprovante oficial (igual ao do sistema): bordas finas
  // pretas, sem barras cinza, título em negrito acima da tabela.
  // Fonte única de 7,86 pt em TODO o documento (padrão do sistema).
  const OF_LINHA = [0.12, 0.12, 0.14];
  const OF_S = 7.86;  // rótulo / valor / nota / título (o título só muda o peso)
  const OF_SB = 7.86;
  const OF_VAL_W = 80; // coluna "Valores em Reais"
  const KV_H = 23;     // altura das linhas de identificação
  const BAND_H = 14;   // altura das bandas da seção 7

  function moldura(doc, x, y, w, h, cor, esp) {
    esp = esp || 0.5; cor = cor || OF_LINHA;
    linhaH(doc, x, y, w, cor, esp);
    linhaH(doc, x, y + h - esp, w, cor, esp);
    linhaV(doc, x, y, h, cor, esp);
    linhaV(doc, x + w - esp, y, h, cor, esp);
  }
  function caixaVazia(doc, h) {
    espaco(doc, h);
    const y = doc.y;
    moldura(doc, MX, y, CONTENT_W, h, OF_LINHA, 0.5);
    doc.y = y + h;
  }

  // Altura de uma tabela rótulo|valor (para manter o título junto na paginação).
  function alturaTabela(rows) {
    const xVal = W - MX - OF_VAL_W;
    const lineH = OF_S * 1.2;
    return rows.reduce((s, r) => {
      const n = quebrar(r.label, OF_S, false, xVal - MX - 8).length;
      return s + Math.max(lineH, n * lineH) + 5;
    }, 0);
  }

  // Título de seção: negrito sobre branco (+ "Valores em Reais"). `proxAltura`
  // = altura do bloco seguinte, para não separar o título dele na virada de página.
  function tituloSec(doc, titulo, comValores, proxAltura) {
    doc.y += 6;
    espaco(doc, OF_SB + 3 + (proxAltura || 0));
    const y = doc.y;
    texto(doc, MX, y + OF_SB * 0.82, titulo, { size: OF_SB, bold: true, rgb: PRETO });
    if (comValores) {
      texto(doc, W - MX, y + OF_SB * 0.82, 'Valores em Reais', { size: OF_SB, bold: true, rgb: PRETO, align: 'right' });
    }
    doc.y = y + OF_SB + 3;
  }

  // Tabela rótulo | valor (coluna à direita), com bordas.
  function tabelaValores(doc, rows) {
    const xVal = W - MX - OF_VAL_W;
    const lineH = OF_S * 1.2;
    const meta = rows.map((r) => {
      const linhas = quebrar(r.label, OF_S, false, xVal - MX - 8);
      const h = Math.max(lineH, linhas.length * lineH) + 5;
      return { linhas, h, valor: r.valor };
    });
    const totalH = meta.reduce((s, m) => s + m.h, 0);
    espaco(doc, totalH);
    const y0 = doc.y;
    let y = y0;
    meta.forEach((m, i) => {
      if (i > 0) linhaH(doc, MX, y, CONTENT_W, OF_LINHA, 0.4);
      const bl = y + 3 + OF_S * 0.8;
      m.linhas.forEach((ln, k) => texto(doc, MX + 5, bl + k * lineH, ln, { size: OF_S, rgb: PRETO }));
      texto(doc, W - MX - 5, bl, money(m.valor), { size: OF_S, rgb: PRETO, align: 'right' });
      y += m.h;
    });
    moldura(doc, MX, y0, CONTENT_W, totalH, OF_LINHA, 0.5);
    linhaV(doc, xVal, y0, totalH, OF_LINHA, 0.4);
    doc.y = y0 + totalH;
  }

  // Caixa de campos (rótulo em cima, valor embaixo), como identificação.
  function caixaCampos(doc, linhas) {
    const rows = linhas.map((cells) => ({ cells, h: KV_H, flex: cells.reduce((s, c) => s + (c.flex || 1), 0) }));
    const totalH = rows.reduce((s, r) => s + r.h, 0);
    espaco(doc, totalH);
    const y0 = doc.y;
    let y = y0;
    rows.forEach((r, ri) => {
      if (ri > 0) linhaH(doc, MX, y, CONTENT_W, OF_LINHA, 0.4);
      let x = MX;
      r.cells.forEach((c, ci) => {
        const w = (CONTENT_W * (c.flex || 1)) / r.flex;
        if (ci > 0) linhaV(doc, x, y, r.h, OF_LINHA, 0.4);
        texto(doc, x + 5, y + 9, c.label, { size: OF_S, rgb: [0.28, 0.28, 0.3] });
        texto(doc, x + 5, y + 19, c.valor || '', { size: OF_S, bold: !!c.bold, rgb: PRETO });
        x += w;
      });
      y += r.h;
    });
    moldura(doc, MX, y0, CONTENT_W, totalH, OF_LINHA, 0.5);
    doc.y = y0 + totalH;
  }

  // ---- caixa de "bandas" (linhas de altura fixa + moldura) — usada na seção 7.
  function desenhaCols(doc, y, h, cells, xs) {
    cells.forEach((c, k) => {
      if (c.a === 'right') texto(doc, xs[k + 1] - 4, y + 9, c.t, { size: OF_S, bold: !!c.b, rgb: PRETO, align: 'right' });
      else texto(doc, xs[k] + 5, y + 9, c.t, { size: OF_S, bold: !!c.b, rgb: PRETO });
    });
    for (let k = 1; k < xs.length - 1; k++) linhaV(doc, xs[k], y, h, OF_LINHA, 0.4);
  }
  function caixaBandas(doc, bandas) {
    if (!bandas.length) return;
    const totalH = bandas.reduce((s, b) => s + b.h, 0);
    espaco(doc, totalH);
    const y0 = doc.y;
    let y = y0;
    bandas.forEach((b, i) => { if (i > 0) linhaH(doc, MX, y, CONTENT_W, OF_LINHA, 0.4); b.draw(y); y += b.h; });
    moldura(doc, MX, y0, CONTENT_W, totalH, OF_LINHA, 0.5);
    doc.y = y0 + totalH;
  }

  // ---- caixa com uma nota (texto corrido) — usada p/ observações da seção 7.
  function alturaNota(str) {
    const linhas = quebrar(str, OF_S, false, CONTENT_W - 14);
    return linhas.length * (OF_S * 1.4) + 9;
  }
  function notaBoxOficial(doc, str) {
    const linhas = quebrar(str, OF_S, false, CONTENT_W - 14);
    const lineH = OF_S * 1.4;
    const h = linhas.length * lineH + 9;
    espaco(doc, h);
    const y0 = doc.y;
    let bl = y0 + 5 + OF_S * 0.8;
    linhas.forEach((ln) => { texto(doc, MX + 6, bl, ln, { size: OF_S, rgb: PRETO }); bl += lineH; });
    moldura(doc, MX, y0, CONTENT_W, h, OF_LINHA, 0.5);
    doc.y = y0 + h;
  }

  // Cabeçalho oficial: brasão + ministério (esq.) | comprovante + período (dir.) + nota.
  function cabecalhoOficial(doc, model, t) {
    const ano = model.ano;
    const y0 = doc.y;
    const colW = CONTENT_W * 0.5;
    const xR = MX + colW;
    const hTop = 60;

    if (NS.brasao) imagemDoc(doc, MX + 4, y0 + 6, 46, (46 * NS.brasao.h) / NS.brasao.w);
    const lx = MX + 56;
    texto(doc, lx, y0 + 13, 'MINISTÉRIO DA ECONOMIA', { size: OF_S, bold: true, rgb: PRETO });
    texto(doc, lx, y0 + 25, 'SECRETARIA DA RECEITA FEDERAL DO BRASIL', { size: OF_S, bold: true, rgb: PRETO });
    texto(doc, lx, y0 + 37, 'IMPOSTO SOBRE A RENDA DA PESSOA FÍSICA', { size: OF_S, bold: true, rgb: PRETO });
    texto(doc, lx, y0 + 51, 'EXERCÍCIO:', { size: OF_S, bold: true, rgb: PRETO });
    texto(doc, lx + 72, y0 + 51, String(ano + 1), { size: OF_S, bold: true, rgb: PRETO });

    const rx = xR + 6;
    texto(doc, rx, y0 + 13, 'COMPROVANTE DE RENDIMENTOS PAGOS E DE', { size: OF_S, bold: true, rgb: PRETO });
    texto(doc, rx, y0 + 25, 'IMPOSTO SOBRE A RENDA RETIDO NA FONTE', { size: OF_S, bold: true, rgb: PRETO });
    linhaH(doc, xR, y0 + 33, colW, OF_LINHA, 0.4);
    texto(doc, rx, y0 + 45, 'ANO-CALENDÁRIO:', { size: OF_S, bold: true, rgb: PRETO });
    texto(doc, rx + 108, y0 + 45, String(ano), { size: OF_S, bold: true, rgb: PRETO });
    texto(doc, rx, y0 + 56, 'PERÍODO:', { size: OF_S, bold: true, rgb: PRETO });
    texto(doc, rx + 108, y0 + 56, `DE ${pad2(t.mMin)}/${ano} A ${pad2(t.mMax)}/${ano}`, { size: OF_S, bold: true, rgb: PRETO });

    linhaV(doc, xR, y0, hTop, OF_LINHA, 0.4);

    const noteY = y0 + hTop;
    linhaH(doc, MX, noteY, CONTENT_W, OF_LINHA, 0.4);
    const aviso =
      'Verifique as condições e o prazo para a apresentação da Declaração do Imposto sobre a Renda da Pessoa Física ' +
      'para este ano - calendário no site da Secretaria Especial da Receita Federal do Brasil na Internet, no ' +
      'endereço <https://www.gov.br/receitafederal/pt-br>';
    const noteLines = quebrar(aviso, OF_S, false, CONTENT_W - 10);
    let ny = noteY + 3 + OF_S * 0.8;
    noteLines.forEach((ln) => { texto(doc, MX + 5, ny, ln, { size: OF_S, rgb: PRETO }); ny += 9.4; });
    const totalH = hTop + noteLines.length * 9.4 + 5;
    moldura(doc, MX, y0, CONTENT_W, totalH, OF_LINHA, 0.5);
    doc.y = y0 + totalH;
  }

  // Seção 7 — Informações complementares. Tabelas SEPARADAS: uma caixa por
  // operadora de plano de saúde e, após um respiro, a caixa de pensão
  // alimentícia. Sem a linha "DESCONTO PLANO DE SAÚDE" e sem "Data Nasc.".
  const COLS_PLANO = [MX, MX + 250, MX + 300, MX + 430, W - MX]; // Benef | Tipo | CPF | Valor
  const COLS_PENS = [MX, MX + 320, MX + 445, W - MX];            // Benef | CPF | Valor

  function planoBox(doc, model, cnpj, idx) {
    const pl = model.planos[cnpj];
    const bandas = [];
    bandas.push({ h: 15, draw: (y) =>
      texto(doc, MX + 5, y + 10, 'INFORMAÇÕES DA OPERADORA DE PLANO DE SAÚDE DO BENEFICIÁRIO DO DECLARANTE', { size: OF_S, bold: true, rgb: PRETO }) });
    bandas.push({ h: 14, draw: (y) =>
      texto(doc, MX + 5, y + 9.5, `Nome:  ${idx + 1} - ${pl.razao || '—'}`, { size: OF_S, rgb: PRETO }) });
    bandas.push({ h: 14, draw: (y) => {
      texto(doc, MX + 5, y + 9.5, `CNPJ:  ${fmt().cnpj(cnpj)}`, { size: OF_S, rgb: PRETO });
      texto(doc, MX + 250, y + 9.5, `Registro ANS:  ${pl.regANS || '—'}`, { size: OF_S, rgb: PRETO });
    } });
    bandas.push({ h: 15, draw: (y) => desenhaCols(doc, y, 15, [
      { t: 'Beneficiário do Plano de Saúde', b: true }, { t: 'Tipo', b: true },
      { t: 'CPF', b: true }, { t: 'Valor Pago', b: true, a: 'right' },
    ], COLS_PLANO) });
    let vt = 0; for (let i = 1; i <= 12; i++) vt += pl.titMeses[i] || 0;
    bandas.push({ h: 14, draw: (y) => desenhaCols(doc, y, 14, [
      { t: model.nome || '' }, { t: 'T' }, { t: fmt().cpf(model.cpf) }, { t: money(vt), a: 'right' },
    ], COLS_PLANO) });
    for (const d of Object.keys(pl.deps || {})) {
      const dep = pl.deps[d]; let vd = 0; for (let i = 1; i <= 12; i++) vd += dep.meses[i] || 0;
      bandas.push({ h: 14, draw: (y) => desenhaCols(doc, y, 14, [
        { t: dep.nome || '' }, { t: 'D' }, { t: fmt().cpf(d) }, { t: money(vd), a: 'right' },
      ], COLS_PLANO) });
    }
    caixaBandas(doc, bandas);
  }

  function pensaoBox(doc, model) {
    const pens = Object.keys(model.pensoes || {});
    const pens13 = Object.keys(model.pensoes13 || {}).filter((c) => (model.pensoes13[c].total || 0) > 0);
    if (!pens.length && !pens13.length) return;
    const bandas = [];
    bandas.push({ h: 15, draw: (y) =>
      texto(doc, MX + 5, y + 10, 'INFORMAÇÕES DE PENSÃO ALIMENTÍCIA', { size: OF_S, bold: true, rgb: PRETO }) });
    bandas.push({ h: 15, draw: (y) => desenhaCols(doc, y, 15, [
      { t: 'Beneficiário de Pensão Alimentícia Mensal', b: true }, { t: 'CPF', b: true }, { t: 'Valor Pago', b: true, a: 'right' },
    ], COLS_PENS) });
    if (pens.length) {
      pens.forEach((cpf) => {
        const p = model.pensoes[cpf];
        let v = 0; for (let i = 1; i <= 12; i++) v += (p.meses && p.meses[i]) || 0;
        const val = v || p.total || 0;
        bandas.push({ h: 14, draw: (y) => desenhaCols(doc, y, 14, [
          { t: p.nome || '(beneficiário)' }, { t: fmt().cpf(cpf) }, { t: money(val), a: 'right' },
        ], COLS_PENS) });
      });
    } else {
      bandas.push({ h: 14, draw: (y) => desenhaCols(doc, y, 14, [{ t: '—' }, { t: '' }, { t: money(0), a: 'right' }], COLS_PENS) });
    }
    if (pens13.length) {
      bandas.push({ h: 15, draw: (y) => desenhaCols(doc, y, 15, [
        { t: 'Beneficiário de Pensão Alimentícia 13º', b: true }, { t: 'CPF', b: true }, { t: 'Valor Pago', b: true, a: 'right' },
      ], COLS_PENS) });
      pens13.forEach((cpf) => {
        const p = model.pensoes13[cpf];
        bandas.push({ h: 14, draw: (y) => desenhaCols(doc, y, 14, [
          { t: p.nome || '(beneficiário)' }, { t: fmt().cpf(cpf) }, { t: money(p.total || 0), a: 'right' },
        ], COLS_PENS) });
      });
    }
    caixaBandas(doc, bandas);
  }

  // Altura do primeiro bloco da seção 7 (p/ manter o título junto na paginação).
  function alturaSecao7(model, nota) {
    if (nota) return alturaNota(nota);
    const cnpjs = Object.keys(model.planos || {});
    const pens = Object.keys(model.pensoes || {});
    const pens13 = Object.keys(model.pensoes13 || {}).filter((c) => (model.pensoes13[c].total || 0) > 0);
    if (!cnpjs.length && !pens.length && !pens13.length) return 16;
    if (cnpjs.length) {
      const pl = model.planos[cnpjs[0]];
      const ndeps = Object.keys(pl.deps || {}).length;
      return 15 + 14 + 14 + 15 + 14 * (1 + ndeps);
    }
    return 15 + 15 + 14 * Math.max(1, pens.length) + (pens13.length ? 15 + 14 * pens13.length : 0);
  }

  function secao7Oficial(doc, model, opts) {
    opts = opts || {};
    const nota = opts.plrNota;
    const cnpjs = Object.keys(model.planos || {});
    const pens = Object.keys(model.pensoes || {});
    const pens13 = Object.keys(model.pensoes13 || {}).filter((c) => (model.pensoes13[c].total || 0) > 0);
    const temBoxes = cnpjs.length || pens.length || pens13.length;
    if (!nota && !temBoxes) { caixaVazia(doc, 16); return; }
    if (nota) {
      notaBoxOficial(doc, nota);
      if (temBoxes) doc.y += 8; // respiro entre a nota e as tabelas
    }
    cnpjs.forEach((cnpj, idx) => {
      if (idx > 0) doc.y += 6;
      planoBox(doc, model, cnpj, idx);
    });
    if (cnpjs.length && (pens.length || pens13.length)) doc.y += 8; // ESPAÇO entre plano e pensão
    pensaoBox(doc, model);
  }

  function renderOficial(doc, model) {
    const ano = model.ano;
    const t = totaisAno(model);
    const natureza = /assalariado/i.test(model.natureza || '') ? 'RENDIMENTO DO TRABALHO ASSALARIADO' : (model.natureza || 'RENDIMENTO DO TRABALHO ASSALARIADO');

    // Item 4.9 "Outros (especificar)": discrimina os componentes classificados no XML.
    const compOutros = [
      ['Abono pecuniário', t.abonoPec],
      ['Auxílio-moradia', t.auxMoradia],
      ['Bolsa de médico-residente', t.bolsaMedico],
      ['Outras isenções', t.isenOutros],
    ].filter((c) => Math.abs(c[1]) > 0.005);
    let lbl9 = '9. Outros (especificar).';
    if (compOutros.length === 1) lbl9 = `9. Outros (especificar): ${compOutros[0][0]}.`;
    else if (compOutros.length > 1) lbl9 = `9. Outros (especificar): ${compOutros.map((c) => `${c[0]} (R$ ${money(c[1])})`).join('; ')}.`;

    // Linhas de cada quadro extraídas antes, p/ medir a altura e evitar que a
    // paginação quebre um título longe da sua tabela (ou corte uma tabela).
    const rows3 = [
      { label: '1. Total dos rendimentos (inclusive férias).', valor: t.rendTrib },
      { label: '2. Contribuição previdenciária oficial.', valor: t.prevOficial },
      { label: '3. Contribuição a entidades de previdência complementar, pública ou privada, e a Fundo de Aposentadoria Programada Individual - (Fapi) (preencher também o Quadro 7).', valor: t.prevCompl },
      { label: '4. Pensão alimentícia (preencher também o Quadro 7).', valor: t.pensao },
      { label: '5. Imposto sobre a Renda Retido na Fonte (IRRF).', valor: t.irrf },
    ];
    const rows4 = [
      { label: '1. Parcela isenta dos proventos de aposentadoria, reserva remunerada, reforma e pensão (65 anos ou mais), exceto a parcela isenta do 13º (décimo terceiro) salário.', valor: t.p65 },
      { label: '2. Parcela isenta do 13º salário de aposentadoria, reserva remunerada, reforma e pensão (65 anos ou mais).', valor: t.p65_13 },
      { label: '3. Diárias e ajudas de custo.', valor: t.diarias },
      { label: '4. Pensão e proventos de aposentadoria ou reforma por moléstia grave; proventos de aposentadoria ou reforma por acidente em serviço.', valor: t.moleGrave },
      { label: '5. Lucros e dividendos, apurados a partir de 1996, pagos por pessoa jurídica (lucro real, presumido ou arbitrado).', valor: 0 },
      { label: '6. Valores pagos ao titular ou sócio da microempresa ou empresa de pequeno porte, exceto pró-labore, aluguéis ou serviços prestados.', valor: 0 },
      { label: '7. Indenizações por rescisão de contrato de trabalho, inclusive a título de PDV e por acidente de trabalho.', valor: t.indeniz },
      { label: '8. Juros de mora recebidos, devidos pelo atraso no pagamento de remuneração por exercício de emprego, cargo ou função.', valor: t.juros },
      { label: lbl9, valor: t.outros },
    ];
    // PLR (Participação nos Lucros e Resultados): tributação exclusiva -> entra
    // no Quadro 5, linha 3 "Outros", pelo líquido (bruto - IRRF), com nota no Q7.
    const plrLiq = n2(t.plr - t.plrIrrf);
    const temPlr = Math.abs(plrLiq) > 0.005 || Math.abs(t.plr) > 0.005;
    const plrNota = temPlr
      ? `O total informado na linha 03 do Quadro 5 já inclui o valor total pago a título de PLR correspondente a R$ ${money(plrLiq)}`
      : null;
    const rows5 = [
      { label: '1. 13º (décimo terceiro) salário.', valor: t.base13 },
      { label: '2. Imposto sobre a Renda Retido na Fonte sobre 13º (décimo terceiro) salário.', valor: t.irrf13 },
      { label: temPlr ? '3. Outros.Participação de lucros' : '3. Outros.', valor: plrLiq },
    ];

    cabecalhoOficial(doc, model, t);

    tituloSec(doc, '1. Fonte Pagadora Pessoa Jurídica ou Pessoa Física', false, KV_H);
    caixaCampos(doc, [[
      { label: 'CNPJ/CPF', valor: model.cnpjFonte || fmt().cnpj(model.empregador.nrInsc), flex: 1 },
      { label: 'Nome Empresarial / Nome Completo', valor: model.razaoSocial || '', flex: 2.1 },
    ]]);

    tituloSec(doc, '2. Pessoa Física Beneficiária dos Rendimentos', false, 2 * KV_H);
    caixaCampos(doc, [
      [{ label: 'CPF', valor: fmt().cpf(model.cpf), flex: 1 }, { label: 'Nome Completo', valor: model.nome || '', flex: 2.1 }],
      [{ label: 'Natureza do Rendimento', valor: natureza, flex: 1 }],
    ]);

    tituloSec(doc, '3. Rendimentos Tributáveis, Deduções e Imposto sobre a Renda Retido na Fonte', true, alturaTabela(rows3));
    tabelaValores(doc, rows3);

    tituloSec(doc, '4. Rendimentos Isentos e Não Tributáveis', true, alturaTabela(rows4));
    tabelaValores(doc, rows4);

    tituloSec(doc, '5. Rendimentos Sujeitos a Tributação Exclusiva (rendimento líquido)', true, alturaTabela(rows5));
    tabelaValores(doc, rows5);

    tituloSec(doc, '6. Rendimentos Recebidos Acumuladamente - Art. 12-A da Lei nº 7.713, de 1988 (sujeitos a tributação exclusiva)', false, 16);
    caixaVazia(doc, 16);

    tituloSec(doc, '7. Informações Complementares', false, alturaSecao7(model, plrNota));
    secao7Oficial(doc, model, { plrNota });

    tituloSec(doc, '8. Responsável pelas Informações', false, KV_H + 12);
    const hoje = new Date();
    const data = `${pad2(hoje.getDate())}/${pad2(hoje.getMonth() + 1)}/${hoje.getFullYear()}`;
    caixaCampos(doc, [[
      { label: 'Nome', valor: model.razaoSocial || '', flex: 2.2 },
      { label: 'Data', valor: data, flex: 0.9 },
      { label: 'Assinatura', valor: '', flex: 1.3 },
    ]]);
    doc.y += 8;
    texto(doc, MX, doc.y + 7, 'Aprovado pela Instrução Normativa RFB nº 2.060, de 13 de dezembro de 2021.', { size: OF_S, rgb: PRETO });
    doc.y += 12;
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
    // 3. Participação nos Lucros e Resultados (líquido) — só aparece quando há valor.
    const plrLiqMes = valoresDe(model, (x) => (x.plr || 0) - (x.plrIrrf || 0));
    if (plrLiqMes.some((v) => Math.abs(v) > 0.005)) {
      linhaDados(doc, '3. Outros — Participação nos Lucros e Resultados (líquido)', plrLiqMes, 2);
    }

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
    const embed = !!(doc.fontes && doc.fontes.reg && doc.fontes.bold);
    const temImg = !!(doc.imagem && doc.imagem.bytes);
    // objetos fixos: 1 catalog, 2 pages, 3 F1, 4 F2; depois [descritores/arquivos
    // da fonte embutida], [imagem], e (page, content) x N.
    let prox = 5;
    let f1file = 0, f1desc = 0, f2file = 0, f2desc = 0, imgNum = 0;
    if (embed) { f1file = prox++; f1desc = prox++; f2file = prox++; f2desc = prox++; }
    if (temImg) imgNum = prox++;
    const pageObj = [];
    const contObj = [];
    for (let i = 0; i < N; i++) {
      pageObj.push(prox++);
      contObj.push(prox++);
    }
    const totalObjs = prox - 1;

    push('%PDF-1.4\n%\xFF\xFF\xFF\xFF\n');

    off[1] = len;
    push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

    off[2] = len;
    const xobj = temImg ? ` /XObject << /ImBrasao ${imgNum} 0 R >>` : '';
    push(
      `2 0 obj\n<< /Type /Pages /Kids [${pageObj.map((n) => `${n} 0 R`).join(' ')}] /Count ${N} ` +
        `/MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >>${xobj} >> >> >>\nendobj\n`
    );

    if (embed) {
      const fdict = (num, descNum, nome, info) =>
        `${num} 0 obj\n<< /Type /Font /Subtype /TrueType /BaseFont /${nome} /FirstChar 32 /LastChar 255 ` +
        `/Widths [${info.widths.slice(32, 256).join(' ')}] /Encoding /WinAnsiEncoding /FontDescriptor ${descNum} 0 R >>\nendobj\n`;
      const fdesc = (num, fileNum, nome, info) =>
        `${num} 0 obj\n<< /Type /FontDescriptor /FontName /${nome} /Flags ${info.flags} ` +
        `/FontBBox [${info.bbox.join(' ')}] /ItalicAngle ${info.italicAngle} /Ascent ${info.ascent} ` +
        `/Descent ${info.descent} /CapHeight ${info.capHeight} /StemV ${info.stemV} /FontFile2 ${fileNum} 0 R >>\nendobj\n`;
      const ffile = (num, f) => {
        off[num] = len;
        push(`${num} 0 obj\n<< /Length ${f.z.length} /Length1 ${f.length1} /Filter /FlateDecode >>\nstream\n`);
        push(f.z);
        push('\nendstream\nendobj\n');
      };
      const R = doc.fontes.reg, B = doc.fontes.bold;
      const nomeR = R.nome || 'EmbeddedFont', nomeB = B.nome || 'EmbeddedFontBold';
      off[3] = len; push(fdict(3, f1desc, nomeR, R.info));
      off[4] = len; push(fdict(4, f2desc, nomeB, B.info));
      ffile(f1file, R);
      off[f1desc] = len; push(fdesc(f1desc, f1file, nomeR, R.info));
      ffile(f2file, B);
      off[f2desc] = len; push(fdesc(f2desc, f2file, nomeB, B.info));
    } else {
      off[3] = len;
      push('3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n');
      off[4] = len;
      push('4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj\n');
    }

    if (temImg) {
      const img = doc.imagem;
      const filtro = img.filter === 'flate' ? 'FlateDecode' : 'DCTDecode';
      off[imgNum] = len;
      push(
        `${imgNum} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${img.w} /Height ${img.h} ` +
          `/ColorSpace /${img.cs || 'DeviceRGB'} /BitsPerComponent ${img.bpc || 8} /Filter /${filtro} ` +
          `/Length ${img.bytes.length} >>\nstream\n`
      );
      push(img.bytes);
      push('\nendstream\nendobj\n');
    }

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
  //  opts.modelo: 'detalhado' (mês a mês, padrão) | 'oficial' (Comprovante RFB)
  //  Prepara a fonte embutida (Tahoma) para o modelo oficial, se carregada.
  function comFonteOficial(doc, oficial, fn) {
    if (oficial) {
      doc.imagem = brasaoImagem();
      doc.fontes = NS.fontesOficial || null;
    }
    const prev = FONTE_ATUAL;
    if (doc.fontes) FONTE_ATUAL = { reg: doc.fontes.reg.info, bold: doc.fontes.bold.info };
    try { return fn(); } finally { FONTE_ATUAL = prev; }
  }

  function gerarUm(model, opts) {
    const oficial = opts && opts.modelo === 'oficial';
    const doc = criarDoc();
    return comFonteOficial(doc, oficial, () => {
      doc.novaPagina();
      if (oficial) renderOficial(doc, model);
      else renderInforme(doc, model);
      return emitir(doc);
    });
  }

  function gerarVarios(models, opts) {
    const oficial = opts && opts.modelo === 'oficial';
    const doc = criarDoc();
    return comFonteOficial(doc, oficial, () => {
      models.forEach((m) => {
        doc.novaPagina();
        if (oficial) renderOficial(doc, m);
        else renderInforme(doc, m);
      });
      return emitir(doc);
    });
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
