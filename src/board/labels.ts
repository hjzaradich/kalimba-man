// Draws a tine label the way it is printed on the instrument: a digit, an
// optional small sharp or flat at its shoulder, and octave dots above or
// below. Shared by the board and the falling notes.

export function drawTineLabel(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  label: string,
  octaveDots: number,
  fontSize: number,
  color: string,
) {
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `600 ${fontSize}px system-ui, sans-serif`;

  const digit = label[0] ?? "";
  const accidental = label.slice(1);
  ctx.fillText(digit, cx, cy);
  if (accidental) {
    ctx.font = `600 ${fontSize * 0.6}px system-ui, sans-serif`;
    ctx.fillText(accidental === "#" ? "♯" : "♭", cx + fontSize * 0.55, cy - fontSize * 0.3);
  }

  const dotR = Math.max(1.2, fontSize * 0.1);
  const dotGap = dotR * 3;
  const count = Math.abs(octaveDots);
  const dir = octaveDots > 0 ? -1 : 1;
  for (let i = 0; i < count; i++) {
    const dy = dir * (fontSize * 0.75 + i * dotGap);
    ctx.beginPath();
    ctx.arc(cx, cy + dy, dotR, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Font size for labels in a lane of the given width. */
export function labelFontSize(laneWidth: number): number {
  return Math.max(9, Math.min(18, laneWidth * 0.62));
}
