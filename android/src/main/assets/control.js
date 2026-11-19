"use strict";
const el = (id) => document.getElementById(id);
const native = window.BoatRadio;
const shade = el("shade");
const mainPanel = document.querySelector("main");
function preference(key, fallback) {
  try { return localStorage.getItem("boat." + key) || fallback; } catch { return fallback; }
}
function savePreference(key, value) {
  try { localStorage.setItem("boat." + key, value); } catch { /* Private preview. */ }
}
let skin = preference("skin", "silver") === "navy" ? "navy" : "silver";
let wire = preference("wire", "pwm") === "legacy" ? "legacy" : "pwm";
let pulsed = preference("pulse", "off") === "on";
let pulseHz = BoatLegacy.frequency(preference("pulseHz", "8"));
let legacy = null, interrupted = false, stopNotice = 0, sendTimer = 0;
let disconnectReason = "";
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
function label(s, live = false, note = "") {
  const simulation = stateName === "closed" && !interrupted;
  const connection = link ? "蓝牙已连接" : stateName === "connecting" ? "蓝牙连接中" :
    interrupted ? "蓝牙已断开" : "蓝牙未连接";
  const noteText = note || (interrupted ? "指令已归零" : "");
  if (el("status").textContent === s && el("controlNote").textContent === noteText &&
      el("linkTag").textContent === connection && el("connect").dataset.live === String(live)) return;
  el("status").textContent = s;
  el("modeTag").textContent = simulation ? "模拟模式" : "真机模式";
  el("linkTag").textContent = connection;
  el("controlNote").textContent = noteText;
  el("linkTag").dataset.connection = stateName;
  el("linkTag").title = s;
  el("status").parentElement.classList.toggle("live", live);
  el("modeIcon").src = live ? "icons/bluetooth.svg" : "icons/monitor.svg";
  el("menuDisc").title = s;
  el("connect").dataset.live = String(live);
  el("connect").setAttribute("aria-label", stateName === "closed" ? "连接设备" : "断开设备");
  el("connect").title = s;
}
// Both skins have the same 31%-diameter thumb and usable travel.
const thumbTravel = .34;
function draw(rawX, rawY) {
  x = rawX;
  y = rawY;
  if ((x || y) && stopNotice) {
    clearTimeout(stopNotice);
    stopNotice = 0;
    el("stopLabel").textContent = "立即停桨";
  }
  const stick = el("stick");
  stick.style.left = 50 + x * thumbTravel + "%";
  stick.style.top = 50 - y * thumbTravel + "%";
  stick.style.setProperty("--cast-x", (1.5 + x * .022) + "px");
  stick.style.setProperty("--cast-y", (4 + y * .025) + "px");
  const motors = wire === "legacy" ? BoatLegacy.demand(x, y, pulsed).outputs :
    BoatWire.motors(x, y).map(v => Math.sign(v) * Math.round(Math.abs(v) * 100 / 32));
  const length = Math.hypot(x, y);
  const wake = el("wake");
  wake.style.height = (length * thumbTravel) + "%";
  wake.style.transform = "translateX(-50%) rotate(" + Math.atan2(x, y) + "rad)";
  ["l", "r"].forEach((id, i) => {
    const n = motors[i];
    el(i ? "rightDirection" : "leftDirection").textContent = n > 0 ? "前进" : n < 0 ? "反转" : "停止";
    el(id + "v").innerHTML = (n > 0 ? "+" : "") + n + "<small>%</small>";
    paintDial(i, n);
  });
}
function reset() {
  if (x || y) el("pad").classList.add("returning");
  pointer = null;
  keys.clear();
  draw(0, 0);
}
function transmit() {
  if (!link) return;
  if (legacy) {
    legacy.tick(performance.now(), ready ? x : 0, ready ? y : 0, pulsed);
    return;
  }
  if (!ready && performance.now() - openedAt > 1800) {
    el("hint").textContent =
      "尚无船端回执，请检查固件和设置里的控制协议。";
    label("真机 · 未收到船端回执", false, "未收到回执");
  }
  if (ready && performance.now() - lastAck > 350) {
    reset();
    ready = false;
    sent.clear();
    label("真机 · 回执超时，指令已归零", false, "回执超时 · 已归零");
  }
  const a = ready ? x : 0,
    b = ready ? y : 0;
  // The unarmed probe must never contain ASCII '1'–'4' on an older boat.
  const id = ready ? seq : 0;
  const bytes = BoatWire.command(id, a, b);
  sent.set(id, { time: performance.now(), neutral: a === 0 && b === 0 });
  native.send(
    session,
    bytes.map((v) => v.toString(16).padStart(2, "0")).join(""),
  );
  seq = ready ? (seq + 1) & 127 : 1;
}
function stop() {
  reset();
  if (legacy) legacy.halt(performance.now());
  transmit();
}
window.boatLink = (state, detail, token) => {
  if (token < session) return;
  if (state === "closed" && stateName !== "closed") interrupted = true;
  if (state === "connecting") { interrupted = false; disconnectReason = ""; }
  stateName = state;
  closePicker(false);
  session = token;
  link = state === "open";
  clearInterval(sendTimer);
  if (link) sendTimer = setInterval(transmit, wire === "legacy" && pulsed ? BoatLegacy.tickInterval(pulseHz) : 50);
  openedAt = performance.now();
  ready = false;
  legacy = null;
  reset();
  sent.clear();
  device = detail;
  el("connectLabel").textContent = state === "closed" ? "连接设备" : "断开";
  el("hint").textContent =
    state === "closed" && detail && detail !== "未连接" ? detail : "松手回中";
  label(state === "closed" ? (interrupted ? "真机 · 蓝牙已断开，指令已归零" : "模拟模式 · 蓝牙未连接") :
    link ? "真机 · 等待船端回执" : detail, false, link ? "等待回执" : "");
  if (interrupted && state === "closed") el("lastDisconnect").textContent = disconnectReason || detail;
  refreshSettings();
  if (link && wire === "legacy") {
    legacy = BoatLegacy.session(
      digit => native.send(session, "3" + digit),
      () => {
        ready = true;
        label("真机已连接 · " + (pulsed ? "旧版点动 " + pulseHz + " Hz" : "旧版方向"), true);
        el("hint").textContent = "松手回中";
      },
      reason => {
        ready = false;
        disconnectReason = reason;
        reset();
        label(reason + "，指令已归零", false, "指令已归零");
        native.disconnectBoat();
      },
      pulseHz,
    );
    transmit();
    return;
  }
  readAck = BoatWire.ackReader((s, armed) => {
    const cmd = sent.get(s);
    if (!cmd || performance.now() - cmd.time > 350) return;
    sent.delete(s);
    if (!armed) {
      ready = false;
      reset();
      sent.clear();
      label("等待中位确认", false, "等待中位确认");
      return;
    }
    if (!ready && !cmd.neutral) return;
    if (!ready) el("hint").textContent = "松手回中";
    ready = true;
    lastAck = performance.now();
    label("真机已连接 · " + device, true);
  });
  transmit();
};
window.boatRx = (token, hex) => {
  if (token !== session || !link) return;
  const bytes = (hex.match(/../g) || []).map((v) => parseInt(v, 16));
  if (legacy) legacy.receive(bytes, performance.now());
  else readAck(bytes);
};
const pad = el("pad");
function permitted() {
  return (
    !pickerIsOpen() && el("settingsShade").hidden &&
    ((stateName === "closed" && !interrupted) ||
      (link && ready && (legacy || performance.now() - lastAck <= 350)))
  );
}
function move(e) {
  const r = pad.getBoundingClientRect();
  let a = (e.clientX - r.left - r.width / 2) / (r.width * thumbTravel),
    b = (r.top + r.height / 2 - e.clientY) / (r.height * thumbTravel);
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
  pad.classList.remove("returning");
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
      pad.classList.remove("returning");
      keys.add(e.key);
      keyMove();
    }
  }
};
pad.onkeyup = (e) => {
  if (keys.delete(e.key)) {
    e.preventDefault();
    if (keys.size) keyMove();
    else stop();
  }
};
pad.onblur = () => {
  if (keys.size) stop();
};
window.addEventListener("blur", stop);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stop();
});
function stopPressed() {
  stop();
  clearTimeout(stopNotice);
  el("stopLabel").textContent = link ? "已请求停桨" : "指令已归零";
  stopNotice = setTimeout(() => { stopNotice = 0; el("stopLabel").textContent = "立即停桨"; }, 850);
}
el("stop").onpointerdown = stopPressed;
el("stop").onclick = e => { if (e.detail === 0) stopPressed(); };

