/*
 * informe.js — página do Informe de Rendimentos.
 * Upload da pasta -> parse dos XMLs (S-5002) -> preview -> exportação.
 *
 * "Baixar PDF": junta todos os informes da tela num único PDF (uma página
 * por colaborador). Marcando "Quebrar por empregado", baixa PDFs separados
 * dentro de um .zip.
 *
 * Razão Social e CNPJ completo da empresa são preenchidos automaticamente
 * (CNPJ matriz derivado da raiz + consulta BrasilAPI), assim como a razão
 * social das operadoras de plano de saúde. Todos os campos são editáveis.
 */
(function () {
  const NS = self.IRRF;
  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  let modelos = [];
  let idx = 0;

  const rootOf = (m) =>
    String((m.empregador && m.empregador.nrInsc) || '').replace(/\D/g, '').padStart(8, '0').slice(0, 8);

  function nomeDaPasta(path) {
    const p = String(path || '').split('/').filter(Boolean);
    if (p.length >= 2) {
      const pai = p[p.length - 2];
      if (!/^(irrf esocial|informes esocial|informes|xml|xmls|downloads)$/i.test(pai)) return pai;
    }
    return '';
  }

  function nomeArquivo(m) {
    return `Informe ${m.ano} - ${m.nome || NS.informe.fmt.cpf(m.cpf)}`;
  }

  function anosLabel() {
    return [...new Set(modelos.map((m) => m.ano))].sort().join('-');
  }

  // ---------------- upload + parsing ----------------
  async function processarPasta(fileList) {
    const todos = Array.from(fileList || []);
    const arqs = todos.filter((f) => /\.xml$/i.test(f.name));
    if (!arqs.length) {
      $('statusUpload').textContent = 'Nenhum arquivo XML encontrado na seleção.';
      return;
    }

    // Sidecar com o estabelecimento real (gravado pelo download): tem
    // prioridade sobre o CNPJ derivado.
    const empresaPorRaiz = {};
    for (const f of todos.filter((f) => /_empresa.*\.json$/i.test(f.name))) {
      try {
        const j = JSON.parse(await f.text());
        const r = String(j.raiz || '').replace(/\D/g, '').slice(0, 8);
        if (r) empresaPorRaiz[r] = { cnpj: j.cnpj || '', razao: j.razao || '' };
      } catch (_) {}
    }
    $('statusUpload').textContent = `Lendo ${arqs.length} arquivo(s)…`;

    const registros = [];
    const nomePorCpf = {};
    let ignorados = 0;
    for (const f of arqs) {
      try {
        const txt = await f.text();
        const r = NS.informe.parseXml(txt);
        if (r) {
          registros.push(r);
          const nm = nomeDaPasta(f.webkitRelativePath || f.name);
          if (nm && !nomePorCpf[r.cpf]) nomePorCpf[r.cpf] = nm;
        } else {
          ignorados++;
        }
      } catch (_) {
        ignorados++;
      }
    }

    if (!registros.length) {
      $('statusUpload').textContent =
        'Nenhum evento S-5002 (evtIrrfBenef) válido foi encontrado nos XMLs.';
      return;
    }

    modelos = NS.informe.construirModelos(registros, nomePorCpf);
    // aplica o estabelecimento real (sidecar) antes do auto-preenchimento
    for (const m of modelos) {
      const e = empresaPorRaiz[rootOf(m)];
      if (e) {
        if (e.cnpj) m.cnpjFonte = e.cnpj;
        if (e.razao) m.razaoSocial = e.razao;
      }
    }
    idx = 0;
    mostrarApp();
    autoPreencher(); // assíncrono (razão social / CNPJ) — só preenche o que faltar
  }

  // ---------------- auto-preenchimento (empresa + operadoras) ----------------
  async function autoPreencher() {
    // CNPJ completo (matriz) derivado da raiz; razão via BrasilAPI.
    const porRaiz = {};
    for (const m of modelos) {
      const r = rootOf(m);
      (porRaiz[r] = porRaiz[r] || []).push(m);
      if (!m.cnpjFonte) m.cnpjFonte = NS.informe.fmt.cnpj(NS.informe.cnpjMatriz(r));
    }
    sincronizarToolbar();
    render();

    for (const r of Object.keys(porRaiz)) {
      try {
        const razao = await NS.informeLookup.razaoSocial(NS.informe.cnpjMatriz(r));
        if (razao) {
          for (const m of porRaiz[r]) if (!m.razaoSocial) m.razaoSocial = razao;
          sincronizarToolbar();
          render();
        }
      } catch (_) {}
    }

    // Operadoras de plano de saúde.
    const opers = new Set();
    for (const m of modelos) for (const c of Object.keys(m.planos || {})) opers.add(c);
    for (const c of opers) {
      try {
        const razao = await NS.informeLookup.razaoSocial(c);
        if (razao) {
          for (const m of modelos) {
            if (m.planos && m.planos[c] && !m.planos[c].razao) m.planos[c].razao = razao;
          }
          render();
        }
      } catch (_) {}
    }
  }

  // ---------------- telas ----------------
  function mostrarApp() {
    $('upload').classList.add('oculto');
    $('toolbar').classList.remove('oculto');
    montarPessoas();
    sincronizarToolbar();
    render();
  }

  function mostrarUpload() {
    $('toolbar').classList.add('oculto');
    $('preview').innerHTML = '';
    $('upload').classList.remove('oculto');
    $('pasta').value = '';
    $('statusUpload').textContent = '';
    modelos = [];
  }

  function montarPessoas() {
    const sel = $('pessoa');
    sel.innerHTML = '';
    modelos.forEach((m, i) => {
      const o = document.createElement('option');
      o.value = String(i);
      o.textContent = `${m.nome || NS.informe.fmt.cpf(m.cpf)} — ${m.ano}`;
      sel.appendChild(o);
    });
    const varias = modelos.length > 1;
    $('grpPessoa').style.display = varias ? '' : 'none';
    $('lblQuebra').style.display = varias ? '' : 'none';
  }

  function sincronizarToolbar() {
    const m = modelos[idx] || {};
    $('razao').value = m.razaoSocial || '';
    $('cnpj').value = m.cnpjFonte || '';
  }

  function render() {
    const m = modelos[idx];
    if (!m) return;
    $('preview').innerHTML = NS.informeLayout.buildHtml(m);

    const elNome = document.querySelector('#preview [data-edit="nome"]');
    if (elNome) {
      elNome.setAttribute('contenteditable', 'true');
      elNome.addEventListener('input', () => {
        m.nome = elNome.textContent.trim();
        const opt = $('pessoa').options[idx];
        if (opt) opt.textContent = `${m.nome || NS.informe.fmt.cpf(m.cpf)} — ${m.ano}`;
      });
    }
    // operadoras editáveis
    document.querySelectorAll('#preview [data-edit="oper"]').forEach((el) => {
      el.setAttribute('contenteditable', 'true');
      el.addEventListener('input', () => {
        const cnpj = el.getAttribute('data-cnpj');
        const txt = el.textContent.trim();
        for (const mm of modelos) if (mm.planos && mm.planos[cnpj]) mm.planos[cnpj].razao = txt;
      });
    });
  }

  // ---------------- exportação ----------------
  async function paginaDe(model) {
    const host = $('offscreen');
    host.innerHTML = NS.informeLayout.buildHtml(model);
    const el = host.querySelector('.inf');
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const pg = await NS.informeExport.elementoParaJpeg(el, 2);
    host.innerHTML = '';
    return pg;
  }

  function aviso(txt) {
    $('aviso').textContent = txt || '';
  }

  async function baixarPdf() {
    aviso('');
    document.body.style.cursor = 'progress';
    try {
      // um único colaborador -> um PDF
      if (modelos.length === 1) {
        const pg = await paginaDe(modelos[0]);
        NS.informeExport.baixarPdf([pg], nomeArquivo(modelos[0]));
        return;
      }

      const quebrar = $('quebra').checked;
      if (quebrar) {
        // PDFs separados, num .zip
        const arquivos = [];
        for (let i = 0; i < modelos.length; i++) {
          aviso(`Gerando ${i + 1}/${modelos.length}…`);
          const pg = await paginaDe(modelos[i]);
          const pdf = NS.informeExport.montarPdf([pg]);
          arquivos.push({ nome: NS.informeExport.sanitizarNome(nomeArquivo(modelos[i])) + '.pdf', dados: pdf });
          await sleep(15);
        }
        const zip = NS.zip.criarZip(arquivos);
        NS.informeExport.baixarBlob(new Blob([zip], { type: 'application/zip' }), `Informes ${anosLabel()}.zip`);
      } else {
        // tudo junto num único PDF (uma página por colaborador)
        const paginas = [];
        for (let i = 0; i < modelos.length; i++) {
          aviso(`Gerando ${i + 1}/${modelos.length}…`);
          paginas.push(await paginaDe(modelos[i]));
          await sleep(15);
        }
        NS.informeExport.baixarPdf(paginas, `Informes ${anosLabel()}`);
      }
      aviso('');
    } catch (err) {
      aviso('Falha ao gerar o PDF: ' + (err && err.message ? err.message : err));
    } finally {
      document.body.style.cursor = '';
    }
  }

  // ---------------- eventos ----------------
  function wire() {
    $('pasta').addEventListener('change', (e) => processarPasta(e.target.files));
    $('razao').addEventListener('input', (e) => {
      const r = rootOf(modelos[idx]);
      for (const m of modelos) if (rootOf(m) === r) m.razaoSocial = e.target.value;
      render();
    });
    $('cnpj').addEventListener('input', (e) => {
      const r = rootOf(modelos[idx]);
      for (const m of modelos) if (rootOf(m) === r) m.cnpjFonte = e.target.value;
      render();
    });
    $('pessoa').addEventListener('change', (e) => {
      idx = Number(e.target.value) || 0;
      sincronizarToolbar();
      render();
    });
    $('btnPdf').addEventListener('click', baixarPdf);
    $('btnTrocar').addEventListener('click', mostrarUpload);
  }

  wire();
})();
