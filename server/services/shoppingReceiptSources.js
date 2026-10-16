const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');
const { receiptLimits } = require('./shoppingReceiptLimits');
const fail = (code, status = 422) => { throw Object.assign(Error(code), { status }); };
function fileType(buffer) {
  if (buffer.subarray(0, 5).toString() === '%PDF-') return 'pdf';
  if (buffer.subarray(0, 3).equals(Buffer.from([255,216,255]))) return 'image/jpeg';
  if (buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  fail('receipt_file_invalid', 415);
}
function validateFiles(buffers, limits = receiptLimits()) {
  if (!buffers.length || buffers.length > limits.files) fail('receipt_photo_count', 400);
  if (buffers.some(b => b.length > limits.fileBytes) || buffers.reduce((n,b) => n+b.length,0) > limits.totalBytes) fail('receipt_photo_size', 413);
  return buffers.map(fileType);
}
async function decodeFile(buffer, fileNumber, limits) {
  const sharp = require('sharp');
  const type = fileType(buffer);
  if (type !== 'pdf') {
    try {
      const image = await sharp(buffer, { limitInputPixels: limits.pixels, failOn: 'warning' }).rotate().resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 92 }).toBuffer();
      return [{ kind: 'photo', file_number: fileNumber, page_number: null, image }];
    } catch { fail('receipt_image_decode'); }
  }
  const { getDocument, OPS } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { createCanvas } = require('@napi-rs/canvas');
  let doc, loading;
  try {
    loading = getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, stopAtErrors: true,
      useSystemFonts: true, maxImageSize: -1 });
    doc = await loading.promise;
    if (doc.numPages > limits.pdfPages) fail('receipt_pdf_pages');
    const sources = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n), content = await page.getTextContent();
      const parts = content.items.filter(i => i.str?.trim());
      const plain = parts.map(i => i.str).join(' ');
      const operators = await page.getOperatorList();
      operators.fnArray.forEach((op,i)=>{
        const args=operators.argsArray[i];
        const pixels=op===OPS.paintImageXObject?args[1]*args[2]
          : [OPS.paintInlineImageXObject,OPS.paintImageMaskXObject].includes(op)?args[0]?.width*args[0]?.height:0;
        if(pixels>limits.pixels)fail('receipt_image_decode');
      });
      // Text headers over a scanned body are not usable embedded product text.
      const hasRaster = operators.fnArray.some(op => [OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject].includes(op));
      const usable = plain.length >= 80 && /\d[.,]\d{2}/.test(plain) &&
        (plain.match(/\uFFFD/g) ?? []).length < plain.length / 100 && (!hasRaster || plain.length >= 700);
      const text = JSON.stringify(parts.map(i => ({ text: i.str, x: Math.round(i.transform[4]), y: Math.round(i.transform[5]), width: Math.round(i.width) })));
      if (usable && text.length <= 150000) sources.push({ kind: 'pdf_text', file_number: fileNumber, page_number: n, text });
      else {
        const base = page.getViewport({ scale: 1 });
        if (!Number.isFinite(base.width * base.height) || base.width * base.height > limits.pixels) fail('receipt_image_decode');
        const viewport = page.getViewport({ scale: Math.min(2, 2400 / Math.max(base.width, base.height)) });
        const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        sources.push({ kind: 'pdf_scan', file_number: fileNumber, page_number: n, image: canvas.toBuffer('image/jpeg') });
      }
      page.cleanup();
    }
    return sources;
  } catch (e) {
    if (e.message.startsWith('receipt_')) throw e;
    fail(e.name === 'PasswordException' ? 'receipt_pdf_password' : 'receipt_pdf_unreadable');
  } finally { await loading?.destroy(); }
}
function workerDecode(buffer, fileNumber, limits, deadline) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(__filename, { workerData: { buffer, fileNumber, limits }, resourceLimits: { maxOldGenerationSizeMb: 256 } });
    const timer = setTimeout(() => { worker.terminate(); reject(Object.assign(Error('receipt_provider_timeout'), {status:503})); }, Math.max(1, deadline-Date.now()));
    worker.once('message', result => { clearTimeout(timer); if(result.error) reject(Object.assign(Error(result.error),{status:422})); else resolve(result.sources.map(s => ({ ...s, ...(s.image ? { image: Buffer.from(s.image) } : {}) }))); });
    worker.once('error', () => { clearTimeout(timer); reject(Error('receipt_file_unreadable')); });
    worker.once('exit', code => { if(code) {clearTimeout(timer);reject(Error('receipt_file_unreadable'));} });
  });
}
async function prepareSources(buffers, {limits = receiptLimits(), deadline = Date.now()+limits.durationMs, onProgress = async()=>{}} = {}) {
  validateFiles(buffers, limits);
  const sources = [];
  for (let i=0; i<buffers.length; i++) {
    sources.push(...await workerDecode(buffers[i], i+1, limits, deadline));
    if (sources.filter(s => s.page_number).length > limits.pdfPages || sources.length > limits.sources) fail('receipt_pdf_pages');
    if (sources.reduce((n,s) => n+(s.image?.length ?? Buffer.byteLength(s.text)),0) > limits.totalBytes) fail('receipt_photo_size',413);
    await onProgress({ stage: 'preparing', completed: i+1, total: buffers.length });
  }
  return sources.map((s,i) => ({ ...s, source_number: i+1 }));
}
if (!isMainThread) decodeFile(Buffer.from(workerData.buffer), workerData.fileNumber, workerData.limits)
  .then(sources => parentPort.postMessage({sources})).catch(e => parentPort.postMessage({error:e.message}));
module.exports = { fileType, validateFiles, prepareSources, decodeFile };
