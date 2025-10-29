import QRCode from 'qrcode';

export function drawQr(canvas, text, size = 128, ecc = 'M', margin = 1) {
  // Returns a Promise that resolves when the canvas is drawn
  return new Promise((resolve, reject) => {
    QRCode.toCanvas(canvas, String(text ?? ''), {
      errorCorrectionLevel: ecc,
      width: size,
      margin
    }, (err) => {
      if (err) reject(err); else resolve();
    });
  });
}

export async function drawQrDataUrl(text, size = 256, ecc = 'M', margin = 1) {
  return QRCode.toDataURL(String(text ?? ''), {
    errorCorrectionLevel: ecc,
    width: size,
    margin
  });
}

