/*
 * informe-export.js
 * ------------------------------------------------------------------
 * Exportacao do informe para PDF (uma ou varias paginas), sem
 * dependencias externas:
 *  - rasteriza cada informe (elemento HTML) num <canvas> via
 *    SVG/foreignObject (texto vetorial -> nitido em alta resolucao);
 *  - converte para JPEG e monta um PDF (DCTDecode), podendo juntar
 *    varios colaboradores no mesmo arquivo (uma pagina por informe).
 *
 * Fallback confiavel: a pagina tambem oferece "Imprimir" (window.print).
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

  // dataURL -> Uint8Array
  function dataUrlParaBytes(dataUrl) {
    const base64 = dataUrl.split(',')[1];
    const bin = atob(base64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  // Rasteriza e devolve { jpeg:Uint8Array, w, h }.
  async function elementoParaJpeg(el, escala, qualidade) {
    const canvas = await elementoParaCanvas(el, escala || 2);
    const jpeg = dataUrlParaBytes(canvas.toDataURL('image/jpeg', qualidade || 0.95));
    return { jpeg, w: canvas.width, h: canvas.height };
  }

  // Monta um PDF com N paginas. paginas = [{ jpeg, w, h }].
  function montarPdf(paginas) {
    const enc = new TextEncoder();
    const partes = [];
    let len = 0;
    const off = [];
    function push(x) {
      const b = typeof x === 'string' ? enc.encode(x) : x;
      partes.push(b);
      len += b.length;
    }

    const N = paginas.length;
    const pageNums = [];
    const imgNums = [];
    const contNums = [];
    let prox = 3; // 1=catalog, 2=pages
    for (let i = 0; i < N; i++) {
      pageNums.push(prox++);
      imgNums.push(prox++);
      contNums.push(prox++);
    }
    const totalObjs = prox - 1;
    const A4W = 595.28; // largura A4 retrato (pt)

    push(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xff, 0xff, 0xff, 0xff, 0x0a]));

    off[1] = len;
    push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

    off[2] = len;
    push(`2 0 obj\n<< /Type /Pages /Kids [${pageNums.map((n) => `${n} 0 R`).join(' ')}] /Count ${N} >>\nendobj\n`);

    for (let i = 0; i < N; i++) {
      const p = paginas[i];
      const pageH = Math.round((A4W * p.h) / p.w * 100) / 100;

      off[pageNums[i]] = len;
      push(
        `${pageNums[i]} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4W} ${pageH}] ` +
          `/Resources << /XObject << /Im0 ${imgNums[i]} 0 R >> >> /Contents ${contNums[i]} 0 R >>\nendobj\n`
      );

      off[imgNums[i]] = len;
      push(
        `${imgNums[i]} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${p.w} /Height ${p.h} ` +
          `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`
      );
      push(p.jpeg);
      push('\nendstream\nendobj\n');

      const cont = `q\n${A4W} 0 0 ${pageH} 0 0 cm\n/Im0 Do\nQ\n`;
      off[contNums[i]] = len;
      push(`${contNums[i]} 0 obj\n<< /Length ${cont.length} >>\nstream\n${cont}endstream\nendobj\n`);
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

  // compat: PDF de uma pagina.
  function jpegParaPdf(jpeg, w, h) {
    return montarPdf([{ jpeg, w, h }]);
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

  // paginas (uma ou varias) -> baixa um unico PDF.
  function baixarPdf(paginas, nomeBase) {
    const pdf = montarPdf(paginas);
    baixarBlob(new Blob([pdf], { type: 'application/pdf' }), sanitizarNome(nomeBase) + '.pdf');
  }

  NS.informeExport = {
    elementoParaCanvas,
    elementoParaJpeg,
    dataUrlParaBytes,
    montarPdf,
    jpegParaPdf,
    baixarBlob,
    baixarPdf,
    sanitizarNome,
  };
})();
