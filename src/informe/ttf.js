/*
 * ttf.js — leitor mínimo de fontes TrueType.
 * ------------------------------------------------------------------
 * Extrai o necessário para EMBUTIR uma fonte TTF num PDF simples
 * (/Subtype /TrueType + WinAnsiEncoding): larguras por caractere
 * (WinAnsi 0–255, em 1000/em) e as métricas do FontDescriptor.
 *
 * Usado no comprovante oficial para reproduzir a fonte do sistema
 * (Tahoma). Como a Tahoma é proprietária, embutimos por padrão a
 * DejaVu Sans (livre, mesma família larga); basta trocar o arquivo
 * em /fonts para usar a Tahoma real.
 */
;(function () {
  const NS = (self.IRRF = self.IRRF || {});

  // WinAnsi 0x80–0x9F -> Unicode (os demais códigos são identidade/Latin-1).
  const WINMAP = {
    0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026, 0x86: 0x2020,
    0x87: 0x2021, 0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160, 0x8b: 0x2039, 0x8c: 0x0152,
    0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022,
    0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a,
    0x9c: 0x0153, 0x9e: 0x017e, 0x9f: 0x0178,
  };
  const winansi = (c) => (c >= 0x80 && c <= 0x9f ? WINMAP[c] || c : c);

  function parseCmap4(dv, off) {
    if (dv.getUint16(off) !== 4) return () => 0;
    const segX2 = dv.getUint16(off + 6);
    const segCount = segX2 / 2;
    const endO = off + 14;
    const startO = endO + segX2 + 2;
    const deltaO = startO + segX2;
    const rangeO = deltaO + segX2;
    return (c) => {
      if (c > 0xffff) return 0;
      for (let i = 0; i < segCount; i++) {
        const end = dv.getUint16(endO + i * 2);
        if (c <= end) {
          const start = dv.getUint16(startO + i * 2);
          if (c < start) return 0;
          const delta = dv.getInt16(deltaO + i * 2);
          const ro = dv.getUint16(rangeO + i * 2);
          if (ro === 0) return (c + delta) & 0xffff;
          const g = dv.getUint16(rangeO + i * 2 + ro + (c - start) * 2);
          return g === 0 ? 0 : (g + delta) & 0xffff;
        }
      }
      return 0;
    };
  }

  function parse(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const numTables = dv.getUint16(4);
    const tbl = {};
    for (let i = 0; i < numTables; i++) {
      const p = 12 + i * 16;
      const tag = String.fromCharCode(bytes[p], bytes[p + 1], bytes[p + 2], bytes[p + 3]);
      tbl[tag] = { off: dv.getUint32(p + 8), len: dv.getUint32(p + 12) };
    }
    const head = tbl.head.off;
    const unitsPerEm = dv.getUint16(head + 18) || 1000;
    const bbox = [dv.getInt16(head + 36), dv.getInt16(head + 38), dv.getInt16(head + 40), dv.getInt16(head + 42)];
    const hhea = tbl.hhea.off;
    const ascent = dv.getInt16(hhea + 4);
    const descent = dv.getInt16(hhea + 6);
    const numHM = dv.getUint16(hhea + 34);
    const hmtxOff = tbl.hmtx.off;
    const adv = (g) => dv.getUint16(hmtxOff + (g < numHM ? g : numHM - 1) * 4);

    let capHeight = Math.round(ascent * 0.7);
    let weight = 400;
    if (tbl['OS/2']) {
      const o = tbl['OS/2'].off;
      weight = dv.getUint16(o + 4) || 400;
      if (dv.getUint16(o) >= 2) capHeight = dv.getInt16(o + 88) || capHeight;
    }

    // escolhe subtabela cmap Unicode (prefere Windows BMP 3,1)
    const cmapOff = tbl.cmap.off;
    const nSub = dv.getUint16(cmapOff + 2);
    let best = -1;
    let bestScore = -1;
    for (let i = 0; i < nSub; i++) {
      const p = cmapOff + 4 + i * 8;
      const plat = dv.getUint16(p);
      const enc = dv.getUint16(p + 2);
      const score = plat === 3 && enc === 1 ? 3 : plat === 0 ? 2 : plat === 3 && enc === 0 ? 1 : 0;
      if (score > bestScore) { bestScore = score; best = cmapOff + dv.getUint32(p + 4); }
    }
    const lookup = parseCmap4(dv, best);

    const scale = 1000 / unitsPerEm;
    const sc = (v) => Math.round(v * scale);
    const widths = new Array(256).fill(0);
    for (let c = 0; c < 256; c++) {
      const g = lookup(winansi(c));
      if (g) widths[c] = Math.round(adv(g) * scale);
    }

    return {
      unitsPerEm,
      widths,
      ascent: sc(ascent),
      descent: sc(descent),
      capHeight: sc(capHeight),
      bbox: bbox.map(sc),
      italicAngle: 0,
      flags: 32, // nonsymbolic
      stemV: weight >= 600 ? 140 : 88,
    };
  }

  NS.ttf = { parse };
})();
