/*
 * informe.js — página do Informe de Rendimentos.
 * Upload da pasta -> parse dos XMLs (S-5002) -> prévia (PDF) -> download.
 *
 * A prévia exibida na tela É o próprio PDF vetorial (renderizado num
 * <iframe>), gerado por informe-pdf.js. Logo o que aparece na tela é
 * exatamente o arquivo baixado — mesmo layout, fontes e diagramação, com
 * texto selecionável (não é imagem).
 *
 * "Baixar PDF": junta todos os colaboradores num único PDF (uma página por
 * colaborador). Marcando "Quebrar por empregado", baixa PDFs separados num
 * .zip.
 *
 * Razão Social + CNPJ da empresa e a razão social das operadoras de plano
 * de saúde são preenchidos automaticamente (editáveis na barra superior).
 */
(function () {
  const NS = self.IRRF;
  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  let modelos = [];
  let idx = 0;
  let modeloAtual = 'detalhado'; // 'detalhado' (mês a mês) | 'oficial' (Comprovante RFB)
  let urlVisor = null; // blob URL atual da prévia (revogar ao trocar)
  let reRenderTimer = null;

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
        const rs = NS.informe.parseXmlTodos(txt); // 1 evento por arquivo ou vários (mesclado)
        if (rs.length) {
          const nm = nomeDaPasta(f.webkitRelativePath || f.name);
          for (const r of rs) {
            registros.push(r);
            if (nm && !nomePorCpf[r.cpf]) nomePorCpf[r.cpf] = nm;
          }
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
          montarOperadoras();
          render();
        }
      } catch (_) {}
    }
  }

  // ---------------- telas ----------------
  function mostrarApp() {
    $('upload').classList.add('oculto');
    $('toolbar').classList.remove('oculto');
    $('preview').classList.remove('oculto');
    montarPessoas();
    sincronizarToolbar();
    render();
  }

  function mostrarUpload() {
    $('toolbar').classList.add('oculto');
    $('preview').classList.add('oculto');
    limparVisor();
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
    $('grpPessoa').style.display = '';
    $('lblColab').style.display = varias ? '' : 'none';
    $('lblQuebra').style.display = varias ? '' : 'none';
    sel.value = String(idx);
  }

  function montarOperadoras() {
    const box = $('grpOperadoras');
    box.innerHTML = '';
    const m = modelos[idx];
    const cnpjs = m && m.planos ? Object.keys(m.planos) : [];
    if (!cnpjs.length) {
      box.style.display = 'none';
      return;
    }
    box.style.display = '';
    for (const cnpj of cnpjs) {
      const lbl = document.createElement('label');
      lbl.textContent = `Operadora ${NS.informe.fmt.cnpj(cnpj)}`;
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.placeholder = 'Razão social da operadora';
      inp.value = m.planos[cnpj].razao || '';
      inp.addEventListener('input', () => {
        const txt = inp.value.trim();
        for (const mm of modelos) if (mm.planos && mm.planos[cnpj]) mm.planos[cnpj].razao = txt;
        agendarRender();
      });
      lbl.appendChild(inp);
      box.appendChild(lbl);
    }
  }

  function sincronizarToolbar() {
    const m = modelos[idx] || {};
    $('razao').value = m.razaoSocial || '';
    $('cnpj').value = m.cnpjFonte || '';
    $('nome').value = m.nome || '';
    montarOperadoras();
  }

  // ---------------- prévia (PDF no iframe) ----------------
  function limparVisor() {
    if (urlVisor) {
      URL.revokeObjectURL(urlVisor);
      urlVisor = null;
    }
    $('visor').removeAttribute('src');
  }

  function render() {
    const m = modelos[idx];
    if (!m) return;
    try {
      const pdf = NS.informePdf.gerarUm(m, { modelo: modeloAtual });
      const nova = URL.createObjectURL(new Blob([pdf], { type: 'application/pdf' }));
      // #toolbar=0 esconde a barra do leitor de PDF na prévia
      $('visor').src = nova + '#toolbar=0&navpanes=0&view=FitH';
      if (urlVisor) URL.revokeObjectURL(urlVisor);
      urlVisor = nova;
    } catch (err) {
      aviso('Falha ao gerar a prévia: ' + (err && err.message ? err.message : err));
    }
  }

  function agendarRender() {
    clearTimeout(reRenderTimer);
    reRenderTimer = setTimeout(render, 220);
  }

  // ---------------- exportação ----------------
  function aviso(txt) {
    $('aviso').textContent = txt || '';
  }

  async function baixarPdf() {
    aviso('');
    document.body.style.cursor = 'progress';
    const opts = { modelo: modeloAtual };
    try {
      if (modelos.length === 1) {
        const pdf = NS.informePdf.gerarUm(modelos[0], opts);
        NS.informePdf.baixarBlob(new Blob([pdf], { type: 'application/pdf' }), NS.informePdf.sanitizarNome(nomeArquivo(modelos[0])) + '.pdf');
        return;
      }

      if ($('quebra').checked) {
        // PDFs separados, num .zip
        const arquivos = [];
        for (let i = 0; i < modelos.length; i++) {
          aviso(`Gerando ${i + 1}/${modelos.length}…`);
          const pdf = NS.informePdf.gerarUm(modelos[i], opts);
          arquivos.push({ nome: NS.informePdf.sanitizarNome(nomeArquivo(modelos[i])) + '.pdf', dados: pdf });
          await sleep(5);
        }
        const zip = NS.zip.criarZip(arquivos);
        NS.informePdf.baixarBlob(new Blob([zip], { type: 'application/zip' }), `Informes ${anosLabel()}.zip`);
      } else {
        // tudo junto num único PDF (uma página por colaborador)
        const pdf = NS.informePdf.gerarVarios(modelos, opts);
        NS.informePdf.baixarBlob(new Blob([pdf], { type: 'application/pdf' }), `Informes ${anosLabel()}.pdf`);
      }
      aviso('');
    } catch (err) {
      aviso('Falha ao gerar o PDF: ' + (err && err.message ? err.message : err));
    } finally {
      document.body.style.cursor = '';
    }
  }

  // ---------------- arrastar e soltar (pasta/arquivos) ----------------
  function coletarEntradas(entry, files) {
    return new Promise((resolve) => {
      if (entry.isFile) {
        entry.file(
          (file) => {
            try {
              Object.defineProperty(file, 'webkitRelativePath', {
                value: String(entry.fullPath || '').replace(/^\//, ''),
              });
            } catch (_) {}
            files.push(file);
            resolve();
          },
          () => resolve()
        );
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        const acumulado = [];
        const lerLote = () =>
          reader.readEntries((ents) => {
            if (!ents.length) {
              Promise.all(acumulado.map((e) => coletarEntradas(e, files))).then(resolve);
            } else {
              acumulado.push(...ents);
              lerLote(); // readEntries pode devolver em lotes
            }
          }, () => resolve());
        lerLote();
      } else {
        resolve();
      }
    });
  }

  async function arquivosDoDrop(dt) {
    const items = Array.from((dt && dt.items) || []);
    const entries = items
      .map((it) => (it.webkitGetAsEntry ? it.webkitGetAsEntry() : null))
      .filter(Boolean);
    if (entries.length) {
      const files = [];
      await Promise.all(entries.map((e) => coletarEntradas(e, files)));
      return files;
    }
    return Array.from((dt && dt.files) || []);
  }

  function wireDropzone() {
    const dz = $('dropzone');
    if (!dz) return;
    ['dragenter', 'dragover'].forEach((ev) =>
      dz.addEventListener(ev, (e) => {
        e.preventDefault();
        dz.classList.add('dragover');
      })
    );
    ['dragleave', 'dragend', 'drop'].forEach((ev) =>
      dz.addEventListener(ev, (e) => {
        e.preventDefault();
        dz.classList.remove('dragover');
      })
    );
    dz.addEventListener('drop', async (e) => {
      $('statusUpload').textContent = 'Lendo arquivos…';
      const files = await arquivosDoDrop(e.dataTransfer);
      if (files.length) processarPasta(files);
      else $('statusUpload').textContent = 'Nenhum arquivo reconhecido na seleção.';
    });
  }

  // ---------------- fonte do comprovante oficial (Tahoma, embutida) ----------------
  async function deflateZlib(bytes) {
    const cs = new CompressionStream('deflate'); // formato zlib (FlateDecode)
    const w = cs.writable.getWriter();
    w.write(bytes);
    w.close();
    return new Uint8Array(await new Response(cs.readable).arrayBuffer());
  }
  async function carregarFontesOficiais() {
    if (NS.fontesOficial || !NS.ttf || typeof CompressionStream === 'undefined') return;
    const carregar = async (url, nome) => {
      const buf = new Uint8Array(await (await fetch(url)).arrayBuffer());
      return { z: await deflateZlib(buf), length1: buf.length, info: NS.ttf.parse(buf), nome };
    };
    try {
      const [reg, bold] = await Promise.all([
        carregar('/fonts/tahoma.ttf', 'Tahoma'),
        carregar('/fonts/tahomabd.ttf', 'TahomaBold'),
      ]);
      NS.fontesOficial = { reg, bold };
      if (modeloAtual === 'oficial' && modelos.length) render(); // re-render com Tahoma
    } catch (_) {
      /* sem a fonte, o oficial cai na Helvetica */
    }
  }

  // ---------------- eventos ----------------
  function wire() {
    $('pasta').addEventListener('change', (e) => processarPasta(e.target.files));
    wireDropzone();
    $('razao').addEventListener('input', (e) => {
      const r = rootOf(modelos[idx]);
      for (const m of modelos) if (rootOf(m) === r) m.razaoSocial = e.target.value;
      agendarRender();
    });
    $('cnpj').addEventListener('input', (e) => {
      const r = rootOf(modelos[idx]);
      for (const m of modelos) if (rootOf(m) === r) m.cnpjFonte = e.target.value;
      agendarRender();
    });
    $('nome').addEventListener('input', (e) => {
      const m = modelos[idx];
      if (!m) return;
      m.nome = e.target.value;
      const opt = $('pessoa').options[idx];
      if (opt) opt.textContent = `${m.nome || NS.informe.fmt.cpf(m.cpf)} — ${m.ano}`;
      agendarRender();
    });
    $('pessoa').addEventListener('change', (e) => {
      idx = Number(e.target.value) || 0;
      sincronizarToolbar();
      render();
    });
    $('btnPdf').addEventListener('click', baixarPdf);
    $('btnTrocar').addEventListener('click', mostrarUpload);

    const seg = $('segModelo');
    if (seg) {
      seg.querySelectorAll('.seg-btn').forEach((b) => {
        b.addEventListener('click', () => {
          modeloAtual = b.getAttribute('data-modelo') || 'detalhado';
          seg.querySelectorAll('.seg-btn').forEach((x) => {
            const on = x === b;
            x.classList.toggle('is-active', on);
            x.setAttribute('aria-selected', on ? 'true' : 'false');
          });
          render();
        });
      });
    }
  }

  wire();
  carregarFontesOficiais();
})();
