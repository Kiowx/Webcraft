/* noise.js — seeded gradient/value noise + FBM (2D & 3D) */
'use strict';
(function () {
  const Noise = {};

  function buildPerm(seed) {
    const p = new Uint8Array(512);
    const src = new Uint8Array(256);
    for (let i = 0; i < 256; i++) src[i] = i;
    const rand = U.rng(seed);
    for (let i = 255; i > 0; i--) {
      const j = (rand() * (i + 1)) | 0;
      const t = src[i]; src[i] = src[j]; src[j] = t;
    }
    for (let i = 0; i < 512; i++) p[i] = src[i & 255];
    return p;
  }

  const G2 = [[1,1],[-1,1],[1,-1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]];
  const G3 = [
    [1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],
    [1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],
    [0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1],
  ];

  function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }

  // Perlin-style gradient noise, output roughly [-1, 1]
  Noise.make2D = function (seed) {
    const p = buildPerm(seed);
    return function (x, y) {
      const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
      const xf = x - Math.floor(x), yf = y - Math.floor(y);
      const u = fade(xf), v = fade(yf);
      function grad(hash, gx, gy) {
        const g = G2[hash & 7];
        return g[0] * gx + g[1] * gy;
      }
      const aa = p[p[X] + Y], ab = p[p[X] + Y + 1];
      const ba = p[p[X + 1] + Y], bb = p[p[X + 1] + Y + 1];
      const x1 = U.lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u);
      const x2 = U.lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u);
      return U.lerp(x1, x2, v) * 1.42;
    };
  };

  Noise.make3D = function (seed) {
    const p = buildPerm(seed);
    return function (x, y, z) {
      const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
      const xf = x - Math.floor(x), yf = y - Math.floor(y), zf = z - Math.floor(z);
      const u = fade(xf), v = fade(yf), w = fade(zf);
      function grad(hash, gx, gy, gz) {
        const g = G3[hash % 12];
        return g[0] * gx + g[1] * gy + g[2] * gz;
      }
      const A = p[X] + Y, AA = p[A] + Z, AB = p[A + 1] + Z;
      const B = p[X + 1] + Y, BA = p[B] + Z, BB = p[B + 1] + Z;
      return U.lerp(
        U.lerp(
          U.lerp(grad(p[AA], xf, yf, zf), grad(p[BA], xf - 1, yf, zf), u),
          U.lerp(grad(p[AB], xf, yf - 1, zf), grad(p[BB], xf - 1, yf - 1, zf), u), v),
        U.lerp(
          U.lerp(grad(p[AA + 1], xf, yf, zf - 1), grad(p[BA + 1], xf - 1, yf, zf - 1), u),
          U.lerp(grad(p[AB + 1], xf, yf - 1, zf - 1), grad(p[BB + 1], xf - 1, yf - 1, zf - 1), u), v),
        w) * 1.1;
    };
  };

  // FBM wrapper: octaves of a base noise fn
  Noise.fbm2 = function (fn, octaves, lac, gain) {
    lac = lac || 2.0; gain = gain || 0.5;
    return function (x, y) {
      let amp = 1, freq = 1, sum = 0, norm = 0;
      for (let i = 0; i < octaves; i++) {
        sum += fn(x * freq, y * freq) * amp;
        norm += amp;
        amp *= gain; freq *= lac;
      }
      return sum / norm;
    };
  };

  window.Noise = Noise;
})();
