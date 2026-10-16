// Aggregate bytes are bounded while streaming multipart data, before buffering
// all files. Multer still owns per-file limits, field limits and parser errors.
function receiptStorage(maxBytes) {
  const totals=new WeakMap();
  return {
    _handleFile(req,file,callback) {
      const chunks=[];let size=0,failed=false;
      file.stream.on('data',chunk=>{
        if(failed)return;
        const total=(totals.get(req)??0)+chunk.length;totals.set(req,total);
        if(total>maxBytes){failed=true;chunks.length=0;callback(Object.assign(Error('receipt_photo_size'),{code:'LIMIT_FILE_SIZE'}));return;}
        chunks.push(chunk);size+=chunk.length;
      });
      file.stream.once('error',error=>{if(!failed){failed=true;callback(error);}});
      file.stream.once('end',()=>{if(!failed)callback(null,{buffer:Buffer.concat(chunks),size});});
    },
    _removeFile(req,file,callback){delete file.buffer;callback(null);},
  };
}
module.exports={receiptStorage};
