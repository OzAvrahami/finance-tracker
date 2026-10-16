// Synthetic packaging check, streamed to node inside the actual production image.
// No provider, database, credentials, host mount or real receipt is used.
const assert = require('node:assert/strict');
const sharp = require('/app/server/node_modules/sharp');
const {prepareSources} = require('/app/server/services/shoppingReceiptSources');
function pdf(objects) {
  let bytes = Buffer.from('%PDF-1.4\n');
  const offsets = [];
  objects.forEach((object, i) => {
    offsets.push(bytes.length);
    bytes = Buffer.concat([bytes, Buffer.from(`${i+1} 0 obj\n`), Buffer.from(object), Buffer.from('\nendobj\n')]);
  });
  const start = bytes.length;
  return Buffer.concat([bytes, Buffer.from(`xref\n0 ${objects.length+1}\n0000000000 65535 f \n` +
    offsets.map(n => `${String(n).padStart(10,'0')} 00000 n \n`).join('') +
    `trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`)]);
}
function stream(data, properties='') {
  return Buffer.concat([Buffer.from(`<< ${properties} /Length ${data.length} >>\nstream\n`), data, Buffer.from('\nendstream')]);
}
(async () => {
  const jpeg = await sharp({create:{width:100,height:100,channels:3,background:{r:220,g:15,b:15}}}).jpeg().toBuffer();
  const scan = pdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /XObject << /Scan 5 0 R >> >> /Contents 4 0 R >>',
    stream(Buffer.from('q 100 0 0 100 0 0 cm /Scan Do Q')),
    stream(jpeg,'/Type /XObject /Subtype /Image /Width 100 /Height 100 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode')
  ]);
  const text = pdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    stream(Buffer.from('BT /F1 12 Tf 20 700 Td (Synthetic receipt product 10.90 quantity 1) Tj 0 -20 Td (Another synthetic product 20.90 quantity 2 total 31.80) Tj ET')),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ]);
  const sources = await prepareSources([jpeg, text, scan]);
  assert.deepEqual(sources.map(s=>s.kind), ['photo','pdf_text','pdf_scan']);
  assert.ok(sources[1].text.includes('Synthetic receipt'));
  const stats = await sharp(sources[2].image).stats();
  assert.ok(stats.channels[0].mean > stats.channels[1].mean*3, 'scanned image must render real pixels, not a blank page');
  console.log('PASS native sharp/canvas, PDF.js text/layout, scanned-page pixels and worker execution');
})().catch(error => { console.error(error.message); process.exitCode=1; });
