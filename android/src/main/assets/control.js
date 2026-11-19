"use strict";
const el = (id) => document.getElementById(id);
const native = window.BoatRadio;
const shade = el("shade");
const mainPanel = document.querySelector("main");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
let stateName = "closed";
let session = 0,
  link = false,
  ready = false,
  seq = 0,
  lastAck = 0,
  openedAt = 0,
  device = "",
  pointer = null;
let x = 0,
  y = 0,
  readAck,
  sent = new Map();
const keys = new Set();
function label(s, live = false) {
  el("status").textContent = s;
  el("status").parentElement.classList.toggle("live", live);
  el("modeIcon").src = live ? "icons/bluetooth.svg" : "icons/monitor.svg";
  el("menuDisc").title = s;
}
function draw(rawX, rawY) {
  x = rawX;
  y = rawY;
  el("stick").style.left = 50 + x * 0.39 + "%";
  el("stick").style.top = 50 - y * 0.39 + "%";
  const motors = BoatWire.motors(x, y);
  ["l", "r"].forEach((id, i) => {
    const n =
      Math.round((Math.abs(motors[i]) * 100) / 32) * Math.sign(motors[i]);
    el(id + "v").innerHTML = (n > 0 ? "+" : "") + n + "<small>%</small>";
    paintDial(i, n);
  });
}
function reset() {
  pointer = null;
  keys.clear();
  draw(0, 0);
}
function transmit() {
  if (!link) return;
  if (!ready && performance.now() - openedAt > 1800)
    el("hint").textContent =
      "尚无船端回执，请确认已烧录摇杆固件，模块串口为 9600。";
  if (ready && performance.now() - lastAck > 350) {
    reset();
    ready = false;
    sent.clear();
    label("等待船端回执");
  }
  const a = ready ? x : 0,
    b = ready ? y : 0;
  const bytes = BoatWire.command(seq, a, b);
  sent.set(seq, { time: performance.now(), neutral: a === 0 && b === 0 });
  native.send(
    session,
    bytes.map((v) => v.toString(16).padStart(2, "0")).join(""),
  );
  seq = (seq + 1) & 127;
}
function stop() {
  reset();
  transmit();
}
window.boatLink = (state, detail, token) => {
  if (token < session) return;
  stateName = state;
  closePicker(false);
  session = token;
  link = state === "open";
  openedAt = performance.now();
  ready = false;
  reset();
  sent.clear();
  device = detail;
  el("connectLabel").textContent = state === "closed" ? "连接设备" : "断开";
  el("hint").textContent =
    state === "closed" && detail && detail !== "未连接" ? detail : "松手回中";
  label(state === "closed" ? "离线模拟" : link ? "等待船端回执" : detail);
  readAck = BoatWire.ackReader((s, armed) => {
    const cmd = sent.get(s);
    if (!cmd || performance.now() - cmd.time > 350) return;
    sent.delete(s);
    if (!armed) {
      ready = false;
      reset();
      sent.clear();
      label("等待中位确认");
      return;
    }
    if (!ready && !cmd.neutral) return;
    if (!ready) el("hint").textContent = "松手回中";
    ready = true;
    lastAck = performance.now();
    label(device + " · 就绪", true);
  });
  transmit();
};
window.boatRx = (token, hex) => {
  if (token === session && link)
    readAck((hex.match(/../g) || []).map((v) => parseInt(v, 16)));
};
const pad = el("pad");
function permitted() {
  return (
    !pickerIsOpen() &&
    (stateName === "closed" ||
      (link && ready && performance.now() - lastAck <= 350))
  );
}
function move(e) {
  const r = pad.getBoundingClientRect();
  let a = (e.clientX - r.left - r.width / 2) / (r.width * 0.39),
    b = (r.top + r.height / 2 - e.clientY) / (r.height * 0.39);
  const length = Math.hypot(a, b);
  if (length < 0.08) {
    draw(0, 0);
    return;
  }
  const gain = (Math.min(1, length) - 0.08) / (0.92 * length);
  draw(Math.round(a * gain * 100), Math.round(b * gain * 100));
}
pad.onpointerdown = (e) => {
  if (
    pointer !== null ||
    !permitted() ||
    (e.pointerType === "mouse" && e.button !== 0)
  )
    return;
  keys.clear();
  pointer = e.pointerId;
  pad.setPointerCapture(pointer);
  move(e);
  transmit();
};
pad.onpointermove = (e) => {
  if (e.pointerId === pointer && permitted()) move(e);
};
for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
  pad.addEventListener(type, (e) => {
    if (e.pointerId === pointer) stop();
  });