function pickerIsOpen() {
  return shade.getAttribute("aria-hidden") === "false";
}
function setPickerOpen(open) {
  mainPanel.toggleAttribute("inert", open);
  header.toggleAttribute("inert", open);
  shade.toggleAttribute("inert", !open);
  shade.setAttribute("aria-hidden", String(!open));
  document.body.classList.toggle("picking", open);
  placeStopButton();
}
function closePicker(focus = true) {
  if (!pickerIsOpen()) return;
  setPickerOpen(false);
  if (native) native.closeDevices();
  if (focus) (compactTools() ? el("menuDisc") : el("connect")).focus();
}
window.boatDevices = (items, message, action = "搜索设备", busy = false) => {
  if (!pickerIsOpen()) return;
  const list = el("devices");
  const status = el("searchStatus");
  status.textContent = message || "";
  status.hidden = !message;
  el("searchLabel").textContent = action;
  el("again").disabled = busy;
  list.replaceChildren();
  const pairing = items.some((row) => row[3]);
  for (const [name, address, bonded, pending, leOnly] of items) {
    const row = document.createElement("button");
    row.className = "device";
    const icon = new Image();
    icon.src = "icons/plugs.svg";
    icon.alt = "";
    const body = document.createElement("span"),
      title = document.createElement("b"),
      sub = document.createElement("small"),
      action = document.createElement("em");
    title.textContent = name || "未命名设备";
    sub.textContent = (bonded ? "已配对" : "附近设备") + " · " + address;
    action.textContent = leOnly ? "仅 BLE" : pending ? "配对中…" : bonded ? "连接" : "配对并连接";
    row.disabled = pairing || !!leOnly;
    if (leOnly) row.title = "仅支持低功耗蓝牙，船控连接需要经典蓝牙串口";
    body.append(title, sub);
    row.append(icon, body, action);
    row.onclick = () => {
      stop();
      native.connectTo(address, wire === "legacy");
    };
    list.appendChild(row);
  }
};
function openDevices() {
  if (native) {
    window.boatDevices([], "正在读取已配对设备…");
    native.openDevices();
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
  el("again").hidden = !native;
  el("closePicker").focus();
  openDevices();
};
el("again").onclick = () => {
  if (native) native.searchDevices();
};
el("shade").onclick = (e) => {
  if (e.target === el("shade")) closePicker();
};
el("closePicker").onclick = () => closePicker();
function resumeSimulation() {
  if (stateName !== "closed") return;
  interrupted = false;
  reset();
  label("模拟模式 · 蓝牙未连接");
  el("hint").textContent = "松手回中";
  refreshSettings();
}
el("simulate").onclick = () => { resumeSimulation(); closePicker(); };
const header = document.querySelector("header");
const toolsPanel = el("glassTools");
const menuButton = el("menuDisc");
const connectButton = el("connect");
const expandButton = el("expand");
const orientation = window.matchMedia("(orientation: landscape)");
const brand = header.querySelector(".brand");
const statusChip = el("status").parentElement;
const settingsButton = el("settingsOpen");
let fullscreenActive = false;

function refreshOrientation() {
  const rotated =
    document.body.classList.contains("land") !== orientation.matches;
  document.body.classList.toggle("land", orientation.matches);
  document.body.classList.toggle("portrait", !orientation.matches);
  if (rotated) arrangeTools();
  fitWheel();
}
function compactTools() {
  return orientation.matches;
}
function setToolsOpen(open) {
  const collapsed = compactTools();
  const visible = collapsed && open;
  toolsPanel.hidden = !collapsed;
  toolsPanel.setAttribute("aria-hidden", String(!visible));
  toolsPanel.toggleAttribute("inert", !visible);
  // Older WebViews do not implement inert. Keep closed tools out of keyboard navigation.
  for (const button of [connectButton, expandButton, settingsButton]) {
    if (collapsed && !visible && toolsPanel.contains(button)) button.tabIndex = -1;
    else button.removeAttribute("tabindex");
  }
  menuButton.setAttribute("aria-expanded", String(visible));
  menuButton.setAttribute(
    "aria-label",
    visible ? "收起快捷工具" : "展开快捷工具",
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
  if (!el("settingsShade").hidden) { closeSettings(); return true; }
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
    arrangeTools();
  }
  const label = enabled ? "退出全屏" : "进入全屏";
  expandButton.setAttribute("aria-label", label);
  expandButton.title = label;
  el("expandIcon").src = enabled
    ? "icons/corners-in.svg"
    : "icons/corners-out.svg";
  refreshOrientation();
};
function fitWheel() {
  const area = el("pad").parentElement;
  const portrait = window.matchMedia("(orientation: portrait)").matches;
  const width = Math.max(
    0,
    Math.min(area.clientWidth - (portrait ? 82 : 98), area.clientHeight - 54),
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
function arrangeTools() {
  const info = el("instrumentHead");
  info.append(brand, statusChip);
  if (orientation.matches) {
    toolsPanel.append(connectButton, settingsButton);
  } else {
    header.insertBefore(settingsButton, toolsPanel);
    header.insertBefore(connectButton, toolsPanel);
  }
  header.insertBefore(expandButton, toolsPanel);
  setToolsOpen(false);
}
function refreshSettings() {
  for (const choice of document.querySelectorAll('[name="skin"]')) choice.checked = choice.value === skin;
  for (const choice of document.querySelectorAll('[name="wire"]')) choice.checked = choice.value === wire;
  el("pulse").checked = pulsed;
  el("frequencyRow").hidden = !pulsed;
  el("pulseHz").value = String(pulseHz);
  el("legacyOptions").hidden = wire !== "legacy";
  el("protocolChoices").disabled = stateName !== "closed";
  el("protocolLock").hidden = stateName === "closed";
  el("resumeSim").hidden = !interrupted || stateName !== "closed";
  el("lastDisconnect").hidden = el("resumeSim").hidden;
}
function closeSettings() {
  el("settingsShade").hidden = true;
  placeStopButton();
  header.removeAttribute("inert");
  mainPanel.removeAttribute("inert");
  (compactTools() ? menuButton : settingsButton).focus();
}
function placeStopButton() {
  let parent = document.querySelector(".actions");
  if (!el("settingsShade").hidden) parent = el("settingsPanel").querySelector(".dialogStopSlot");
  else if (pickerIsOpen()) parent = el("picker").querySelector(".dialogStopSlot");
  if (el("stop").parentElement !== parent) parent.appendChild(el("stop"));
}
function applySkin() {
  document.body.dataset.skin = skin;
  document.querySelector('meta[name="theme-color"]').content = skin === "navy" ? "#262d35" : "#edeae6";
  if (native) native.lightAppearance(skin === "silver");
  arrangeTools();
  placeStopButton();
  fitWheel();
  redrawDials();
}
settingsButton.onclick = () => {
  stop();
  setToolsOpen(false);
  refreshSettings();
  el("settingsShade").hidden = false;
  placeStopButton();
  el("settingsClose").focus();
  mainPanel.setAttribute("inert", "");
  header.setAttribute("inert", "");
};
el("settingsClose").onclick = closeSettings;
el("settingsShade").onclick = e => { if (e.target === el("settingsShade")) closeSettings(); };
el("resumeSim").onclick = () => { resumeSimulation(); closeSettings(); };
el("settingsPanel").onchange = e => {
  const input = e.target;
  if (input.name === "skin") {
    skin = input.value;
    savePreference("skin", skin);
    applySkin();
  } else if (stateName === "closed") {
    stop();
    if (input.name === "wire") { wire = input.value; savePreference("wire", wire); }
    if (input.id === "pulse") { pulsed = input.checked; savePreference("pulse", pulsed ? "on" : "off"); }
    if (input.id === "pulseHz") { pulseHz = BoatLegacy.frequency(input.value); savePreference("pulseHz", String(pulseHz)); }
  }
  refreshSettings();
};
applySkin();
window.boatLink("closed", "未连接", 0);
refreshOrientation();
draw(0, 0);
