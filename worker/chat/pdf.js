// A tiny PDF writer for invoices: US Letter, Helvetica, text and lines only. No libraries, like xlsx.js.
// Text is converted to WinAnsi; anything outside it becomes "?".
const W = { // Helvetica glyph widths for ASCII 32..126 (per 1000 em)
  r: [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584],
  b: [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584],
};
const clean = (s) => String(s ?? '').replace(/[^\x20-\x7E -ÿ]/g, '?');
const esc = (s) => clean(s).replace(/[\\()]/g, (c) => '\\' + c);
const hex = (s) => { let o = ''; for (const ch of clean(s)) o += ch.charCodeAt(0).toString(16).padStart(2, '0'); return o; };
export const textWidth = (s, size, bold) => { let w = 0; for (const ch of clean(s)) { const c = ch.charCodeAt(0); w += (c >= 32 && c <= 126 ? (bold ? W.b : W.r)[c - 32] : 556); } return (w * size) / 1000; };

export class Pdf {
  constructor() { this.pages = []; this.newPage(); }
  newPage() { this.cur = []; this.pages.push(this.cur); this.y = 750; }
  // fill/stroke colors are 0..1 rgb arrays
  text(s, { x = 54, y = this.y, size = 10, bold = false, color = [0.06, 0.13, 0.18], right = 0 } = {}) {
    const px = right ? right - textWidth(s, size, bold) : x;
    this.cur.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${color.join(' ')} rg ${px.toFixed(2)} ${y.toFixed(2)} Td <${hex(s)}> Tj ET`);
  }
  line(x1, y1, x2, y2, { width = 0.8, color = [0.58, 0.75, 0.2] } = {}) { this.cur.push(`${color.join(' ')} RG ${width} w ${x1} ${y1} m ${x2} ${y2} l S`); }
  rect(x, y, w, h, color) { this.cur.push(`${color.join(' ')} rg ${x} ${y} ${w} ${h} re f`); }
  bytes() {
    const enc = new TextEncoder(); const objs = [];
    const add = (body) => { objs.push(body); return objs.length; };
    const cat = add(''), pagesObj = add(''), f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'), f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const kids = [];
    for (const p of this.pages) {
      const content = p.join('\n');
      const c = add(`<< /Length ${enc.encode(content).length} >>\nstream\n${content}\nendstream`);
      kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${c} 0 R >>`));
    }
    objs[cat - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
    objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
    let out = '%PDF-1.4\n'; const offs = [];
    objs.forEach((o, i) => { offs.push(enc.encode(out).length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const xref = enc.encode(out).length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size ${objs.length + 1} /Root ${cat} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return enc.encode(out);
  }
}
