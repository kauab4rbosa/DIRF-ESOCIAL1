/*
 * informe.js — pagina do Informe de Rendimentos.
 * Le os modelos (gravados pelo side panel), renderiza o preview e
 * exporta em PDF/PNG. Permite editar Razao Social, CNPJ (aplicados a
 * todos) e o Nome do beneficiario (inline).
 */
(function () {
  const NS = self.IRRF;
  const KEY = 'irrf_informe_modelos';
  const $ = (id) => document.getElementById(id);

  let modelos = [];
  let idx = 0;
  let fonte = { razao: '', cnpj: '' };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const elPreview = () => document.querySelector('#preview .inf');

  function nomeArquivo(m) {
    const quem = m.nome || NS.informe.fmt.cpf(m.cpf);
    return `Informe ${m.ano} - ${quem}`;
  }

  function aplicarFonte(m) {
    m.razaoSocial = fonte.razao || m.razaoSocial || '';
    m.cnpjFonte = fonte.cnpj || '';
    return m;
  }

  function render() {
    const m = aplicarFonte(modelos[idx]);
    $('preview').innerHTML = NS.informeLayout.buildHtml(m);
    // edicao inline do nome
    const elNome = document.querySelector('#preview [data-edit="nome"]');
    if (elNome) {
      elNome.setAttribute('contenteditable', 'true');
      elNome.addEventListener('input', () => {
        modelos[idx].nome = elNome.textContent.trim();
      });
    }
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
    sel.style.display = modelos.length > 1 ? '' : 'none';
    sel.parentElement.style.display = modelos.length > 1 ? '' : 'none';
  }

  function aviso(txt) {
    $('aviso').textContent = txt || '';
  }

  async function comExport(fn) {
    aviso('');
    try {
      await fn();
    } catch (err) {
      aviso(
        'Não foi possível gerar o arquivo automaticamente (' +
          (err && err.message ? err.message : err) +
          '). Use "Imprimir" e salve como PDF.'
      );
    }
  }

  function wire() {
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
    $('btnPdf').addEventListener('click', () =>
      comExport(() => NS.informeExport.exportarPdf(elPreview(), nomeArquivo(modelos[idx])))
    );
    $('btnPng').addEventListener('click', () =>
      comExport(() => NS.informeExport.exportarPng(elPreview(), nomeArquivo(modelos[idx])))
    );
    $('btnPrint').addEventListener('click', () => window.print());
    $('btnTodos').addEventListener('click', () =>
      comExport(async () => {
        for (let i = 0; i < modelos.length; i++) {
          idx = i;
          $('pessoa').value = String(i);
          render();
          await sleep(150);
          await NS.informeExport.exportarPdf(elPreview(), nomeArquivo(modelos[i]));
          await sleep(250);
        }
      })
    );
  }

  async function init() {
    const obj = await chrome.storage.local.get(KEY);
    const dados = obj[KEY];
    if (!dados || !dados.modelos || !dados.modelos.length) {
      document.getElementById('preview').innerHTML =
        '<p style="padding:40px;color:#555">Nenhum informe para exibir. Gere a partir do painel da extensão (seção "Gerar Informe de Rendimentos").</p>';
      $('toolbar').style.display = 'none';
      return;
    }
    modelos = dados.modelos;
    fonte = dados.fonte || { razao: '', cnpj: '' };
    $('razao').value = fonte.razao || '';
    $('cnpj').value = fonte.cnpj || '';
    montarPessoas();
    wire();
    render();
  }

  init();
})();
