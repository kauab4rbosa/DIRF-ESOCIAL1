/*
 * informe.js — página do Informe de Rendimentos.
 * Faz o upload da pasta, parseia os XMLs (S-5002), monta os modelos,
 * exibe o preview e exporta em PDF (individual por colaborador ou todos
 * juntos no mesmo PDF). A Razão Social, o CNPJ e o Nome são editáveis.
 */
(function () {
  const NS = self.IRRF;
  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  let modelos = [];
  let idx = 0;
  let fonte = { razao: '', cnpj: '' };

  // Nome do colaborador a partir da pasta-pai ("IRRF eSocial/<NOME>/...").
  function nomeDaPasta(path) {
    const p = String(path || '').split('/').filter(Boolean);
    if (p.length >= 2) {
      const pai = p[p.length - 2];
      if (!/^(irrf esocial|informes esocial|informes|xml|xmls|downloads)$/i.test(pai)) return pai;
    }
    return '';
  }

  function aplicarFonte(m) {
    m.razaoSocial = fonte.razao || '';
    m.cnpjFonte = fonte.cnpj || '';
    return m;
  }

  function nomeArquivo(m) {
    return `Informe ${m.ano} - ${m.nome || NS.informe.fmt.cpf(m.cpf)}`;
  }

  // ---------------- upload + parsing ----------------
  async function processarPasta(fileList) {
    const arqs = Array.from(fileList || []).filter((f) => /\.xml$/i.test(f.name));
    if (!arqs.length) {
      $('statusUpload').textContent = 'Nenhum arquivo XML encontrado na seleção.';
      return;
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
    idx = 0;
    mostrarApp();
  }

  // ---------------- telas ----------------
  function mostrarApp() {
    $('upload').classList.add('oculto');
    $('toolbar').classList.remove('oculto');
    montarPessoas();
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
    $('btnTodos').style.display = varias ? '' : 'none';
    $('lblJuntar').style.display = varias ? '' : 'none';
  }

  function render() {
    const m = aplicarFonte(modelos[idx]);
    $('preview').innerHTML = NS.informeLayout.buildHtml(m);
    const elNome = document.querySelector('#preview [data-edit="nome"]');
    if (elNome) {
      elNome.setAttribute('contenteditable', 'true');
      elNome.addEventListener('input', () => {
        modelos[idx].nome = elNome.textContent.trim();
        // reflete no seletor
        const opt = $('pessoa').options[idx];
        if (opt) opt.textContent = `${modelos[idx].nome || NS.informe.fmt.cpf(modelos[idx].cpf)} — ${modelos[idx].ano}`;
      });
    }
  }

  // ---------------- exportação ----------------
  // Rasteriza um modelo (fora da tela) e devolve { jpeg, w, h }.
  async function paginaDe(model) {
    aplicarFonte(model);
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

  async function comExport(fn) {
    aviso('');
    document.body.style.cursor = 'progress';
    try {
      await fn();
    } catch (err) {
      aviso(
        'Não foi possível gerar o PDF automaticamente (' +
          (err && err.message ? err.message : err) +
          '). Use "Imprimir" e salve como PDF.'
      );
    } finally {
      document.body.style.cursor = '';
    }
  }

  async function baixarAtual() {
    const pg = await paginaDe(modelos[idx]);
    NS.informeExport.baixarPdf([pg], nomeArquivo(modelos[idx]));
  }

  async function baixarTodos() {
    const juntar = $('juntar').checked;
    if (juntar) {
      const paginas = [];
      for (let i = 0; i < modelos.length; i++) {
        aviso(`Gerando ${i + 1}/${modelos.length}…`);
        paginas.push(await paginaDe(modelos[i]));
        await sleep(20);
      }
      const anos = [...new Set(modelos.map((m) => m.ano))].sort().join('-');
      NS.informeExport.baixarPdf(paginas, `Informes ${anos}`);
      aviso('');
    } else {
      for (let i = 0; i < modelos.length; i++) {
        aviso(`Gerando ${i + 1}/${modelos.length}…`);
        const pg = await paginaDe(modelos[i]);
        NS.informeExport.baixarPdf([pg], nomeArquivo(modelos[i]));
        await sleep(250);
      }
      aviso('');
    }
  }

  // ---------------- eventos ----------------
  function wire() {
    $('pasta').addEventListener('change', (e) => processarPasta(e.target.files));
    $('razao').addEventListener('input', (e) => {
      fonte.razao = e.target.value;
      render();
    });
    $('cnpj').addEventListener('input', (e) => {
      fonte.cnpj = e.target.value;
      render();
    });
    $('pessoa').addEventListener('change', (e) => {
      idx = Number(e.target.value) || 0;
      render();
    });
    $('btnPdf').addEventListener('click', () => comExport(baixarAtual));
    $('btnTodos').addEventListener('click', () => comExport(baixarTodos));
    $('btnPrint').addEventListener('click', () => window.print());
    $('btnTrocar').addEventListener('click', mostrarUpload);
  }

  wire();
})();
