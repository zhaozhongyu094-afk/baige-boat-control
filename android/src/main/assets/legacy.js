"use strict";
// The original 51 firmware accepts one ASCII digit and answers OK for each command.
const BoatLegacy = (() => {
  const stop = "5";
  function frequency(value) {
    const hz = Number(value);
    return [4, 8, 12].includes(hz) ? hz : 8;
  }
  function tickInterval(hz) {
    return Math.min(12, Math.floor(1000 / (16 * frequency(hz))));
  }
  function demand(x, y, pulsed) {
    const magnitude = Math.min(100, Math.hypot(x, y));
    if (magnitude < 12) return { command: stop, duty: 0, outputs: [0, 0] };
    const command = Math.abs(x) > Math.abs(y) ? (x < 0 ? "3" : "4") : (y < 0 ? "2" : "1");
    const duty = pulsed ? Math.max(25, Math.round(magnitude / 25) * 25) : 100;
    const outputs = { "1": [duty, duty], "2": [-duty, -duty], "3": [0, duty], "4": [duty, 0] };
    return { command, duty, outputs: outputs[command] };
  }
  function session(send, onReady, onFault, hz) {
    const period = 1000 / frequency(hz);
    let pending = [], lastCommand = "", lastSent = -Infinity, lastTick = null;
    let phaseStart = 0, heading = stop, armed = false, failed = false, buffer = "", pulseMode = false;
    function replyLimit() {
      if (!armed) return 1500;
      return pulseMode && heading !== stop ? 125 : 320;
    }
    function write(command, now) {
      pending.push({ command, at: now });
      lastCommand = command;
      lastSent = now;
      send(command);
    }
    function fault(message) {
      if (failed) return;
      failed = true;
      send(stop);
      onFault(message);
    }
    // A stop can overtake an outstanding movement ACK. Consume both replies in order.
    function halt(now) {
      heading = stop;
      if (!failed && lastCommand !== stop) write(stop, now);
    }
    function tick(now, x, y, pulsed) {
      if (failed) return;
      pulseMode = pulsed;
      if (pending.length && now - pending[0].at > replyLimit()) {
        fault("旧船回执超时"); return;
      }
      if (pulsed && heading !== stop && lastTick !== null && now - lastTick > Math.min(95, period / 2)) {
        fault("点动时序延迟过大"); return;
      }
      lastTick = now;
      const { command, duty } = demand(x, y, pulsed);
      if (!armed || command === stop) {
        halt(now);
        if (!pending.length && now - lastSent >= 150) write(stop, now);
        return;
      }
      if (command !== heading) {
        if (heading !== stop) { halt(now); return; }
        if (pending.length) return;
        phaseStart = now;
        heading = command;
      }
      const withinOnTime = (now - phaseStart) % period < period * duty / 100;
      const next = withinOnTime ? command : stop;
      // On the same held stroke the next ON edge may follow a single in-flight
      // pulse OFF. A release or heading change passes through halt() above and
      // waits for all its replies. Only a stop may preempt two pending bytes.
      if (next !== lastCommand) {
        if (next === stop || pending.length < 2) write(next, now);
        return;
      }
      // Fractional-duty edges already refresh the link. A redundant byte just
      // before the next edge would waste its time slot waiting for another OK.
      if (!pending.length && duty === 100 && next !== stop && now - lastSent >= 150) write(next, now);
    }
    function receive(bytes, now) {
      if (failed) return;
      for (const b of bytes) {
        buffer = (buffer + String.fromCharCode(b)).slice(-5);
        if (buffer.endsWith("Error")) { fault("旧船返回 Error"); return; }
        if (!buffer.endsWith("OK")) continue;
        buffer = "";
        const ack = pending.shift();
        if (!ack) continue;
        if (now - ack.at > replyLimit()) { fault("旧船回执已过期"); return; }
        if (!armed && ack.command === stop) { armed = true; onReady(); }
      }
    }
    return { tick, receive, halt };
  }
  return { demand, session, frequency, tickInterval };
})();
if (typeof module !== "undefined") module.exports = BoatLegacy;
