/* util.js — math, RNG, AABB helpers */
'use strict';
(function () {
  const U = {};

  U.clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  U.lerp = (a, b, t) => a + (b - a) * t;
  U.smoothstep = (t) => t * t * (3 - 2 * t);
  U.mod = (n, m) => ((n % m) + m) % m;
  U.floor = Math.floor;
  U.rad = (d) => d * Math.PI / 180;

  // Deterministic 32-bit string/number hash
  U.hash32 = function (str) {
    let h = 2166136261 >>> 0;
    str = String(str);
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  };

  // mulberry32 PRNG factory
  U.rng = function (seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  U.RNG = class {
    constructor(seed) { this.state = seed >>> 0; }
    next() {
      let a = this.state | 0;
      a = (a + 0x6D2B79F5) | 0;
      this.state = a >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    getState() { return this.state >>> 0; }
    setState(state) { this.state = state >>> 0; }
  };

  // Position-seeded deterministic random in [0,1)
  U.posRand = function (seed, x, y, z) {
    let h = seed >>> 0;
    h = Math.imul(h ^ (x | 0), 0x85EBCA6B);
    h = Math.imul(h ^ (y | 0), 0xC2B2AE35);
    h = Math.imul(h ^ (z | 0), 0x27D4EB2F);
    h ^= h >>> 15; h = Math.imul(h, 0x2C1B3C6D);
    h ^= h >>> 12; h = Math.imul(h, 0x297A2D39);
    h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
  };

  U.dist2 = (x1, y1, z1, x2, y2, z2) => {
    const dx = x1 - x2, dy = y1 - y2, dz = z1 - z2;
    return dx * dx + dy * dy + dz * dz;
  };

  // AABB: {x,y,z (min corner), w (x size), h (y size), d (z size)}
  U.aabbOverlap = function (a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x &&
           a.y < b.y + b.h && a.y + a.h > b.y &&
           a.z < b.z + b.d && a.z + a.d > b.z;
  };

  // Entity box centered on x,z; feet at y
  U.entityBox = function (x, y, z, w, h) {
    return { x: x - w / 2, y: y, z: z - w / 2, w: w, h: h, d: w };
  };

  U.fmt = (n, d) => Number(n).toFixed(d === undefined ? 2 : d);

  // base64 for Uint8Array (chunked to avoid arg limits)
  U.b64encode = function (u8) {
    let s = '';
    for (let i = 0; i < u8.length; i += 4096) {
      s += String.fromCharCode.apply(null, u8.subarray(i, Math.min(i + 4096, u8.length)));
    }
    return btoa(s);
  };
  U.b64decode = function (str) {
    const s = atob(str);
    const u8 = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
    return u8;
  };

  // RLE encode Uint8Array -> Uint8Array of (count,value) pairs (count 1..255)
  U.rleEncode = function (data) {
    const out = [];
    let i = 0;
    while (i < data.length) {
      const v = data[i];
      let run = 1;
      while (run < 255 && i + run < data.length && data[i + run] === v) run++;
      out.push(run, v);
      i += run;
    }
    return new Uint8Array(out);
  };
  U.rleDecode = function (rle, outLen) {
    if (!rle || (rle.length & 1)) throw new Error('invalid-rle');
    const out = new Uint8Array(outLen);
    let o = 0;
    for (let i = 0; i + 1 < rle.length; i += 2) {
      const run = rle[i], v = rle[i + 1];
      if (run === 0 || o + run > outLen) throw new Error('invalid-rle');
      out.fill(v, o, o + run);
      o += run;
    }
    if (o !== outLen) throw new Error('invalid-rle');
    return out;
  };

  U.checksum32 = function (data) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < data.length; i++) {
      h ^= data[i];
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  };

  window.U = U;
})();
