"use strict";
const dialValues = [0, 0];
const dialColors = {
  silver: { rim: "#c6d0da", active: "#285779", major: "#687e94", minor: "#a3b3c2",
    text: "#486784", needle: "#172f4b", bevel: "#477197", shadow: "#29437055" },
  navy: { rim: "#5c6976", active: "#87b5d9", major: "#bac9d5", minor: "#8495a4",
    text: "#c3d2de", needle: "#6397bf", bevel: "#c1dff2", shadow: "#07121a88" },
};
const dials = ["leftDial", "rightDial"].map((id) =>
  document.getElementById(id),
);
function paintDial(index, value) {
  dialValues[index] = value;
  const canvas = dials[index],
    box = canvas.getBoundingClientRect(),
    ratio = window.devicePixelRatio || 1;
  if (!box.width || !box.height) return;
  const width = Math.round(box.width * ratio),
    height = Math.round(box.height * ratio);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const c = canvas.getContext("2d");
  c.clearRect(0, 0, width, height);
  c.save();
  const colors = dialColors[document.body.dataset.skin] || dialColors.silver;
  const viewWidth = 270, viewHeight = 160;
  const scale = Math.min(width / viewWidth, height / viewHeight);
  c.translate((width - viewWidth * scale) / 2 - 21 * scale,
    (height - viewHeight * scale) / 2);
  c.scale(scale, scale);
  const cx = 156,
    cy = 134,
    r = 102,
    end = (p) => ((270 + p * .9) * Math.PI) / 180;
  const pt = (a, d) => [cx + Math.cos(a) * d, cy + Math.sin(a) * d];
  const strokeArc = (radius, a, b, color, weight) => {
    c.beginPath();
    c.arc(cx, cy, radius, a, b);
    c.strokeStyle = color;
    c.lineWidth = weight;
    c.stroke();
  };
  const lo = end(-100),
    hi = end(100),
    current = end(value);
  strokeArc(r, lo, hi, colors.rim, 1.4);
  for (let band = 0; band < 4; band++) {
    const inner = band * 25 + (band === 0 ? 0 : 0.95);
    const outer = (band + 1) * 25 - (band === 3 ? 0 : 0.95);
    const filled = Math.min(outer, Math.abs(value));
    if (filled <= inner) break;
    const start = end(Math.sign(value) * inner), tip = end(Math.sign(value) * filled);
    strokeArc(r + 1, Math.min(start, tip), Math.max(start, tip), colors.active, 3.5);
  }
  for (let p = -100; p <= 100; p += 5) {
    const major = p % 25 === 0,
      a = end(p);
    c.beginPath();
    c.moveTo(...pt(a, r - 0.4));
    c.lineTo(...pt(a, r - (major ? 12 : 8)));
    c.strokeStyle = major ? colors.major : colors.minor;
    c.lineWidth = major ? 2 : 1.25;
    c.stroke();
    if (p % 100 === 0) {
      const [x, y] = pt(a, p !== 0 ? r : r + 14);
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillStyle = colors.text;
      const fontSize = Math.max(15, Math.min(23, 9.5 * ratio / scale));
      c.font = "550 " + fontSize + "px Roboto,Arial,sans-serif";
      c.fillText(
        p > 0 ? "+" + p : String(p),
        x,
        Math.abs(p) === 100 ? y + 14 : y,
      );
    }
  }
  const [tx, ty] = pt(current, r - 12),
    [bx, by] = pt(current, -15),
    dx = -Math.sin(current) * 3.1,
    dy = Math.cos(current) * 3.1;
  c.shadowColor = colors.shadow;
  c.shadowBlur = 3;
  c.shadowOffsetY = 2;
  c.beginPath();
  c.moveTo(bx, by);
  c.lineTo(cx + dx, cy + dy);
  c.lineTo(tx, ty);
  c.lineTo(cx - dx, cy - dy);
  c.closePath();
  c.fillStyle = colors.needle;
  c.fill();
  c.shadowBlur = 0;
  c.shadowOffsetY = 0;
  c.beginPath();
  c.moveTo(bx, by);
  c.lineTo(cx + dx, cy + dy);
  c.lineTo(tx, ty);
  c.closePath();
  c.fillStyle = colors.bevel;
  c.fill();
  const hub = c.createLinearGradient(cx-6,cy-6,cx+6,cy+6);
  hub.addColorStop(0,"#9eabb8"); hub.addColorStop(.38,"#f4f6f8"); hub.addColorStop(1,"#8996a4");
  c.beginPath(); c.arc(cx,cy,7,0,Math.PI*2); c.fillStyle=hub; c.fill();
  c.strokeStyle="#8c9ba9"; c.lineWidth=1; c.stroke();
  c.restore();
}
function redrawDials() {
  dials.forEach((canvas, i) => paintDial(i, dialValues[i]));
}
window.addEventListener("resize", redrawDials);
if (window.ResizeObserver) {
  const resize = new ResizeObserver(redrawDials);
  for (const canvas of dials) resize.observe(canvas);
}
