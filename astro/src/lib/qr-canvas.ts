import QRCodeGenerator from 'qrcode-generator';

/** 用 qrcode-generator 在 canvas 上绘制二维码（纯浏览器实现，无 Node API） */
export function drawQrToCanvas(canvas: HTMLCanvasElement, text: string, size = 200): void {
  const qr = QRCodeGenerator(0, 'M');
  qr.addData(text);
  qr.make();
  const moduleCount = qr.getModuleCount();
  const cellSize = Math.floor(size / (moduleCount + 2));
  const margin = Math.floor((size - cellSize * moduleCount) / 2);
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#000000';
  for (let row = 0; row < moduleCount; row++) {
    for (let col = 0; col < moduleCount; col++) {
      if (qr.isDark(row, col)) {
        ctx.fillRect(margin + col * cellSize, margin + row * cellSize, cellSize, cellSize);
      }
    }
  }
}
