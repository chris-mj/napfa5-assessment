import JsBarcode from 'jsbarcode';

export function drawBarcode(canvas, text, opts = {}) {
  const {
    format = 'CODE128',
    width = 2,          // module width in px
    height = 100,       // barcode height in px
    margin = 12,        // quiet zone in px
    displayValue = false,
    background = '#ffffff',
    lineColor = '#000000',
    textMargin = 2,
    fontOptions = '',
    font = 'monospace',
    fontSize = 14,
  } = opts;
  JsBarcode(canvas, String(text ?? ''), {
    format,
    width,
    height,
    margin,
    displayValue,
    background,
    lineColor,
    textMargin,
    fontOptions,
    font,
    fontSize,
    flat: true,
  });
}

