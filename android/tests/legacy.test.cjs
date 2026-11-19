// Run with node --test android/tests/legacy.test.cjs. Timing is simulated, not measured over radio.
const test = require("node:test");
const assert = require("node:assert/strict");
const legacy = require("../src/main/assets/legacy.js");
const wire = require("../src/main/assets/protocol.js");

test("the five legacy commands match the original motor outputs", () => {
  const cases = [
    [0, 90, "1", [100,100]], [0,-90,"2",[-100,-100]],
    [-80,0,"3",[0,100]], [80,0,"4",[100,0]], [0,0,"5",[0,0]],
  ];
  for (const [x, y, command, outputs] of cases) {
    const target = legacy.demand(x, y, false);
    assert.equal(target.command, command);
    assert.deepEqual(target.outputs, outputs);
  }
  assert.ok(wire.command(0,0,0).every(b => b < 0x31 || b > 0x34));
});

test("stopping during a write consumes both outstanding replies before moving again", () => {
  const bytes = [];
  let armed = false;
  const session = legacy.session(b => bytes.push(b), () => { armed = true; }, assert.fail);
  session.tick(0, 0, 80, false);
  session.receive([79], 1);
  assert.equal(armed, false);
  session.receive([75], 2);
  session.tick(3, 0, 80, false);
  session.halt(4);
  session.receive([79,75], 6);
  session.tick(7, 90, 0, false);
  assert.deepEqual(bytes, ["5","1","5"]);
  session.receive([79,75], 8);
  session.tick(9, 90, 0, false);
  assert.deepEqual(bytes, ["5","1","5","4"]);
});

// An in-order SPP model. Delay each outbound byte and reply independently.
// Sample the legacy motor command over an eight-second window after neutral handshake.
function measure(duty, lowDelay, highDelay, hz) {
  let seed = 12491;
  const delay = () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return lowDelay + Math.floor(seed / 4294967296 * (highDelay - lowDelay + 1));
  };
  let now = 0, lastDelivery = 0, lastReply = 0, runningMs = 0, pulses = 0;
  const interval = legacy.tickInterval(hz);
  let armed = false, running = false, fault = "";
  const outbound = [], replies = [];
  const session = legacy.session(command => {
    lastDelivery = Math.max(now + delay(), lastDelivery + 2);
    outbound.push({ at: lastDelivery, command });
  }, () => { armed = true; }, reason => { fault = reason; }, hz);
  for (now = 0; now < 9000; now++) {
    while (outbound.length && outbound[0].at <= now) {
      const next = outbound.shift().command !== "5";
      if (!running && next) pulses++;
      running = next;
      lastReply = Math.max(now + 3 + delay(), lastReply + 2);
      replies.push(lastReply);
    }
    while (replies.length && replies[0] <= now) {
      replies.shift();
      session.receive([79,75], now);
    }
    const active = now >= 500 && now < 8500;
    if (now % interval === 0) session.tick(now, 0, armed && active ? duty : 0, true);
    if (active && running) runningMs++;
  }
  assert.equal(running, false);
  return { percentage: runningMs / 80, pulses, fault };
}

for (const hz of [4,8,12]) {
  test(hz + " Hz delivers the selected pulse count and duty, or stops on excessive latency", () => {
    for (const duty of [25,50,75,100]) {
      for (const [low, high] of [[3,8],[10,40]]) {
        const result = measure(duty, low, high, hz);
        assert.equal(result.fault, "");
        assert.ok(Math.abs(result.percentage - duty) < 4);
        assert.ok(Math.abs(result.pulses - (duty === 100 ? 1 : 8*hz)) <= 1);
      }
      assert.match(measure(duty,20,90,hz).fault, /回执/);
    }
  });
}

test("a new touch waits for pending pulse edges and the operator's stop", () => {
  const bytes = [];
  const session = legacy.session(b => bytes.push(b), () => {}, assert.fail, 12);
  const ok = t => session.receive([79,75], t);
  session.tick(0,0,0,true);
  ok(2);
  session.tick(5,0,75,true);
  ok(20);
  for (let t=25; t<=90; t+=5) session.tick(t,0,75,true);
  assert.deepEqual(bytes,["5","1","5","1"]);
  session.halt(91);
  for (const t of [94,98]) { ok(t); session.tick(t,0,-75,true); }
  assert.deepEqual(bytes,["5","1","5","1","5"]);
  ok(100);
  session.tick(101,0,-75,true);
  assert.equal(bytes.at(-1),"2");
});

test("unset or unsupported frequency uses 8 Hz", () => {
  for (const v of [undefined,"","bad","125",null]) assert.equal(legacy.frequency(v),8);
  assert.equal(legacy.frequency("12"),12);
});

test("a stalled pulse timer stops and late replies cannot restart it", () => {
  const bytes = [];
  let fault = "";
  const session = legacy.session(b => bytes.push(b), () => {}, reason => { fault = reason; });
  session.tick(0, 0, 0, true);
  session.receive([79,75], 5);
  session.tick(12, 0, 50, true);
  session.receive([79,75], 20);
  session.tick(150, 0, 50, true);
  session.receive([79,75], 200);
  session.tick(210, 0, 90, true);
  assert.match(fault, /时序/);
  assert.deepEqual(bytes, ["5","1","5"]);
});
