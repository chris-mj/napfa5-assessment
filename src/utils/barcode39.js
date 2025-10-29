// Simple Code39 barcode drawer for uppercase A-Z, 0-9 and - . space $ / + %
export function drawCode39(canvas, text, opts = {}) {
  const ctx = canvas.getContext('2d');
  let module = opts.module || 2; // bar width in px per narrow bar
  let height = opts.height || 40; // output height in px (for canvas drawing)
  const quietModules = opts.quietModules || 10; // quiet zone in modules
  const gap = module; // inter-character gap
  const map = {
    '0':'101001101101','1':'110100101011','2':'101100101011','3':'110110010101','4':'101001101011','5':'110100110101','6':'101100110101','7':'101001011011','8':'110100101101','9':'101100101101',
    'A':'110101001011','B':'101101001011','C':'110110100101','D':'101011001011','E':'110101100101','F':'101101100101','G':'101010011011','H':'110101001101','I':'101101001101','J':'101011001101',
    'K':'110101010011','L':'101101010011','M':'110110101001','N':'101011010011','O':'110101101001','P':'101101101001','Q':'101010110011','R':'110101011001','S':'101101011001','T':'101011011001',
    'U':'110010101011','V':'100110101011','W':'110011010101','X':'100101101011','Y':'110010110101','Z':'100110110101','-':'100101011011','.':'110010101101',' ':'100110101101','$':'100100100101','/':'100100101001','+':'100101001001','%':'101001001001','*':'100101101101'
  };
  const input = `*${String(text).toUpperCase()}*`;
  const pattern = [];
  for (let i=0;i<input.length;i++) {
    const ch = input[i];
    const seq = map[ch];
    if (!seq) continue;
    for (let j=0;j<seq.length;j++) pattern.push(seq[j]);
    if (i < input.length-1) pattern.push('0'.repeat(7)); // inter-character gap as narrow space
  }
  const totalModules = pattern.reduce((acc, seg)=> acc + seg.length, 0);
  if (opts.targetWidthPx) {
    // Compute module size to fit desired pixel width including quiet zones
    module = Math.max(1, Math.floor(opts.targetWidthPx / (totalModules + 2 * quietModules)));
  }
  if (opts.targetHeightPx) {
    height = opts.targetHeightPx;
  }
  const quiet = module * quietModules;
  const width = quiet + totalModules * module + quiet;
  canvas.width = width; canvas.height = height;
  ctx.fillStyle = '#fff'; ctx.fillRect(0,0,width,height);
  ctx.fillStyle = '#000';
  let x = quiet;
  for (let i=0;i<pattern.length;i++) {
    const seg = pattern[i];
    for (let k=0;k<seg.length;k++) {
      if (seg[k] === '1') ctx.fillRect(x, 0, module, height);
      x += module;
    }
  }
}