function keyMove() {
  const a = Number(keys.has("ArrowRight")) - Number(keys.has("ArrowLeft"));
  const b = Number(keys.has("ArrowUp")) - Number(keys.has("ArrowDown"));
  const scale = Math.max(1, Math.hypot(a, b));
  draw(Math.round((100 * a) / scale), Math.round((100 * b) / scale));
  transmit();
}
pad.onkeydown = (e) => {
  if (e.key.startsWith("Arrow")) {
    e.preventDefault();
    if (permitted() && pointer === null && !e.repeat) {
      keys.add(e.key);
      keyMove();
    }
  }
};
pad.onkeyup = (e) => {
  if (keys.delete(e.key)) {
    e.preventDefault();
    keyMove();
  }
};
pad.onblur = () => {
  if (keys.size) stop();
};
window.addEventListener("blur", stop);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stop();
});
el("stop").onclick = stop;

function pickerIsOpen() {
  return shade.getAttribute("aria-hidden") === "false";
}
function setPickerOpen(open) {
  mainPanel.toggleAttribute("inert", open);
  header.toggleAttribute("inert", open);
  shade.toggleAttribute("inert", !open);
  shade.setAttribute("aria-hidden", String(!open));
  document.body.classList.toggle("picking", open);
}
function closePicker(focus = true) {
  if (!pickerIsOpen()) return;
  setPickerOpen(false);
  if (focus) (fullscreenActive ? el("menuDisc") : el("connect")).focus();
}
window.boatDevices = (items, message) => {
  if (!pickerIsOpen()) return;
  const list = el("devices");
  list.replaceChildren();
  if (!items.length) {
    const note = document.createElement("p");
    note.className = "empty";
    note.textContent = message || "没有已配对的 JDY-31-SPP。";
    list.appendChild(note);
  }
  for (const [name, address] of items) {
    const row = document.createElement("button");
    row.className = "device";
    const icon = new Image();
    icon.src = "icons/plugs.svg";
    icon.alt = "";
    const body = document.createElement("span"),
      title = document.createElement("b"),
      sub = document.createElement("small"),
      action = document.createElement("em");
    title.textContent = name;
    sub.textContent = address;
    action.textContent = "连接";
    body.append(title, sub);
    row.append(icon, body, action);
    row.onclick = () => {
      stop();
      stateName = "connecting";
      closePicker();
      label("正在连接");
      native.connectTo(address);
    };
    list.appendChild(row);
  }
};
function loadPaired() {
  if (native) {
    window.boatDevices([], "正在读取已配对设备…");
    native.listDevices(true);
  } else
    window.boatDevices(
      [],
      "电脑预览可直接模拟。请在安卓应用中选择已配对的船模。",
    );
}
el("connect").onclick = () => {
  stop();
  setToolsOpen(false);
  if (stateName !== "closed" && native) {
    native.disconnectBoat();
    return;
  }
  setPickerOpen(true);
  el("settings").hidden = !native;
  el("again").hidden = !native;
  el("closePicker").focus();
  loadPaired();
};
el("again").onclick = loadPaired;
el("settings").onclick = () => {
  if (native) native.settings();
};
el("shade").onclick = (e) => {
  if (e.target === el("shade")) closePicker();
};
el("closePicker").onclick = () => closePicker();
el("simulate").onclick = () => closePicker();
const header = document.querySelector("header");
const toolbar = header.querySelector(".toolbar");
const toolsPanel = el("glassTools");
const menuButton = el("menuDisc");
const connectButton = el("connect");
const expandButton = el("expand");
const orientation = window.matchMedia("(orientation: landscape)");
let fullscreenActive = false;
let modeChangedAt = -Infinity;

