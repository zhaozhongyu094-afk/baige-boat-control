"use strict";
const dialHub = new Image();
dialHub.src = "pivot.webp";
const dialValues = [0, 0];
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
  const scale = Math.min(width / 312, height / 205);
  c.translate((width - 312 * scale) / 2, (height - 205 * scale) / 2);
  c.scale(scale, scale);
  const cx = 156,
    cy = 144,
    r = 115,
    end = (p) => ((162 + (p + 100) * 1.08) * Math.PI) / 180;
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
    zero = end(0),
    current = end(value);
  const chrome = c.createLinearGradient(42, 22, 249, 181);
  chrome.addColorStop(0, "#7893b1");
  chrome.addColorStop(0.32, "#eef7ff");
  chrome.addColorStop(0.55, "#839fbf");
  chrome.addColorStop(0.78, "#dce9f7");
  chrome.addColorStop(1, "#637e9f");
  strokeArc(r, lo, hi, chrome, 2.3);
  strokeArc(r - 7, lo, hi, "#294762", 11);
  if (value) {
    const active = c.createLinearGradient(47, 46, 266, 138);
    active.addColorStop(0, "#3d78c3");
    active.addColorStop(0.55, "#3387e8");
    active.addColorStop(1, "#79b8ff");
    strokeArc(
      r - 7,
      Math.min(current, zero),
      Math.max(current, zero),
      active,
      11,
    );
  }
  for (let p = -100; p <= 100; p += 2.5) {
    const major = p % 25 === 0,
      medium = p % 5 === 0,
      a = end(p);
    c.beginPath();
    c.moveTo(...pt(a, r - 0.4));
    c.lineTo(...pt(a, r - (major ? 16 : medium ? 8 : 4)));
    c.strokeStyle = major ? "#f3f7ff" : medium ? "#bccee3" : "#647e9e";
    c.lineWidth = major ? 2.6 : medium ? 1.25 : 0.75;
    c.stroke();
    if (major) {
      const [x, y] = pt(a, r + 14);
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillStyle = p === 0 ? "#fff" : "#d8e6f8";
      c.font = "600 13.5px Roboto,Arial,sans-serif";
      c.fillText(
        p > 0 ? "+" + p : String(p),
        x,
        Math.abs(p) === 100 ? y + 8 : y,
      );
    }
  }
  const [tx, ty] = pt(current, r - 12),
    [bx, by] = pt(current, -15),
    dx = -Math.sin(current) * 5.4,
    dy = Math.cos(current) * 5.4;
  c.shadowColor = "#000b";
  c.shadowBlur = 3;
  c.shadowOffsetY = 2;
  c.beginPath();
  c.moveTo(bx, by);
  c.lineTo(cx + dx, cy + dy);
  c.lineTo(tx, ty);
  c.lineTo(cx - dx, cy - dy);
  c.closePath();
  c.fillStyle = "#a8c1da";
  c.fill();
  c.shadowBlur = 0;
  c.shadowOffsetY = 0;
  c.beginPath();
  c.moveTo(bx, by);
  c.lineTo(cx + dx, cy + dy);
  c.lineTo(tx, ty);
  c.closePath();
  c.fillStyle = "#f6fbff";
  c.fill();
  if (dialHub.complete && dialHub.naturalWidth)
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
