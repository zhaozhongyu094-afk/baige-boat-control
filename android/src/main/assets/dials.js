"use strict";
const dialHub = new Image();
dialHub.src = "pivot.webp";
const dialValues = [0, 0];
// Each quarter of the signed PWM scale has its own engraved segment.
const throttleBands = [
  { track: "#314a63", lit: "#578ac1" },
  { track: "#354f67", lit: "#72a9dc" },
  { track: "#39546d", lit: "#9ccbef" },
  { track: "#405b73", lit: "#d0e8f7" },
];
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
  const silver = document.body.dataset.skin === "silver";
  const viewWidth = silver ? 270 : 312, viewHeight = silver ? 160 : 205;
  const scale = Math.min(width / viewWidth, height / viewHeight);
  c.translate((width - viewWidth * scale) / 2 - (silver ? 21 * scale : 0),
    (height - viewHeight * scale) / 2);
  c.scale(scale, scale);
  const cx = 156,
    cy = silver ? 134 : 144,
    r = silver ? 102 : 115,
    end = (p) => ((270 + p * (silver ? .9 : 1.08)) * Math.PI) / 180;
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
  const chrome = c.createLinearGradient(42, 22, 249, 181);
  chrome.addColorStop(0, "#7893b1");
  chrome.addColorStop(0.32, "#eef7ff");
  chrome.addColorStop(0.55, "#839fbf");
  chrome.addColorStop(0.78, "#dce9f7");
  chrome.addColorStop(1, "#637e9f");
  strokeArc(r, lo, hi, silver ? "#c6d0da" : chrome, silver ? 1.4 : 2.3);
  throttleBands.forEach(({ track, lit }, i) => {
    const inner = i * 25 + (i === 0 ? 0 : 0.95);
    const outer = (i + 1) * 25 - (i === throttleBands.length - 1 ? 0 : 0.95);
    for (const sign of [-1, 1]) {
      const a = end(sign * inner),
        b = end(sign * outer);
      if (!silver) strokeArc(r - 7, Math.min(a, b), Math.max(a, b), track, 11);
      const filled = Math.min(outer, sign * value);
      if (filled > inner) {
        const tip = end(sign * filled);
        strokeArc(silver ? r + 1 : r - 7, Math.min(a, tip), Math.max(a, tip), silver ? "#285779" : lit, silver ? 3.5 : 11);
      }
    }
  });
  for (let p = -100; p <= 100; p += silver ? 5 : 2.5) {
    const major = p % 25 === 0,
      medium = p % 5 === 0,
      a = end(p);
    c.beginPath();
    c.moveTo(...pt(a, r - 0.4));
    c.lineTo(...pt(a, r - (major ? (silver ? 12 : 16) : medium ? 8 : 4)));
    c.strokeStyle = silver ? (major ? "#687e94" : "#a3b3c2") : major ? "#f3f7ff" : medium ? "#bccee3" : "#647e9e";
    c.lineWidth = major ? (silver ? 2 : 2.6) : medium ? 1.25 : 0.75;
    c.stroke();
    if (major && (!silver || p % 100 === 0)) {
      const [x, y] = pt(a, silver && p !== 0 ? r : r + 14);
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillStyle = silver ? "#486784" : p === 0 ? "#fff" : "#d8e6f8";
      const fontSize = silver ? Math.max(15, Math.min(23, 9.5 * ratio / scale)) : 13.5;
      c.font = "550 " + fontSize + "px Roboto,Arial,sans-serif";
      c.fillText(
        p > 0 ? "+" + p : String(p),
        x,
        Math.abs(p) === 100 ? y + (silver ? 14 : 8) : y,
      );
    }
  }
  const [tx, ty] = pt(current, r - 12),
    [bx, by] = pt(current, -15),
    dx = -Math.sin(current) * (silver ? 3.1 : 5.4),
    dy = Math.cos(current) * (silver ? 3.1 : 5.4);
  c.shadowColor = silver ? "#29437055" : "#000b";
  c.shadowBlur = 3;
  c.shadowOffsetY = 2;
  c.beginPath();
  c.moveTo(bx, by);
  c.lineTo(cx + dx, cy + dy);
  c.lineTo(tx, ty);
  c.lineTo(cx - dx, cy - dy);
  c.closePath();
  c.fillStyle = silver ? "#172f4b" : "#a8c1da";
  c.fill();
  c.shadowBlur = 0;
  c.shadowOffsetY = 0;
  c.beginPath();
  c.moveTo(bx, by);
  c.lineTo(cx + dx, cy + dy);
  c.lineTo(tx, ty);
  c.closePath();
  c.fillStyle = silver ? "#477197" : "#f6fbff";
  c.fill();
  if (silver) {
    const hub = c.createLinearGradient(cx-6,cy-6,cx+6,cy+6);
    hub.addColorStop(0,"#9eabb8"); hub.addColorStop(.38,"#f4f6f8"); hub.addColorStop(1,"#8996a4");
    c.beginPath(); c.arc(cx,cy,7,0,Math.PI*2); c.fillStyle=hub; c.fill();
    c.strokeStyle="#8c9ba9"; c.lineWidth=1; c.stroke();
  } else if (dialHub.complete && dialHub.naturalWidth)
    c.drawImage(dialHub, cx - 12.5, cy - 12.5, 25, 25);
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
dialHub.onload = redrawDials;