// Replay the reveal once in the final orientation if Android rotates after the mode callback.
function revealLayout() {
  if (reducedMotion.matches || !mainPanel.animate) return;
  const entering = fullscreenActive ? 1 : -1;
  const reveal = (element, from, duration) => {
    for (const old of element.getAnimations()) {
      if (old.id === "mode-reveal") old.cancel();
    }
    element.animate(
      [
        { opacity: 0.58, transform: from },
        { opacity: 1, transform: "none" },
      ],
      { id: "mode-reveal", duration, easing: "cubic-bezier(.2,.78,.24,1)" },
    );
  };
  reveal(
    mainPanel.querySelector(".gauges"),
    "translateX(" + -9 * entering + "px)",
    250,
  );
  reveal(
    mainPanel.querySelector(".steering"),
    "scale(" + (entering > 0 ? ".94" : "1.035") + ")",
    300,
  );
  reveal(header, "translateY(-5px)", 220);
}

function refreshOrientation() {
  const rotated =
    document.body.classList.contains("land") !== orientation.matches;
  document.body.classList.toggle("land", orientation.matches);
  document.body.classList.toggle("portrait", !orientation.matches);
  fitWheel();
  if (rotated && performance.now() - modeChangedAt < 1000) {
    modeChangedAt = -Infinity;
    revealLayout();
  }
}
function setToolsOpen(open) {
  const visible = fullscreenActive && open;
  toolsPanel.hidden = !fullscreenActive;
  toolsPanel.setAttribute("aria-hidden", String(!visible));
  toolsPanel.toggleAttribute("inert", !visible);
  // Older WebViews do not implement inert. Keep closed tools out of keyboard navigation.
  for (const button of [connectButton, expandButton]) {
    if (fullscreenActive && !visible) button.tabIndex = -1;
    else button.removeAttribute("tabindex");
  }
  menuButton.setAttribute("aria-expanded", String(visible));
  menuButton.setAttribute(
    "aria-label",
    visible ? "收起全屏工具" : "展开全屏工具",
  );
}
function toolsAreOpen() {
  return menuButton.getAttribute("aria-expanded") === "true";
}
menuButton.addEventListener("click", () => setToolsOpen(!toolsAreOpen()));
document.addEventListener("pointerdown", (event) => {
  if (toolsAreOpen() && !header.contains(event.target)) setToolsOpen(false);
});
window.boatBack = () => {
  if (pickerIsOpen()) {
    closePicker();
    return true;
  }
  if (toolsAreOpen()) {
    setToolsOpen(false);
    menuButton.focus();
    return true;
  }
  return false;
};
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && window.boatBack()) e.preventDefault();
});
window.boatFullscreen = (enabled) => {
  enabled = Boolean(enabled);
  const changed = fullscreenActive !== enabled;
  if (changed) {
    stop();
    fullscreenActive = enabled;
    document.body.classList.toggle("regular", !enabled);
    document.body.classList.toggle("full", enabled);
    if (enabled) {
      toolsPanel.prepend(connectButton);
      toolsPanel.appendChild(expandButton);
    } else {
      toolbar.appendChild(connectButton);
      header.insertBefore(expandButton, toolsPanel);
    }
    setToolsOpen(false);
  }
  const label = enabled ? "退出全屏" : "进入全屏";
  expandButton.setAttribute("aria-label", label);
  expandButton.title = label;
  el("expandIcon").src = enabled
    ? "icons/corners-in.svg"
    : "icons/corners-out.svg";
  refreshOrientation();
  if (changed) {
    modeChangedAt = performance.now();
    revealLayout();
  }
};
function fitWheel() {
  const area = el("pad").parentElement;
  const portrait = window.matchMedia("(orientation: portrait)").matches;
  const width = Math.max(
    0,
    Math.min(area.clientWidth * (portrait ? 0.85 : 1), area.clientHeight),
  );
  el("pad").style.width = width + "px";
}
if (window.ResizeObserver)
  new ResizeObserver(fitWheel).observe(pad.parentElement);
window.addEventListener("resize", refreshOrientation);
orientation.addListener(refreshOrientation);
el("expand").onclick = async () => {
  stop();
  if (native) {
    native.fullscreen(!fullscreenActive);
    return;
  }
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch (e) {
    el("hint").textContent = "当前窗口无法进入全屏";
  }
};
document.addEventListener("fullscreenchange", () =>
  window.boatFullscreen(Boolean(document.fullscreenElement)),
);
window.boatSuspend = () => {
  stop();
  setToolsOpen(false);
};
window.boatLink("closed", "未连接", 0);
refreshOrientation();
draw(0, 0);
setInterval(transmit, 50);
