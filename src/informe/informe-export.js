/*
 * informe-export.js
 * ------------------------------------------------------------------
 * Exportacao do informe (elemento HTML) para PNG e PDF, sem
 * dependencias externas:
 *  - PNG: serializa o elemento em SVG/foreignObject e rasteriza num
 *    canvas (texto vetorial -> nitido em alta resolucao).
 *  - PDF: incorpora o JPEG do canvas em um PDF de uma pagina (gerado
 *    a mao, com DCTDecode).
 *
 * Caso a rasterizacao falhe em algum navegador, a pagina oferece o
 * botao "Imprimir" (window.print) como alternativa confiavel.
 */
;(function () {
  const NS = (self.IRRF = self.IRRF || {});

  // Rasteriza um elemento para um <canvas> na escala desejada.
  async function elementoParaCanvas(el, escala) {
    escala = escala || 2;
    const largura = el.offsetWidth;
    const altura = el.offsetHeight;

    const clone = el.cloneNode(true);
    clone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
    const xhtml = new XMLSerializer().serializeToString(clone);

    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${largura}" height="${altura}">` +
      `<foreignObject x="0" y="0" width="100%" height="100%">${xhtml}</foreignObject>` +
      `</svg>`;

    const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    const img = new Image();
    img.width = largura;
    img.height = altura;
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('Falha ao rasterizar o informe.'));
      img.src = url;
    });

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(largura * escala);
    canvas.height = Math.round(altura * escala);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  function canvasParaPngBlob(canvas) {
    return new Promise((resolve, reject) => {
      try {
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob vazio'))), 'image/png');
      } catch (e) {
        reject(e);
      }
    });
  }

  // dataURL JPEG -> Uint8Array
  function dataUrlParaBytes(dataUrl) {
    const base64 = dataUrl.split(',')[1];
    const bin = atob(base64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  // Gera um PDF de uma pagina com o JPEG ocupando a pagina (A4 retrato,
  // altura proporcional a imagem).
  function jpegParaPdf(jpeg, wpx, hpx) {
    const enc = new TextEncoder();
    const partes = [];
    let len = 0;
    const off = [];
    function push(x) {
      const b = typeof x === 'string' ? enc.encode(x) : x;
      partes.push(b);
      len += b.length;
    }
    function obj(n, corpo) {
      off[n] = len;
      push(`${n} 0 obj\n${corpo}\nendobj\n`);
    }

    const pageW = 595.28; // A4 retrato (pt)
    const pageH = Math.round((pageW * hpx) / wpx * 100) / 100;

    push(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xff, 0xff, 0xff, 0xff, 0x0a]));
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
    obj(
      3,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] ` +
        `/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`
    );
    // imagem (stream binario)
    off[4] = len;
    push(
      `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${wpx} /Height ${hpx} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`
    );
    push(jpeg);
    push('\nendstream\nendobj\n');
    // conteudo
    const cont = `q\n${pageW} 0 0 ${pageH} 0 0 cm\n/Im0 Do\nQ\n`;
    obj(5, `<< /Length ${cont.length} >>\nstream\n${cont}endstream`);
    // xref
    const xrefStart = len;
    let xref = 'xref\n0 6\n0000000000 65535 f \n';
    for (let i = 1; i <= 5; i++) xref += String(off[i]).padStart(10, '0') + ' 00000 n \n';
    push(xref);
    push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`);

    const out = new Uint8Array(len);
    let o = 0;
    for (const b of partes) {
      out.set(b, o);
      o += b.length;
    }
    return out;
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

  function sanitizarNome(s) {
    return String(s || 'informe').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'informe';
  }

  // API de alto nivel.
  async function exportarPng(el, nomeBase) {
    const canvas = await elementoParaCanvas(el, 2);
    const blob = await canvasParaPngBlob(canvas);
    baixarBlob(blob, sanitizarNome(nomeBase) + '.png');
  }

  async function exportarPdf(el, nomeBase) {
    const canvas = await elementoParaCanvas(el, 2);
    const jpeg = dataUrlParaBytes(canvas.toDataURL('image/jpeg', 0.92));
    const pdf = jpegParaPdf(jpeg, canvas.width, canvas.height);
    baixarBlob(new Blob([pdf], { type: 'application/pdf' }), sanitizarNome(nomeBase) + '.pdf');
  }

  NS.informeExport = {
    elementoParaCanvas,
    canvasParaPngBlob,
    jpegParaPdf,
    dataUrlParaBytes,
    baixarBlob,
    sanitizarNome,
    exportarPng,
    exportarPdf,
  };
})();
