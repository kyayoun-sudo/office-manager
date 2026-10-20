// Bright and pale yellow inputs used by the firm's templates; grey/blue calculations are excluded.
export function yellowInput(cell) {
  if(cell.fill?.type!=='pattern' || cell.fill.pattern!=='solid')return false;
  const rgb=String(cell.fill.fgColor?.argb||'').slice(-6);
  if(!/^[a-f0-9]{6}$/i.test(rgb))return false;
  const [r,g,b]=[0,2,4].map(i=>parseInt(rgb.slice(i,i+2),16));
  return r>=240 && g>=220 && b<=220 && r>=g && g>b+15;
}
