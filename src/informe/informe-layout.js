/*
 * informe-layout.js
 * ------------------------------------------------------------------
 * Monta o HTML do "Informe de Rendimentos" a partir do modelo
 * produzido por informe-core.js. O HTML e autocontido (inclui o
 * <style>), para poder ser exibido na pagina e rasterizado.
 */
;(function () {
  const NS = (self.IRRF = self.IRRF || {});
  const fmt = () => NS.informe.fmt;

  const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

  function round2(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }
  function money(n) {
    return fmt().moeda(round2(n || 0));
  }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
  function valoresDe(model, fn) {
    const a = [];
    for (let i = 1; i <= 12; i++) a.push(fn(model.meses[i]) || 0);
    return a;
  }

  function cabMeses(labelTexto) {
    return (
      `<tr class="hm"><th class="lbl">${esc(labelTexto || '')}</th>` +
      MESES.map((m) => `<th>${m}</th>`).join('') +
      `<th class="tot">TOTAL</th></tr>`
    );
  }

  // Linha com 12 meses + total (rotulo a esquerda).
  function linha(label, valores, opts) {
    opts = opts || {};
    let tot = 0;
    const tds = valores
      .map((v) => {
        tot += v;
        return `<td>${money(v)}</td>`;
      })
      .join('');
    const cls = opts.strike ? ' class="strike"' : '';
    return `<tr${cls}><td class="lbl">${label}</td>${tds}<td class="tot">${money(tot)}</td></tr>`;
  }

  function linhaTabela(model, fn, label, opts) {
    return linha(label, valoresDe(model, fn), opts);
  }

  // Tabela generica (secao 3/4/5).
  function tabela(linhasHtml) {
    return `<table class="grade">${cabMeses('')}${linhasHtml}</table>`;
  }

  // ---- Secao 7.1: plano de saude ----
  function blocoMesesIdent(labelCol, ident, mesesObj) {
    const vals = [];
    for (let i = 1; i <= 12; i++) vals.push(mesesObj[i] || 0);
    return `<table class="grade">${cabMeses(labelCol)}${linha(ident, vals)}</table>`;
  }

  function secaoPlanos(model) {
    const cnpjs = Object.keys(model.planos || {});
    if (!cnpjs.length) {
      // estrutura vazia (como no layout oficial)
      let h = `<div class="sub">Operadora do plano de saúde:</div>`;
      h += `<div class="nota">Pagamentos a planos de saúde no ano referência</div>`;
      h += blocoMesesIdent('Titular (CPF)', fmt().cpf(model.cpf), {});
      h += `<table class="grade">${cabMeses('Dependente (Nome / CPF)')}<tr><td class="lbl">&nbsp;</td>${MESES.map(() => '<td>0,00</td>').join('')}<td class="tot">0,00</td></tr></table>`;
      return h;
    }
    let h = '';
    for (const cnpj of cnpjs) {
      const pl = model.planos[cnpj];
      h += `<div class="sub">Operadora: <b>${fmt().cnpj(cnpj)}</b>${pl.regANS ? ` &middot; ANS ${esc(pl.regANS)}` : ''}</div>`;
      h += `<div class="nota">Pagamentos a planos de saúde no ano referência</div>`;
      // Titular
      h += blocoMesesIdent('Titular (CPF)', fmt().cpf(model.cpf), pl.titMeses);
      // Dependentes
      const deps = Object.keys(pl.deps);
      let linhasDep = '';
      if (deps.length) {
        for (const d of deps) {
          const dep = pl.deps[d];
          const vals = [];
          for (let i = 1; i <= 12; i++) vals.push(dep.meses[i] || 0);
          linhasDep += linha(`${esc(dep.nome || '')} &middot; ${fmt().cpf(d)}`, vals);
        }
      } else {
        linhasDep = `<tr><td class="lbl">&nbsp;</td>${MESES.map(() => '<td>0,00</td>').join('')}<td class="tot">0,00</td></tr>`;
      }
      h += `<table class="grade">${cabMeses('Dependente (Nome / CPF)')}${linhasDep}</table>`;
    }
    return h;
  }

  // ---- Secao 7.3: pensao alimenticia ----
  function secaoPensoes(model) {
    const cpfs = Object.keys(model.pensoes || {});
    let linhas = '';
    if (cpfs.length) {
      for (const cpf of cpfs) {
        const p = model.pensoes[cpf];
        const vals = [];
        for (let i = 1; i <= 12; i++) vals.push(p.meses[i] || 0);
        const ident = `${esc(p.nome || '(nome não informado)')} &middot; ${fmt().cpf(cpf)}`;
        linhas += linha(ident, vals);
      }
    } else {
      linhas = `<tr><td class="lbl">&nbsp;</td>${MESES.map(() => '<td>0,00</td>').join('')}<td class="tot">0,00</td></tr>`;
    }
    return `<table class="grade">${cabMeses('Dependente (Nome / CPF)')}${linhas}</table>`;
  }

  // ------------------------------------------------------------------
  //  HTML completo do informe.
  // ------------------------------------------------------------------
  function buildHtml(model) {
    const sec3 =
      linhaTabela(model, (x) => x.rendTrib, '1. Total dos Rendimentos (inclusive férias)') +
      linhaTabela(model, (x) => x.prevOficial, '2. Contribuição Previdenciária Oficial') +
      linhaTabela(model, (x) => x.prevCompl, '3. Contribuições à previdência complementar e Fapi') +
      linhaTabela(model, (x) => x.pensao, '4. Pensão Alimentícia') +
      linhaTabela(model, (x) => x.irrf, '5. Imposto de Renda Retido na Fonte');

    const zeros = new Array(12).fill(0);
    const sec4 =
      linhaTabela(model, (x) => x.isen.p65, '1. Parcela isenta proventos aposentadoria (65 anos ou mais)') +
      linhaTabela(model, (x) => x.isen.p65_13, '2. Parcela isenta 13º aposentadoria (65 anos ou mais)') +
      linhaTabela(model, (x) => x.isen.diarias, '3. Diárias e ajuda de custo') +
      linhaTabela(model, (x) => x.isen.moleGrave, '4. Pensão/Aposentadoria por moléstia grave ou acidente') +
      linha('5. Lucro e dividendo apurado a partir de 1996', zeros, { strike: true }) +
      linha('6. Valores pagos ao titular/sócio de ME/EPP', zeros) +
      linhaTabela(model, (x) => x.isen.indeniz, '7. Indenizações por rescisão de contrato/PDV') +
      linhaTabela(model, (x) => x.isen.juros, '8. Juros de mora') +
      linhaTabela(model, (x) => x.isen.outros, '9.1 Outros Rendimentos');

    const sec5 =
      linhaTabela(model, (x) => x.base13, '1. 13º (Décimo terceiro) salário') +
      linhaTabela(model, (x) => x.irrf13, '2. Imposto sobre a renda retido na fonte sobre 13º salário');

    return `
<style>
.inf{ width:980px; box-sizing:border-box; background:#fff; color:#1b1b1b;
  font-family:Arial,Helvetica,sans-serif; font-size:10px; padding:26px 30px; }
.inf h1{ color:#1f95c9; font-size:26px; margin:0 0 2px; font-weight:bold; }
.inf .ano{ font-size:15px; margin:0 0 18px; color:#444; }
.inf .sec{ color:#222; font-size:13px; font-weight:bold; margin:16px 0 0;
  border-bottom:2px solid #1f95c9; padding-bottom:3px; display:flex; justify-content:space-between; }
.inf .sec .val{ color:#1f95c9; }
.inf .ident{ padding:8px 2px; display:flex; justify-content:space-between; }
.inf .ident b{ font-weight:bold; }
.inf .bar{ background:#eef0f1; padding:6px 8px; margin-top:2px; }
.inf .sub{ background:#eef0f1; padding:5px 8px; margin-top:8px; font-weight:bold; }
.inf .nota{ padding:5px 2px; color:#333; }
.inf table.grade{ width:100%; border-collapse:collapse; margin-top:6px; table-layout:fixed; }
.inf table.grade th, .inf table.grade td{ border:0; padding:3px 2px; text-align:right;
  font-size:9px; overflow:hidden; }
.inf table.grade th{ color:#1f95c9; font-weight:bold; border-bottom:1px solid #cdd2d6; text-align:right; }
.inf table.grade th.lbl, .inf table.grade td.lbl{ text-align:left; width:230px;
  white-space:normal; font-size:9px; }
.inf table.grade th.tot, .inf table.grade td.tot{ font-weight:bold; border-left:1px solid #e2e6e9; width:60px; }
.inf table.grade tr:nth-child(even) td{ background:#f7f9fa; }
.inf table.grade tr.hm th{ background:#fff; }
.inf .strike td{ color:#9aa0a6; text-decoration:line-through; }
.inf .rodape{ margin-top:18px; color:#888; font-size:8px; border-top:1px solid #e2e6e9; padding-top:6px; }
</style>
<div class="inf">
  <h1>Informe de Rendimentos</h1>
  <div class="ano">Ano Calendário <b>${esc(model.ano)}</b></div>

  <div class="sec">1. Identificação da fonte pagadora</div>
  <div class="ident">
    <span>Razão Social: <b data-edit="razao">${esc(model.razaoSocial || '—')}</b></span>
    <span>CNPJ: <b data-edit="cnpj">${esc(model.cnpjFonte || fmt().cnpj(model.empregador.nrInsc))}</b></span>
  </div>

  <div class="sec">2. Pessoa física beneficiária dos rendimentos</div>
  <div class="ident">
    <span>Nome: <b data-edit="nome">${esc(model.nome || '—')}</b></span>
    <span>CPF: <b>${fmt().cpf(model.cpf)}</b></span>
  </div>
  <div class="bar">Natureza do rendimento: <b>${esc(model.natureza)}</b></div>

  <div class="sec">3. Rendimentos tributáveis, deduções e imposto <span class="val">Valores (R$)</span></div>
  ${tabela(sec3)}

  <div class="sec">4. Rendimentos isentos e não tributáveis <span class="val">Valores (R$)</span></div>
  ${tabela(sec4)}

  <div class="sec">5. Rendimentos sujeitos à tributação exclusiva <span class="val">Valores (R$)</span></div>
  ${tabela(sec5)}

  <div class="sec">6. Rendimentos recebidos acumuladamente (Art. 12-A, Lei 7.713/88)</div>

  <div class="sec">7. Informações Complementares <span class="val">Valores (R$)</span></div>

  <div style="margin-top:6px;font-weight:bold;">7.1. Plano de saúde</div>
  ${secaoPlanos(model)}

  <div style="margin-top:10px;font-weight:bold;">7.2. Reembolso plano de saúde</div>
  <div class="nota">Sem reembolsos informados.</div>

  <div style="margin-top:10px;font-weight:bold;">7.3. Pensão alimentícia</div>
  ${secaoPensoes(model)}

  <div class="rodape">
    Documento gerado pela extensão IRRF eSocial a partir dos eventos S-5002 (evtIrrfBenef).
    Valores em regime de caixa, por mês de apuração. Confira antes de utilizar.
  </div>
</div>`;
  }

  NS.informeLayout = { buildHtml };
})();
