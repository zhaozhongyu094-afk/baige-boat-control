"use strict";
// Wire values FF and FE are reserved for framing; the CRC travels as two nibbles.
const BoatWire = (() => {
  function crc8(bytes) {
    let crc = 0;
    for (const b of bytes) {
      crc ^= b;
      for (let i = 0; i < 8; i++)
        crc = ((crc << 1) ^ (crc & 128 ? 7 : 0)) & 255;
    }
    return crc;
  }
  function command(seq, x, y) {
    const body = [1, seq & 127, x + 100, y + 100];
    const crc = crc8(body);
    return [255, ...body, crc >> 4, crc & 15];
  }
  function ackReader(callback) {
    let body = null;
    return (bytes) => {
      for (const b of bytes) {
        if (b === 254) {
          body = [];
          continue;
        }
        if (!body) continue;
        body.push(b);
        if (body.length === 5) {
          const [v, seq, flag, hi, lo] = body;
          const crc = crc8([v, seq, flag]);
          if (
            v === 1 &&
            seq < 128 &&
            flag <= 1 &&
            hi === crc >> 4 &&
            lo === (crc & 15)
          )
            callback(seq, flag);
          body = null;
        }
      }
    };
  }
  function motors(x, y) {
    const l = y + x,
      r = y - x,
      scale = Math.max(100, Math.abs(l), Math.abs(r));
    const steps = (n) =>
      Math.sign(n) * Math.floor((Math.abs(n) * 32) / scale + 0.5);
    return [steps(l), steps(r)];
  }
  return { command, ackReader, motors, crc8 };
})();
if (typeof module !== "undefined") module.exports = BoatWire;
