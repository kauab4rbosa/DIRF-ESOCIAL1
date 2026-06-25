/*
 * zip.js — gerador de ZIP minimalista (metodo "store", sem compressao).
 * Suficiente para empacotar PDFs (que ja sao comprimidos internamente).
 */
;(function () {
  const NS = (self.IRRF = self.IRRF || {});

  // Tabela CRC32.
  const TAB = (function () {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = TAB[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  const enc = new TextEncoder();

  // arquivos = [{ nome, dados:Uint8Array }] -> Uint8Array (zip).
  function criarZip(arquivos) {
    const locais = [];
    const central = [];
    let offset = 0;

    for (const a of arquivos) {
      const nome = enc.encode(a.nome);
      const dados = a.dados;
      const crc = crc32(dados);

      // Local file header (30 bytes + nome).
      const lh = new Uint8Array(30 + nome.length);
      const lv = new DataView(lh.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true); // versao
      lv.setUint16(6, 0, true); // flags
      lv.setUint16(8, 0, true); // metodo: store
      lv.setUint16(10, 0, true); // hora
      lv.setUint16(12, 0x21, true); // data (1980-01-01)
      lv.setUint32(14, crc, true);
      lv.setUint32(18, dados.length, true);
      lv.setUint32(22, dados.length, true);
      lv.setUint16(26, nome.length, true);
      lv.setUint16(28, 0, true);
      lh.set(nome, 30);

      locais.push(lh, dados);

      // Central directory header (46 bytes + nome).
      const ch = new Uint8Array(46 + nome.length);
      const cv = new DataView(ch.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, 0, true);
      cv.setUint16(14, 0x21, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, dados.length, true);
      cv.setUint32(24, dados.length, true);
      cv.setUint16(28, nome.length, true);
      cv.setUint16(30, 0, true);
      cv.setUint16(32, 0, true);
      cv.setUint16(34, 0, true);
      cv.setUint16(36, 0, true);
      cv.setUint32(38, 0, true);
      cv.setUint32(42, offset, true);
      ch.set(nome, 46);
      central.push(ch);

      offset += lh.length + dados.length;
    }

    const cdSize = central.reduce((s, b) => s + b.length, 0);
    const cdOffset = offset;

    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, arquivos.length, true);
    ev.setUint16(10, arquivos.length, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, cdOffset, true);

    const partes = locais.concat(central, [eocd]);
    const total = partes.reduce((s, b) => s + b.length, 0);
    const out = new Uint8Array(total);
    let o = 0;
    for (const b of partes) {
      out.set(b, o);
      o += b.length;
    }
    return out;
  }

  NS.zip = { criarZip, crc32 };
})();
