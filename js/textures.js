/* textures.js — procedural 16px pixel-art texture atlas (512x512, 32x32 tiles)
   Deterministic: own seeded PRNG, no Math.random / Date. */
'use strict';
(function () {
  const TILE = 16, GRID = 32, SIZE = 512;
  const painters = [];          // {name, fn}
  const slotOf = new Map();     // name -> slot index
  const uvCache = new Map();
  const rectCache = new Map();
  let atlas = null;
  let defaultAtlasPixels = null;
  let activePack = 'default';
  let packVersion = 0;
  let packLoad = null;
  const packs = new Map();
  const packResults = new Map();
  const packAtlases = new Map();
  const warned = {};
  const SKIN_PAGE_Y = SIZE - 64;
  const SKIN_PROFILES = Object.freeze([
    { id: 'steve', name: 'Steve', skin: '#c88b68', skinHi: '#e3aa84', hair: '#4b3024', hairDark: '#332018', shirt: '#347baa', shirtDark: '#245575', pants: '#45457d', shoe: '#282842' },
    { id: 'alex', name: 'Alex', skin: '#d9a17b', skinHi: '#edb895', hair: '#b85f2d', hairDark: '#71351f', shirt: '#77a83f', shirtDark: '#426f31', pants: '#5d5148', shoe: '#342f2b' },
    { id: 'miner', name: '矿工', skin: '#b87858', skinHi: '#d59672', hair: '#2f241e', hairDark: '#18130f', shirt: '#b28a32', shirtDark: '#6f521d', pants: '#3d5568', shoe: '#252b30' },
    { id: 'wanderer', name: '旅行者', skin: '#8f5f46', skinHi: '#b57b5b', hair: '#241a18', hairDark: '#100c0b', shirt: '#8f3f3f', shirtDark: '#562626', pants: '#353c58', shoe: '#1e2232' },
  ]);
  const SKIN_PROFILE_INDEX = new Map(SKIN_PROFILES.map((profile, index) => [profile.id, index]));
  const SKIN_UV = Object.freeze({
    head: { right:[0,8,8,8], front:[8,8,8,8], left:[16,8,8,8], back:[24,8,8,8], top:[8,0,8,8], bottom:[16,0,8,8] },
    hat: { right:[32,8,8,8], front:[40,8,8,8], left:[48,8,8,8], back:[56,8,8,8], top:[40,0,8,8], bottom:[48,0,8,8] },
    body: { right:[16,20,4,12], front:[20,20,8,12], left:[28,20,4,12], back:[32,20,8,12], top:[20,16,8,4], bottom:[28,16,8,4] },
    jacket: { right:[16,36,4,12], front:[20,36,8,12], left:[28,36,4,12], back:[32,36,8,12], top:[20,32,8,4], bottom:[28,32,8,4] },
    armR: { right:[40,20,4,12], front:[44,20,4,12], left:[48,20,4,12], back:[52,20,4,12], top:[44,16,4,4], bottom:[48,16,4,4] },
    sleeveR: { right:[40,36,4,12], front:[44,36,4,12], left:[48,36,4,12], back:[52,36,4,12], top:[44,32,4,4], bottom:[48,32,4,4] },
    armL: { right:[32,52,4,12], front:[36,52,4,12], left:[40,52,4,12], back:[44,52,4,12], top:[36,48,4,4], bottom:[40,48,4,4] },
    sleeveL: { right:[48,52,4,12], front:[52,52,4,12], left:[56,52,4,12], back:[60,52,4,12], top:[52,48,4,4], bottom:[56,48,4,4] },
    legR: { right:[0,20,4,12], front:[4,20,4,12], left:[8,20,4,12], back:[12,20,4,12], top:[4,16,4,4], bottom:[8,16,4,4] },
    pantsR: { right:[0,36,4,12], front:[4,36,4,12], left:[8,36,4,12], back:[12,36,4,12], top:[4,32,4,4], bottom:[8,32,4,4] },
    legL: { right:[16,52,4,12], front:[20,52,4,12], left:[24,52,4,12], back:[28,52,4,12], top:[20,48,4,4], bottom:[24,48,4,4] },
    pantsL: { right:[0,52,4,12], front:[4,52,4,12], left:[8,52,4,12], back:[12,52,4,12], top:[4,48,4,4], bottom:[8,48,4,4] },
  });
  const SKIN_TEXTURE_NAMES = [];
  for (const profile of SKIN_PROFILES) for (const part of Object.keys(SKIN_UV)) {
    for (const face of Object.keys(SKIN_UV[part])) SKIN_TEXTURE_NAMES.push('skin.' + profile.id + '.' + part + '.' + face);
  }

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashName(s) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  // ---- color helpers ----
  function hx(s) {
    return [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16), 255];
  }
  function A(c, a) { return [c[0], c[1], c[2], a]; }
  function sh(c, f) {
    return [Math.min(255, c[0] * f | 0), Math.min(255, c[1] * f | 0), Math.min(255, c[2] * f | 0), c[3]];
  }

  // ---- painter context ----
  function makeP(data, rand) {
    const P = {
      rand,
      px(x, y, c) {
        if (x < 0 || x > 15 || y < 0 || y > 15) return;
        const i = (y * 16 + x) * 4;
        data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = c[3] === undefined ? 255 : c[3];
      },
      get(x, y) {
        const i = (y * 16 + x) * 4;
        return [data[i], data[i + 1], data[i + 2], data[i + 3]];
      },
      fill(c) { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) P.px(x, y, c); },
      rect(x, y, w, h, c) { for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) P.px(xx, yy, c); },
      // fill with weighted random choice of colors
      noise(cols) {
        for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
          P.px(x, y, cols[(rand() * cols.length) | 0]);
        }
      },
      // scatter n pixels of color
      speck(c, n) { for (let i = 0; i < n; i++) P.px((rand() * 16) | 0, (rand() * 16) | 0, c); },
      // scatter small blobs
      blobs(c, count, size) {
        for (let i = 0; i < count; i++) {
          const bx = (rand() * 14) | 0, by = (rand() * 14) | 0;
          for (let d = 0; d < size; d++) {
            P.px(bx + ((rand() * 2.6) | 0), by + ((rand() * 2.6) | 0), c);
          }
        }
      },
      border(c) {
        for (let i = 0; i < 16; i++) { P.px(i, 0, c); P.px(i, 15, c); P.px(0, i, c); P.px(15, i, c); }
      },
    };
    return P;
  }

  function def(name, fn) { painters.push({ name, fn }); }

  // ================= palettes =================
  const C = {
    stone: [hx('#7d7d7d'), hx('#828282'), hx('#747474'), hx('#888888'), hx('#6e6e6e')],
    dirt: [hx('#866043'), hx('#79553a'), hx('#8f6b4b'), hx('#6d4d34'), hx('#96714f')],
    grass: [hx('#69a83c'), hx('#5e9a34'), hx('#74b344'), hx('#559030'), hx('#7cbb4c')],
    sand: [hx('#dbd3a0'), hx('#d1c891'), hx('#e2dbac'), hx('#c9c08a')],
    wood: [hx('#9c7f4e'), hx('#a8894f'), hx('#8f7343'), hx('#a2834e')],
    darkwood: hx('#6b5030'),
    leaf: [hx('#2e6b1e'), hx('#38791f'), hx('#255c16'), hx('#417f2c')],
    leafSpruce: [hx('#2a5537'), hx('#234a2e'), hx('#316043'), hx('#1d4026')],
    snow: [hx('#f4f9fb'), hx('#eef4f8'), hx('#e6eef4'), hx('#fafdff')],
    waterA: 148,
  };

  // ================= terrain =================
  def('stone', (P) => { P.noise(C.stone); P.blobs(hx('#696969'), 5, 4); P.blobs(hx('#8d8d8d'), 3, 3); });
  def('dirt', (P) => { P.noise(C.dirt); P.blobs(hx('#5f4228'), 4, 3); P.speck(hx('#a07a54'), 12); });
  def('grass_top', (P) => { P.noise(C.grass); P.speck(hx('#8ac95c'), 14); P.speck(hx('#4a8228'), 14); });
  def('grass_side', (P) => {
    P.noise(C.dirt);
    for (let x = 0; x < 16; x++) {
      const d = 2 + ((P.rand() * 2.4) | 0);
      for (let y = 0; y < d; y++) P.px(x, y, C.grass[(P.rand() * C.grass.length) | 0]);
      P.px(x, d, sh(C.grass[0], 0.75));
    }
  });
  def('grass_side_snow', (P) => {
    P.noise(C.dirt);
    for (let x = 0; x < 16; x++) {
      const d = 2 + ((P.rand() * 2.4) | 0);
      for (let y = 0; y < d; y++) P.px(x, y, C.snow[(P.rand() * C.snow.length) | 0]);
    }
  });
  def('cobblestone', (P) => {
    P.fill(hx('#5a5a5a'));
    const stones = [[1, 1, 5, 4], [7, 0, 5, 5], [12, 2, 4, 4], [0, 6, 4, 4], [5, 6, 6, 5], [11, 7, 5, 4], [1, 11, 5, 4], [7, 12, 4, 4], [12, 12, 4, 4]];
    for (const s of stones) {
      const base = 0.85 + P.rand() * 0.35;
      for (let y = s[1]; y < s[1] + s[3] - 1 && y < 16; y++)
        for (let x = s[0]; x < s[0] + s[2] - 1 && x < 16; x++)
          P.px(x, y, sh(C.stone[(P.rand() * C.stone.length) | 0], base));
      P.px(s[0], s[1], sh(hx('#9a9a9a'), base));
    }
  });
  def('mossy_cobblestone', (P) => {
    painters.find(p => p.name === 'cobblestone').fn(P);
    P.blobs(hx('#4c7a3d'), 6, 5);
    P.blobs(hx('#5d9048'), 4, 3);
  });
  def('bedrock', (P) => { P.noise([hx('#565656'), hx('#333333'), hx('#1e1e1e'), hx('#777777'), hx('#454545')]); P.blobs(hx('#161616'), 5, 5); });
  def('sand', (P) => { P.noise(C.sand); P.speck(hx('#efe8bc'), 10); P.speck(hx('#b8ae76'), 10); });
  def('sandstone_top', (P) => { P.noise(C.sand.map(c => sh(c, 1.02))); P.border(hx('#c9bf87')); });
  def('sandstone_side', (P) => {
    P.noise(C.sand);
    P.rect(0, 0, 16, 2, hx('#e4dcae'));
    P.rect(0, 14, 16, 2, hx('#cfc48d'));
    for (let i = 0; i < 4; i++) {
      const x = (P.rand() * 14) | 0, y = 4 + ((P.rand() * 8) | 0);
      P.rect(x, y, 2 + ((P.rand() * 3) | 0), 1, hx('#bdb27c'));
    }
  });
  def('gravel', (P) => {
    P.noise([hx('#847d78'), hx('#6e6862'), hx('#95908a')]);
    P.blobs(hx('#5a544e'), 6, 4); P.blobs(hx('#a9a49e'), 6, 4); P.blobs(hx('#7b6a5a'), 4, 3);
  });
  def('water', (P) => {
    const b = [hx('#2f5eb4'), hx('#3565bd'), hx('#2a56a8')];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      let c = b[(P.rand() * b.length) | 0];
      if (P.rand() < 0.08) c = hx('#4d7ccc');
      P.px(x, y, A(c, C.waterA));
    }
  });
  def('lava', (P) => {
    P.noise([hx('#cf5a1a'), hx('#d96820'), hx('#c24e12')]);
    P.blobs(hx('#f5a623'), 6, 6); P.blobs(hx('#ffd83d'), 4, 4); P.blobs(hx('#8f2f08'), 4, 4);
  });
  def('log_side', (P) => {
    for (let x = 0; x < 16; x++) {
      const shade = [hx('#6b522f'), hx('#75592f'), hx('#5f4829'), hx('#7d6136')][(x * 7 + 3) % 4];
      for (let y = 0; y < 16; y++) {
        P.px(x, y, P.rand() < 0.12 ? sh(shade, 0.8) : shade);
      }
    }
    P.rect(4, 6, 2, 3, hx('#4e3a1f'));
  });
  def('log_top', (P) => {
    P.fill(hx('#6b522f'));
    const rings = [hx('#b59567'), hx('#9c7f4e'), hx('#84673a'), hx('#b59567'), hx('#9c7f4e'), hx('#84673a'), hx('#6b522f')];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5)) | 0;
      P.px(x, y, rings[Math.min(d, rings.length - 1)]);
    }
    P.border(hx('#553f22'));
  });
  def('spruce_log_side', (P) => {
    for (let x = 0; x < 16; x++) {
      const shade = [hx('#4a3620'), hx('#523c24'), hx('#3f2e1b'), hx('#5a4228')][(x * 5 + 1) % 4];
      for (let y = 0; y < 16; y++) P.px(x, y, P.rand() < 0.12 ? sh(shade, 0.82) : shade);
    }
  });
  def('leaves', (P) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      if (P.rand() < 0.16) P.px(x, y, A(C.leaf[0], 0));
      else P.px(x, y, C.leaf[(P.rand() * C.leaf.length) | 0]);
    }
    P.speck(hx('#54a038'), 10);
  });
  def('leaves_spruce', (P) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      if (P.rand() < 0.14) P.px(x, y, A(C.leafSpruce[0], 0));
      else P.px(x, y, C.leafSpruce[(P.rand() * C.leafSpruce.length) | 0]);
    }
  });
  def('planks', (P) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      let c = C.wood[(P.rand() * C.wood.length) | 0];
      if (y % 4 === 3) c = C.darkwood;
      P.px(x, y, c);
    }
    // board seams offset per row
    for (let row = 0; row < 4; row++) {
      const sx = (row % 2 === 0) ? 3 : 11;
      for (let y = row * 4; y < row * 4 + 3; y++) P.px(sx, y, C.darkwood);
    }
  });
  def('glass', (P) => {
    P.fill([255, 255, 255, 0]);
    P.border(hx('#dbeef2'));
    for (let i = 0; i < 5; i++) { P.px(2 + i, 7 - i, A(hx('#ffffff'), 190)); P.px(3 + i, 7 - i, A(hx('#e8f6fa'), 120)); }
    P.px(12, 11, A(hx('#ffffff'), 150)); P.px(11, 12, A(hx('#ffffff'), 150));
  });
  function oreTile(gem, hi) {
    return (P) => {
      P.noise(C.stone);
      const spots = [[3, 3], [10, 2], [5, 8], [12, 9], [2, 12], [8, 13], [13, 5]];
      for (let i = 0; i < 5; i++) {
        const s = spots[(P.rand() * spots.length) | 0];
        P.px(s[0], s[1], gem); P.px(s[0] + 1, s[1], gem);
        P.px(s[0], s[1] + 1, gem); P.px(s[0] + 1, s[1] + 1, hi);
      }
    };
  }
  def('coal_ore', oreTile(hx('#222222'), hx('#3c3c3c')));
  def('iron_ore', oreTile(hx('#d8af93'), hx('#e8c7ae')));
  def('gold_ore', oreTile(hx('#f0d24a'), hx('#faea9b')));
  def('diamond_ore', oreTile(hx('#4aedd9'), hx('#a5f7ec')));
  def('glowstone', (P) => {
    P.noise([hx('#8f6b3e'), hx('#a37b46'), hx('#7d5c34')]);
    P.blobs(hx('#f9d364'), 7, 5); P.blobs(hx('#ffeeb0'), 5, 3);
  });
  def('snow', (P) => { P.noise(C.snow); P.speck(hx('#d5e2ec'), 8); });
  def('cactus_side', (P) => {
    P.noise([hx('#0f7716'), hx('#12831b'), hx('#0c6a12')]);
    for (const x of [0, 5, 10, 15]) for (let y = 0; y < 16; y++) if (P.rand() < 0.8) P.px(x, y, hx('#0a5c0f'));
    P.speck(hx('#8fd18f'), 8);
  });
  def('cactus_top', (P) => {
    P.noise([hx('#0f7716'), hx('#12831b'), hx('#0c6a12')]);
    P.border(hx('#0a5c0f'));
    P.rect(7, 3, 2, 10, hx('#159420')); P.rect(3, 7, 10, 2, hx('#159420'));
  });
  def('tallgrass', (P) => {
    P.fill([0, 0, 0, 0]);
    for (let i = 0; i < 8; i++) {
      let x = 1 + ((P.rand() * 14) | 0);
      const hgt = 5 + ((P.rand() * 8) | 0);
      const col = C.grass[(P.rand() * C.grass.length) | 0];
      for (let k = 0; k < hgt; k++) {
        P.px(x, 15 - k, k > hgt - 3 ? sh(col, 1.15) : col);
        if (P.rand() < 0.3) x += P.rand() < 0.5 ? 1 : -1;
      }
    }
  });
  function flower(petal, center) {
    return (P) => {
      P.fill([0, 0, 0, 0]);
      for (let y = 9; y < 16; y++) P.px(7, y, hx('#3a7a1e'));
      P.px(6, 12, hx('#3a7a1e')); P.px(8, 11, hx('#4a8a2a'));
      const cx = 7, cy = 5;
      P.px(cx, cy - 2, petal); P.px(cx, cy + 2, petal);
      P.px(cx - 2, cy, petal); P.px(cx + 2, cy, petal);
      P.px(cx - 1, cy - 1, petal); P.px(cx + 1, cy - 1, petal);
      P.px(cx - 1, cy + 1, petal); P.px(cx + 1, cy + 1, petal);
      P.px(cx, cy, center);
      P.px(cx, cy - 3, sh(petal, 1.2)); P.px(cx - 3, cy, sh(petal, 0.85)); P.px(cx + 3, cy, sh(petal, 0.85));
    };
  }
  def('flower_red', flower(hx('#d23b2e'), hx('#f6e15a')));
  def('flower_yellow', flower(hx('#f2d33a'), hx('#b98a1e')));
  def('sapling', (P) => {
    P.fill([0, 0, 0, 0]);
    for (let y = 9; y < 16; y++) P.px(7, y, hx('#6b4a24'));
    for (let y = 2; y < 10; y++) for (let x = 3; x < 12; x++) {
      const d = Math.abs(x - 7) + Math.abs(y - 5.5);
      if (d < 5 && P.rand() < 0.75) P.px(x, y, C.leaf[(P.rand() * C.leaf.length) | 0]);
    }
  });
  def('torch', (P) => {
    P.fill([0, 0, 0, 0]);
    for (let y = 7; y < 16; y++) { P.px(7, y, hx('#7a5b2e')); P.px(8, y, hx('#5f4623')); }
    P.px(7, 6, hx('#f7b930')); P.px(8, 6, hx('#d98b20'));
    P.px(7, 5, hx('#fff1a3')); P.px(8, 5, hx('#ffd75a'));
    P.px(7, 4, hx('#ffe06b')); P.px(8, 4, hx('#f7a91f'));
    P.px(7, 3, hx('#fff7cf')); P.px(8, 3, hx('#ffe27a'));
    P.px(7, 2, hx('#fff4b0'));
  });
  def('crafting_table_top', (P) => {
    painters.find(p => p.name === 'planks').fn(P);
    P.border(hx('#5b4426'));
    for (let i = 4; i <= 12; i += 4) {
      for (let k = 4; k <= 12; k++) { P.px(i, k, hx('#8a6f42')); P.px(k, i, hx('#8a6f42')); }
    }
    P.rect(4, 4, 9, 1, hx('#c5ad7c')); P.rect(4, 4, 1, 9, hx('#c5ad7c'));
  });
  def('crafting_table_side', (P) => {
    painters.find(p => p.name === 'planks').fn(P);
    P.rect(0, 0, 16, 3, hx('#7a5f38'));
    P.rect(3, 5, 4, 5, hx('#6b4a24'));
    P.rect(9, 5, 4, 5, hx('#c9baa4'));
    P.rect(10, 6, 2, 3, hx('#8d8d8d'));
  });
  def('crafting_table_front', (P) => {
    painters.find(p => p.name === 'planks').fn(P);
    P.rect(0, 0, 16, 3, hx('#7a5f38'));
    P.rect(4, 6, 3, 4, hx('#8d8d8d'));
    P.rect(9, 5, 3, 6, hx('#6b4a24'));
  });
  def('furnace_top', (P) => { P.noise(C.stone); P.border(hx('#5f5f5f')); });
  def('furnace_side', (P) => {
    P.noise(C.stone);
    P.rect(0, 0, 16, 1, hx('#8d8d8d'));
    P.rect(0, 15, 16, 1, hx('#565656'));
    P.blobs(hx('#6a6a6a'), 4, 3);
  });
  def('furnace_front', (P) => {
    painters.find(p => p.name === 'furnace_side').fn(P);
    P.rect(4, 8, 8, 6, hx('#1c1c1c'));
    P.rect(5, 9, 6, 4, hx('#0d0d0d'));
    P.rect(4, 7, 8, 1, hx('#4a4a4a'));
  });
  def('furnace_front_lit', (P) => {
    painters.find(p => p.name === 'furnace_side').fn(P);
    P.rect(4, 8, 8, 6, hx('#3a1c08'));
    for (let x = 5; x < 11; x++) {
      const fh = 2 + ((P.rand() * 3) | 0);
      for (let k = 0; k < fh; k++) P.px(x, 13 - k, k >= fh - 1 ? hx('#ffe27a') : hx('#f5a623'));
    }
    P.rect(4, 7, 8, 1, hx('#4a4a4a'));
  });
  def('bricks', (P) => {
    P.fill(hx('#9a9490'));
    const brick = [hx('#96513d'), hx('#8d4a37'), hx('#a05a45')];
    for (let row = 0; row < 4; row++) {
      const off = (row % 2) * 4;
      for (let col = -1; col < 3; col++) {
        const bx = col * 8 + off;
        for (let y = row * 4; y < row * 4 + 3; y++)
          for (let x = Math.max(0, bx); x < Math.min(16, bx + 7); x++)
            P.px(x, y, brick[(P.rand() * 3) | 0]);
      }
    }
  });
  def('stone_bricks', (P) => {
    P.fill(hx('#4f4f4f'));
    for (let row = 0; row < 2; row++) for (let col = 0; col < 2; col++) {
      const bx = col * 8, by = row * 8;
      for (let y = by; y < by + 7; y++) for (let x = bx; x < bx + 7; x++)
        P.px(x, y, C.stone[(P.rand() * C.stone.length) | 0]);
      for (let i = 0; i < 7; i++) { P.px(bx + i, by, hx('#909090')); P.px(bx, by + i, hx('#8a8a8a')); }
    }
  });
  def('bookshelf', (P) => {
    painters.find(p => p.name === 'planks').fn(P);
    const spineCols = [hx('#a03030'), hx('#3a6c2f'), hx('#3a4f9c'), hx('#b0872f'), hx('#6c3a8c'), hx('#c0c0b0')];
    for (const by of [2, 9]) {
      P.rect(1, by, 14, 5, hx('#3a2b16'));
      let x = 1;
      while (x < 15) {
        const w = 1 + ((P.rand() * 2) | 0);
        const c = spineCols[(P.rand() * spineCols.length) | 0];
        for (let xx = x; xx < Math.min(15, x + w); xx++)
          for (let y = by; y < by + 5; y++) P.px(xx, y, y === by ? sh(c, 1.2) : c);
        x += w + (P.rand() < 0.25 ? 1 : 0);
      }
    }
  });
  def('tnt_side', (P) => {
    P.noise([hx('#d23b2e'), hx('#c53428'), hx('#dc4a3a')]);
    P.rect(0, 5, 16, 5, hx('#e8e0cf'));
    P.rect(0, 5, 16, 1, hx('#c9bfa8'));
    const fontT = [[0, 0], [1, 0], [2, 0], [1, 1], [1, 2], [1, 3]];
    const fontN = [[0, 0], [0, 1], [0, 2], [0, 3], [1, 1], [2, 0], [2, 1], [2, 2], [2, 3]];
    const draw = (glyph, ox) => { for (const g of glyph) P.px(ox + g[0], 6 + g[1], hx('#1c1c1c')); };
    draw(fontT, 2); draw(fontN, 6); draw(fontT, 11);
  });
  def('tnt_top', (P) => {
    P.noise([hx('#d23b2e'), hx('#c53428'), hx('#dc4a3a')]);
    P.rect(4, 4, 8, 8, hx('#e8e0cf'));
    P.rect(7, 7, 2, 2, hx('#3a2b16'));
  });
  def('tnt_bottom', (P) => { P.noise([hx('#8d2a20'), hx('#96302a'), hx('#7d241c')]); });
  def('wool_white', (P) => {
    P.noise([hx('#e9e9e2'), hx('#dedbd3'), hx('#f2f2ec')]);
    for (let y = 0; y < 16; y += 2) for (let x = (y / 2) % 2; x < 16; x += 2) P.px(x, y, hx('#d5d2c8'));
  });
  def('bed_top', (P) => {
    P.rect(0, 0, 16, 16, hx('#8d2a20'));
    P.noise([hx('#a5352a'), hx('#992f24'), hx('#b03a2e')]);
    P.rect(1, 1, 14, 4, hx('#e9e9e2'));
    P.rect(1, 4, 14, 1, hx('#cfcabb'));
    P.rect(1, 6, 14, 1, hx('#7d241c'));
    P.border(hx('#5b1a12'));
  });
  def('bed_side', (P) => {
    P.rect(0, 0, 16, 8, hx('#a5352a'));
    P.rect(0, 2, 16, 1, hx('#7d241c'));
    for (let y = 8; y < 16; y++) for (let x = 0; x < 16; x++) P.px(x, y, C.wood[(P.rand() * C.wood.length) | 0]);
    P.rect(0, 12, 2, 4, hx('#5b4426')); P.rect(14, 12, 2, 4, hx('#5b4426'));
  });
  def('chest_top', (P) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) P.px(x, y, C.wood[(P.rand() * C.wood.length) | 0]);
    P.border(hx('#5b4426'));
  });
  def('chest_side', (P) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) P.px(x, y, sh(C.wood[(P.rand() * C.wood.length) | 0], 0.94));
    P.border(hx('#5b4426'));
    P.rect(0, 6, 16, 1, hx('#5b4426'));
  });
  def('chest_front', (P) => {
    painters.find(p => p.name === 'chest_side').fn(P);
    P.rect(7, 5, 2, 4, hx('#4a4a4a'));
    P.px(7, 5, hx('#8d8d8d')); P.px(8, 6, hx('#6a6a6a'));
  });
  def('sun', (P) => {
    P.fill([0, 0, 0, 0]);
    P.rect(2, 2, 12, 12, hx('#fdf0a8'));
    P.rect(4, 4, 8, 8, hx('#fffbe0'));
    P.rect(2, 2, 12, 1, hx('#f7d75a')); P.rect(2, 13, 12, 1, hx('#f7d75a'));
    P.rect(2, 2, 1, 12, hx('#f7d75a')); P.rect(13, 2, 1, 12, hx('#f7d75a'));
  });
  def('moon', (P) => {
    P.fill([0, 0, 0, 0]);
    P.rect(3, 3, 10, 10, hx('#cdd4e0'));
    P.rect(5, 5, 6, 6, hx('#e4e9f2'));
    P.px(6, 7, hx('#aab2c2')); P.px(9, 9, hx('#aab2c2')); P.px(7, 10, hx('#b8c0cf'));
  });
  for (let stage = 0; stage < 8; stage++) {
    def('crack_' + stage, (P) => {
      P.fill([0, 0, 0, 0]);
      const walks = 2 + stage;
      for (let wk = 0; wk < walks; wk++) {
        let x = (P.rand() * 16) | 0, y = 0;
        if (wk % 2 === 0) { x = 0; y = (P.rand() * 16) | 0; }
        const len = 5 + stage * 1.4;
        let dx = x === 0 ? 1 : 0, dy = y === 0 ? 1 : 0;
        for (let k = 0; k < len; k++) {
          P.px(x, y, [20, 20, 20, 185]);
          if (P.rand() < 0.4) P.px(x + 1, y, [20, 20, 20, 120]);
          x += dx; y += dy;
          if (P.rand() < 0.45) { x += P.rand() < 0.5 ? 1 : -1; }
          if (P.rand() < 0.45) { y += P.rand() < 0.5 ? 1 : -1; }
          if (x < 0 || x > 15 || y < 0 || y > 15) break;
        }
      }
      P.speck([20, 20, 20, 150], stage * 4);
    });
  }
  def('farmland_top', (P) => {
    P.noise([hx('#6d4328'), hx('#74482a'), hx('#5f3921'), hx('#805033')]);
    for (let y = 1; y < 16; y += 4) P.rect(0, y, 16, 1, hx('#4c2d1a'));
    P.speck(hx('#9a6742'), 14);
  });
  function cropTexture(prefix, stage, stem, leaf) {
    def(prefix + '_' + stage, (P) => {
      P.fill([0, 0, 0, 0]);
      const top = 14 - stage * 3;
      for (let y = 15; y >= top; y--) {
        P.px(7, y, stem); P.px(8, y, sh(stem, 1.12));
        if (y > top + 1 && ((15 - y) & 1) === 0) {
          P.px(5, y, leaf); P.px(6, y - 1, leaf);
          P.px(9, y - 1, sh(leaf, 0.9)); P.px(10, y, sh(leaf, 0.9));
        }
      }
      if (stage >= 2) {
        P.rect(6, top, 4, 2, sh(stem, 1.2));
        if (prefix === 'wheat') { P.px(5, top + 1, hx('#c9a43a')); P.px(10, top, hx('#d8b84f')); }
      }
    });
  }
  for (let stage = 0; stage < 4; stage++) {
    cropTexture('wheat', stage, stage >= 3 ? hx('#caa43c') : hx('#6f9c2c'), hx('#5d8b28'));
    cropTexture('carrot', stage, hx('#5f9b2f'), stage >= 3 ? hx('#e77c24') : hx('#4e8726'));
    cropTexture('potato', stage, hx('#68953b'), stage >= 3 ? hx('#b69350') : hx('#527c31'));
  }
  def('fire', (P) => {
    P.fill([0, 0, 0, 0]);
    for (let y = 2; y < 16; y++) {
      const half = Math.max(1, Math.floor((y - 1) * 0.32));
      for (let x = 8 - half; x <= 8 + half; x++) {
        const edge = Math.abs(x - 8) === half;
        P.px(x, y, edge ? [235, 55, 8, 210] : (y > 9 ? [255, 170, 20, 235] : [255, 95, 8, 230]));
      }
    }
    P.rect(7, 10, 3, 6, [255, 226, 72, 240]);
  });
  def('lapis_ore', (P) => {
    P.noise(C.stone);
    P.blobs(hx('#194aa8'), 7, 4); P.speck(hx('#3b77dc'), 18); P.speck(hx('#102f75'), 10);
  });
  def('enchanting_table_top', (P) => {
    P.fill(hx('#24152e')); P.border(hx('#0f0915'));
    P.rect(2, 2, 12, 12, hx('#9b1f26')); P.rect(4, 4, 8, 8, hx('#22212d'));
    P.rect(6, 5, 4, 6, hx('#e7d9a2')); P.px(7, 7, hx('#55277d')); P.px(8, 7, hx('#55277d'));
  });
  def('enchanting_table_side', (P) => {
    P.fill(hx('#20122a')); P.rect(0, 0, 16, 4, hx('#9b1f26')); P.rect(0, 4, 16, 2, hx('#5e1118'));
    P.speck(hx('#5b2d70'), 18);
  });
  def('anvil_top', (P) => { P.noise([hx('#55585a'), hx('#666a6d'), hx('#444749')]); P.border(hx('#2b2d2f')); });
  def('anvil_side', (P) => {
    P.fill(hx('#444749')); P.rect(1, 2, 14, 4, hx('#686c6f')); P.rect(4, 6, 8, 6, hx('#505356'));
    P.rect(2, 12, 12, 3, hx('#373a3c')); P.speck(hx('#777b7e'), 10);
  });
  def('sugar_cane', (P) => {
    P.fill([0, 0, 0, 0]);
    for (let y = 0; y < 16; y++) {
      P.px(6, y, hx('#5d9f42')); P.px(7, y, hx('#8ccf62')); P.px(8, y, hx('#73b653')); P.px(9, y, hx('#477e35'));
      if (y === 4 || y === 10) P.rect(5, y, 6, 1, hx('#a1db79'));
    }
  });
  def('clay', (P) => { P.noise([hx('#9aa3ad'), hx('#a8b0b9'), hx('#8b949f'), hx('#b2bac2')]); P.blobs(hx('#7e8995'), 4, 3); });
  def('obsidian', (P) => {
    P.noise([hx('#191325'), hx('#211630'), hx('#130f1c'), hx('#2b1b3b')]);
    P.speck(hx('#4b2c68'), 24); P.speck(hx('#34204b'), 28);
  });
  def('iron_block', (P) => {
    P.fill(hx('#c7c9c9')); P.border(hx('#9da1a2')); P.rect(2, 2, 12, 1, hx('#eef0ef'));
    P.rect(2, 13, 12, 1, hx('#aeb2b3')); P.speck(hx('#d9dbdb'), 12);
  });
  def('ladder', (P) => {
    P.fill([0, 0, 0, 0]);
    const dark = hx('#60401f'), wood = hx('#9b7138'), light = hx('#bd9250');
    P.rect(2, 0, 3, 16, dark); P.rect(11, 0, 3, 16, dark);
    P.rect(3, 0, 1, 16, light); P.rect(12, 0, 1, 16, light);
    for (let y = 2; y < 16; y += 4) {
      P.rect(4, y, 8, 2, dark); P.rect(4, y, 8, 1, wood);
    }
  });
  def('cobweb', (P) => {
    P.fill([0, 0, 0, 0]);
    const edge = hx('#b8bec3'), silk = hx('#edf1f2');
    for (let i = 0; i < 16; i++) {
      P.px(i, i, silk); P.px(15 - i, i, silk);
      P.px(7, i, edge); P.px(8, i, silk); P.px(i, 7, edge); P.px(i, 8, silk);
    }
    for (const p of [[3,3],[12,3],[3,12],[12,12]]) {
      P.rect(p[0] - 1, p[1], 3, 1, edge); P.rect(p[0], p[1] - 1, 1, 3, silk);
    }
  });
  def('soul_sand', (P) => {
    P.noise([hx('#5a412f'), hx('#4b3527'), hx('#674a35'), hx('#3d2b21')]);
    const dark = hx('#2e211b');
    for (const face of [[4,5],[11,4],[7,11]]) {
      P.rect(face[0] - 1, face[1], 3, 2, dark);
      P.px(face[0] - 1, face[1] - 1, hx('#765640')); P.px(face[0] + 1, face[1] - 1, hx('#765640'));
    }
  });
  def('lever', (P) => {
    P.fill([0, 0, 0, 0]);
    P.rect(5, 11, 7, 4, hx('#777777')); P.rect(6, 10, 5, 1, hx('#a4a4a4'));
    for (let i = 0; i < 9; i++) {
      P.px(8 + ((i / 3) | 0), 10 - i, hx('#78522d'));
      P.px(9 + ((i / 3) | 0), 10 - i, hx('#a57a43'));
    }
  });
  def('redstone_lamp', (P) => {
    P.noise([hx('#5d422d'), hx('#4d3526'), hx('#6b4d34')]);
    P.border(hx('#33251c')); P.rect(3, 3, 10, 10, hx('#70502f'));
    P.rect(5, 5, 6, 6, hx('#8a6237')); P.speck(hx('#3a291e'), 12);
  });
  def('redstone_lamp_lit', (P) => {
    P.noise([hx('#d99031'), hx('#eda73e'), hx('#bd6f25')]);
    P.border(hx('#7d431e')); P.rect(3, 3, 10, 10, hx('#f0b947'));
    P.rect(5, 5, 6, 6, hx('#ffd86b')); P.speck(hx('#fff1a0'), 12);
  });
  def('redstone', (P) => {
    P.fill([0, 0, 0, 0]);
    const dark = hx('#650000'), red = hx('#b20b0b'), bright = hx('#e32b20');
    for (const point of [[4,5],[7,4],[10,6],[5,9],[9,10],[12,9],[7,12]]) {
      P.rect(point[0], point[1], 3, 2, dark); P.px(point[0] + 1, point[1], red);
    }
    P.px(8, 5, bright); P.px(6, 10, bright);
  });
  def('oak_door_lower', (P) => {
    P.noise(C.wood); P.border(hx('#5b3d20'));
    P.rect(2, 2, 12, 12, hx('#8f6d3f')); P.rect(3, 3, 10, 5, hx('#ad8951'));
    P.rect(3, 10, 10, 3, hx('#79572f')); P.rect(11, 2, 2, 2, hx('#d6b85b'));
  });
  def('oak_door_upper', (P) => {
    P.noise(C.wood); P.border(hx('#5b3d20'));
    const clear = [0, 0, 0, 0];
    P.rect(2, 2, 5, 5, clear); P.rect(9, 2, 5, 5, clear);
    P.rect(2, 9, 5, 5, clear); P.rect(9, 9, 5, 5, clear);
  });
  def('oak_door', (P) => {
    P.noise(C.wood); P.border(hx('#5b3d20'));
    P.rect(2, 2, 12, 5, hx('#a7834d')); P.rect(2, 9, 12, 5, hx('#8f6d3f'));
    P.rect(7, 1, 2, 14, hx('#684925')); P.rect(11, 8, 2, 2, hx('#d6b85b'));
  });
  def('oak_trapdoor', (P) => {
    P.noise(C.wood); P.border(hx('#5b3d20')); P.rect(3, 3, 4, 4, hx('#6c4d2a'));
    P.rect(9, 3, 4, 4, hx('#6c4d2a')); P.rect(3, 9, 4, 4, hx('#6c4d2a')); P.rect(9, 9, 4, 4, hx('#6c4d2a'));
  });
  def('iron_door_lower', (P) => {
    P.noise([hx('#b8bcbc'), hx('#c9cccc'), hx('#9fa4a5')]); P.border(hx('#737879'));
    P.rect(2, 2, 12, 12, hx('#a8adae')); P.rect(3, 3, 10, 4, hx('#737d7e'));
    P.rect(3, 9, 10, 4, hx('#858d8e')); P.rect(12, 2, 2, 2, hx('#555b5c'));
  });
  def('iron_door_upper', (P) => {
    P.noise([hx('#b8bcbc'), hx('#c9cccc'), hx('#9fa4a5')]); P.border(hx('#737879'));
    const clear = [0, 0, 0, 0];
    P.rect(3, 3, 4, 4, clear); P.rect(9, 3, 4, 4, clear);
    P.rect(3, 9, 4, 4, clear); P.rect(9, 9, 4, 4, clear);
  });
  def('iron_door', (P) => {
    P.noise([hx('#b8bcbc'), hx('#c9cccc'), hx('#9fa4a5')]); P.border(hx('#737879'));
    P.rect(2, 2, 5, 5, hx('#657071')); P.rect(9, 2, 5, 5, hx('#657071'));
    P.rect(2, 9, 12, 5, hx('#a8adae')); P.rect(12, 11, 2, 2, hx('#5d6262'));
  });
  def('iron_trapdoor', (P) => {
    P.noise([hx('#b8bcbc'), hx('#c9cccc'), hx('#9fa4a5')]); P.border(hx('#737879'));
    P.rect(3, 3, 10, 10, hx('#697273')); P.rect(5, 5, 6, 6, hx('#aeb3b3'));
  });
  def('oak_sign', (P) => {
    P.noise([hx('#aa854c'), hx('#9a7541'), hx('#b58f55')]);
    P.rect(0, 3, 16, 1, hx('#8e6938')); P.rect(0, 10, 16, 1, hx('#bc965c'));
    P.border(hx('#654824'));
  });
  def('redstone_wire', (P) => { P.fill(hx('#2b0808')); P.rect(0, 7, 16, 2, hx('#5b0808')); P.rect(7, 0, 2, 16, hx('#5b0808')); });
  def('redstone_wire_lit', (P) => { P.fill(hx('#5a0906')); P.rect(0, 7, 16, 2, hx('#e62a18')); P.rect(7, 0, 2, 16, hx('#e62a18')); });
  def('redstone_torch_on', (P) => {
    P.fill(hx('#7a4d28')); P.rect(4, 0, 8, 5, hx('#c81f18')); P.rect(6, 1, 4, 3, hx('#ff5b32'));
  });
  def('redstone_torch_off', (P) => { P.fill(hx('#6a4527')); P.rect(4, 0, 8, 5, hx('#65110e')); });
  def('repeater', (P) => {
    P.noise([hx('#c9c7be'), hx('#aaa89f'), hx('#d8d6cd')]); P.border(hx('#77746e'));
    P.rect(7, 1, 2, 14, hx('#73100c')); P.rect(3, 5, 4, 4, hx('#4d4b49')); P.rect(10, 9, 4, 4, hx('#4d4b49'));
  });
  def('repeater_lit', (P) => {
    P.noise([hx('#d2d0c7'), hx('#b4b2aa')]); P.border(hx('#77746e'));
    P.rect(7, 1, 2, 14, hx('#ef2c1c')); P.rect(3, 5, 4, 4, hx('#d44524')); P.rect(10, 9, 4, 4, hx('#d44524'));
  });
  def('piston_top', (P) => { P.noise(C.wood); P.border(hx('#626262')); P.rect(3, 3, 10, 10, hx('#a98b55')); P.border(hx('#646464')); });
  def('piston_side', (P) => { P.noise(C.stone); P.rect(4, 0, 8, 16, hx('#9a7b49')); P.rect(6, 0, 4, 16, hx('#c09d61')); });
  def('netherrack', (P) => { P.noise([hx('#6c2928'), hx('#7d3331'), hx('#55201f'), hx('#8e3c39')]); P.blobs(hx('#451817'), 5, 4); });
  def('nether_bricks', (P) => { P.fill(hx('#31191b')); for (let y = 1; y < 16; y += 5) P.rect(0, y, 16, 1, hx('#190e10')); for (let x = 3; x < 16; x += 8) P.rect(x, 0, 1, 16, hx('#1b0e10')); });
  def('nether_portal', (P) => { P.noise([A(hx('#6f24b5'), 190), A(hx('#8e3bd0'), 205), A(hx('#4c167f'), 185)]); P.speck(A(hx('#d18cff'), 230), 28); });
  def('end_stone', (P) => { P.noise([hx('#d9dda0'), hx('#c7ce8c'), hx('#e3e5af'), hx('#b9c17b')]); P.blobs(hx('#9ea767'), 4, 4); });
  def('end_portal_frame', (P) => { P.noise([hx('#789f75'), hx('#668962'), hx('#8cad86')]); P.border(hx('#c6d8a5')); P.rect(5, 5, 6, 6, hx('#1b3225')); });
  def('end_portal', (P) => { P.fill(hx('#090b12')); P.speck(hx('#bfd5df'), 26); P.speck(hx('#6c8fa3'), 18); });
  def('brewing_stand', (P) => { P.fill(hx('#47413d')); P.rect(2, 12, 12, 3, hx('#7b736d')); P.rect(7, 2, 2, 11, hx('#c08b39')); P.rect(4, 5, 8, 2, hx('#a66b2d')); });
  def('dragon_egg', (P) => { P.noise([hx('#17101f'), hx('#24142e'), hx('#0d0a12')]); P.speck(hx('#8d4ab3'), 24); P.speck(hx('#c078e5'), 8); });
  def('bell', (P) => { P.noise([hx('#c99221'), hx('#e0ad31'), hx('#a86f14')]); P.border(hx('#70470c')); P.rect(4, 2, 8, 2, hx('#f1cf57')); });
  def('composter', (P) => { P.noise([hx('#7b542d'), hx('#94683a'), hx('#64421f')]); P.rect(2, 0, 2, 16, hx('#b1844e')); P.rect(12, 0, 2, 16, hx('#b1844e')); });
  def('lectern', (P) => { P.noise([hx('#8a6032'), hx('#a47742'), hx('#6e4824')]); P.rect(2, 2, 12, 3, hx('#c49a5e')); P.rect(5, 1, 6, 2, hx('#e0c17d')); });
  def('grindstone', (P) => { P.noise([hx('#9a9b96'), hx('#b4b5af'), hx('#73746f')]); P.border(hx('#555650')); P.rect(1, 7, 14, 2, hx('#d0d0c9')); });
  def('smithing_table_top', (P) => { P.noise([hx('#30383b'), hx('#424b4e'), hx('#20282a')]); P.border(hx('#121719')); P.rect(3, 3, 10, 10, hx('#5c6a6e')); });
  def('smithing_table_side', (P) => { P.noise([hx('#553921'), hx('#684b2c'), hx('#3f2b1a')]); P.rect(2, 2, 12, 5, hx('#30383b')); });
  def('smoker_top', (P) => { P.noise([hx('#5b5650'), hx('#6d6861'), hx('#48443f')]); P.border(hx('#302d2a')); P.rect(5, 5, 6, 6, hx('#262422')); });
  def('smoker_side', (P) => { P.noise([hx('#5e554b'), hx('#74685a'), hx('#493f37')]); P.rect(2, 3, 12, 2, hx('#8b7c69')); P.rect(2, 11, 12, 2, hx('#352f2a')); });
  def('smoker_front', (P) => { P.noise([hx('#55514c'), hx('#68635c'), hx('#403d39')]); P.border(hx('#2b2927')); P.rect(3, 5, 10, 7, hx('#1f1e1d')); P.rect(5, 7, 6, 3, hx('#6e4930')); });
  def('__white', (P) => P.fill([255, 255, 255, 255]));
  def('entity_shadow', (P) => {
    P.fill([0, 0, 0, 0]);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const dx = (x + 0.5 - 8) / 7.5, dy = (y + 0.5 - 8) / 7.5;
      const distance = Math.hypot(dx, dy);
      if (distance < 1) P.px(x, y, [255, 255, 255, Math.round((1 - distance) * 185)]);
    }
  });

  // ================= items =================
  def('stick', (P) => {
    P.fill([0, 0, 0, 0]);
    for (let i = 0; i < 8; i++) {
      P.px(4 + i, 11 - i, hx('#6b4a24'));
      P.px(5 + i, 11 - i, hx('#8a6a3d'));
    }
  });
  function lumpItem(base, hi, dark) {
    return (P) => {
      P.fill([0, 0, 0, 0]);
      for (let y = 4; y < 13; y++) for (let x = 4; x < 13; x++) {
        const d = Math.hypot(x - 8, y - 8.5);
        if (d < 4.2) P.px(x, y, P.rand() < 0.25 ? dark : base);
      }
      P.px(6, 6, hi); P.px(7, 6, hi); P.px(6, 7, hi);
    };
  }
  def('coal', lumpItem(hx('#232323'), hx('#4d4d4d'), hx('#0f0f0f')));
  def('charcoal', lumpItem(hx('#33261a'), hx('#59422c'), hx('#1c130a')));
  function ingotItem(base, hi, dark) {
    return (P) => {
      P.fill([0, 0, 0, 0]);
      for (let y = 0; y < 4; y++) {
        P.rect(3 + (3 - y), 6 + y, 8 + y * 0.5 | 0, 1, base);
      }
      P.rect(3, 10, 10, 2, dark);
      P.rect(6, 6, 4, 1, hi);
      P.px(4, 9, hi);
    };
  }
  def('iron_ingot', ingotItem(hx('#d8d8d8'), hx('#ffffff'), hx('#9a9a9a')));
  def('gold_ingot', ingotItem(hx('#e9c531'), hx('#fdf55f'), hx('#b08d1c')));
  def('diamond', (P) => {
    P.fill([0, 0, 0, 0]);
    const c = hx('#4aedd9'), hi = hx('#c9fcf4'), dk = hx('#1fae9c');
    for (let y = 0; y < 9; y++) {
      const half = y < 3 ? 2 + y : 8 - y;
      for (let x = 8 - half; x <= 7 + half; x++) P.px(x, 4 + y, c);
    }
    P.px(6, 5, hi); P.px(7, 5, hi); P.px(5, 6, hi);
    P.px(9, 10, dk); P.px(8, 11, dk); P.px(7, 12, dk);
  });
  def('ender_pearl', lumpItem(hx('#1e756c'), hx('#53b8a8'), hx('#103f3b')));
  def('blaze_powder', lumpItem(hx('#e8a423'), hx('#ffe36a'), hx('#9c5b12')));
  def('emerald', lumpItem(hx('#21b85b'), hx('#8bffc0'), hx('#0b7033')));
  def('slime_ball', lumpItem(hx('#69c55a'), hx('#b3f59d'), hx('#3d8c35')));
  def('nether_wart', lumpItem(hx('#8e151c'), hx('#d54045'), hx('#4f0a0e')));
  def('blaze_rod', (P) => { P.fill([0,0,0,0]); for (let i = 0; i < 11; i++) { P.px(3 + i, 13 - i, hx('#c36d18')); P.px(4 + i, 13 - i, hx('#ffc344')); } });
  def('eye_of_ender', (P) => { P.fill([0,0,0,0]); P.rect(3,5,10,6,hx('#50a678')); P.rect(6,6,4,4,hx('#d8dc72')); P.rect(7,7,2,2,hx('#17162b')); });
  def('glass_bottle', (P) => { P.fill([0,0,0,0]); P.rect(6,2,4,3,hx('#b9d9dc')); P.rect(4,5,8,8,A(hx('#a8d8df'),150)); P.border(A(hx('#d8f5f5'),210)); });
  def('water_bottle', (P) => { P.fill([0,0,0,0]); P.rect(6,2,4,3,hx('#c9e5e8')); P.rect(4,5,8,8,A(hx('#4a87df'),210)); P.rect(5,5,6,3,A(hx('#bce9ff'),190)); });
  def('awkward_potion', (P) => { P.fill([0,0,0,0]); P.rect(6,2,4,3,hx('#c9e5e8')); P.rect(4,5,8,8,A(hx('#a742c2'),220)); P.rect(5,5,6,2,A(hx('#e697f2'),210)); });
  def('healing_potion', (P) => { P.fill([0,0,0,0]); P.rect(6,2,4,3,hx('#c9e5e8')); P.rect(4,5,8,8,A(hx('#d92751'),230)); P.rect(5,5,6,2,A(hx('#ff9daf'),220)); });
  def('apple', (P) => {
    P.fill([0, 0, 0, 0]);
    const r = hx('#d23b2e'), dr = hx('#a5271c'), hi = hx('#f57a6a');
    for (let y = 5; y < 14; y++) for (let x = 4; x < 13; x++) {
      const d = Math.hypot(x - 8, y - 9);
      if (d < 4.4) P.px(x, y, x > 9 ? dr : r);
    }
    P.px(5, 7, hi); P.px(6, 6, hi);
    P.px(8, 4, hx('#6b4a24')); P.px(8, 3, hx('#6b4a24'));
    P.px(9, 3, hx('#3a7a1e')); P.px(10, 3, hx('#4a8a2a'));
  });
  function meatItem(main, edge, cooked) {
    return (P) => {
      P.fill([0, 0, 0, 0]);
      for (let y = 4; y < 13; y++) for (let x = 3; x < 13; x++) {
        const d = Math.hypot((x - 8) * 0.9, y - 8.5);
        if (d < 4.4) P.px(x, y, P.rand() < 0.2 ? edge : main);
      }
      P.px(4, 11, hx('#f2ead8')); P.px(3, 12, hx('#f2ead8')); P.px(4, 12, hx('#e4d8be'));
      if (cooked) { P.rect(6, 6, 4, 1, sh(main, 0.7)); P.rect(5, 9, 5, 1, sh(main, 0.7)); }
    };
  }
  def('porkchop_raw', meatItem(hx('#f2a0a0'), hx('#e07878'), false));
  def('porkchop_cooked', meatItem(hx('#b57046'), hx('#96552f'), true));
  def('beef_raw', meatItem(hx('#b03434'), hx('#8d2323'), false));
  def('beef_cooked', meatItem(hx('#7d4a26'), hx('#5f351a'), true));
  def('mutton_raw', meatItem(hx('#d96868'), hx('#b84848'), false));
  def('mutton_cooked', meatItem(hx('#9c5c33'), hx('#7d4423'), true));
  def('rotten_flesh', (P) => {
    P.fill([0, 0, 0, 0]);
    for (let y = 4; y < 13; y++) for (let x = 3; x < 13; x++) {
      const d = Math.hypot((x - 8) * 0.9, y - 8.5);
      if (d < 4.5) P.px(x, y, P.rand() < 0.3 ? hx('#5d7a3a') : hx('#8d5a3a'));
    }
    P.px(6, 7, [0, 0, 0, 0]); P.px(10, 9, [0, 0, 0, 0]);
  });
  def('gunpowder', (P) => {
    P.fill([0, 0, 0, 0]);
    for (let y = 8; y < 13; y++) {
      const half = (13 - y) + 2;
      for (let x = 8 - half; x <= 7 + half; x++) {
        if (P.rand() < 0.85) P.px(x, y, P.rand() < 0.3 ? hx('#4d4d4d') : hx('#6e6e6e'));
      }
    }
    P.speck(hx('#8d8d8d'), 6);
  });
  def('shears', (P) => {
    P.fill([0, 0, 0, 0]);
    const metal = hx('#c9ced1'), hi = hx('#f2f5f6'), dark = hx('#747b80');
    for (let i = 0; i < 7; i++) {
      P.px(5 + i, 9 - i, metal);
      P.px(6 + i, 9 - i, i < 3 ? hi : dark);
    }
    for (let y = 9; y < 14; y++) {
      P.px(4, y, dark); P.px(5, y, metal);
      P.px(9, y, dark); P.px(10, y, metal);
    }
    P.rect(3, 12, 4, 3, dark);
    P.rect(8, 12, 4, 3, dark);
    P.rect(4, 13, 2, 1, [0, 0, 0, 0]);
    P.rect(9, 13, 2, 1, [0, 0, 0, 0]);
    P.px(7, 9, hi);
  });
  def('flint', lumpItem(hx('#565b60'), hx('#9aa0a5'), hx('#2d3034')));
  def('leather', (P) => {
    P.fill([0, 0, 0, 0]);
    P.rect(4, 3, 8, 10, hx('#9b5d2d')); P.rect(3, 5, 2, 5, hx('#7b431f')); P.rect(11, 5, 2, 6, hx('#6c391b'));
    P.px(5, 3, hx('#c27a3b')); P.px(10, 4, hx('#b36d34')); P.px(6, 12, hx('#6c391b')); P.px(9, 13, hx('#7b431f'));
  });
  def('string', (P) => {
    P.fill([0, 0, 0, 0]);
    const c = hx('#e8e8df'), d = hx('#a9aaa4');
    for (let i = 0; i < 10; i++) { P.px(3 + i, 5 + ((i * 3) % 5), c); if (i > 1) P.px(3 + i, 10 - ((i * 2) % 4), d); }
    P.px(4, 4, c); P.px(12, 11, c);
  });
  def('feather', (P) => {
    P.fill([0, 0, 0, 0]);
    for (let i = 0; i < 10; i++) { P.px(3 + i, 13 - i, hx('#dddcd3')); P.px(4 + i, 13 - i, hx('#faf9ee')); }
    P.rect(5, 5, 2, 5, hx('#b7c0c6')); P.rect(7, 3, 2, 5, hx('#e9edf0')); P.px(4, 12, hx('#7c6b4f'));
  });
  def('bone', (P) => {
    P.fill([0, 0, 0, 0]);
    for (let i = 0; i < 8; i++) { P.px(4 + i, 11 - i, hx('#e7e1c9')); P.px(5 + i, 11 - i, hx('#fffbea')); }
    P.rect(3, 11, 3, 3, hx('#d2cbae')); P.rect(11, 2, 3, 3, hx('#f1ecd7'));
  });
  def('bone_meal', lumpItem(hx('#e6e2d3'), hx('#ffffff'), hx('#b8b4a7')));
  def('egg', (P) => {
    P.fill([0, 0, 0, 0]);
    for (let y = 3; y < 14; y++) for (let x = 4; x < 12; x++) {
      const dx = (x - 7.5) / (y < 7 ? 3.2 : 4), dy = (y - 8.5) / 5.5;
      if (dx * dx + dy * dy < 1) P.px(x, y, x < 6 ? hx('#fffdf0') : hx('#dedbc9'));
    }
  });
  def('wheat_seeds', (P) => {
    P.fill([0, 0, 0, 0]);
    for (const q of [[5,11],[7,8],[9,12],[11,7],[4,6],[8,4]]) { P.px(q[0], q[1], hx('#668d2b')); P.px(q[0] + 1, q[1], hx('#93b84a')); }
  });
  def('wheat', (P) => {
    P.fill([0, 0, 0, 0]);
    P.rect(7, 4, 2, 10, hx('#b98f2e')); P.rect(8, 4, 1, 10, hx('#e0bc52'));
    for (let y = 3; y < 11; y += 2) { P.rect(4, y, 4, 2, hx('#d1aa42')); P.rect(9, y + 1, 4, 2, hx('#c39a35')); }
  });
  def('bread', (P) => {
    P.fill([0, 0, 0, 0]);
    P.rect(3, 6, 10, 7, hx('#b9762d')); P.rect(4, 5, 8, 2, hx('#e0a24e')); P.rect(4, 7, 8, 4, hx('#d4943e'));
    P.rect(5, 6, 1, 3, hx('#f1bd64')); P.rect(8, 5, 1, 3, hx('#f1bd64')); P.rect(11, 6, 1, 3, hx('#f1bd64'));
  });
  def('carrot', (P) => {
    P.fill([0, 0, 0, 0]); P.rect(7, 5, 3, 8, hx('#e8751d')); P.rect(6, 6, 5, 4, hx('#f18b27'));
    P.px(8, 13, hx('#b94f12')); P.rect(5, 2, 2, 5, hx('#4e8c2f')); P.rect(9, 1, 2, 5, hx('#67a840')); P.px(7, 4, hx('#72b448'));
  });
  function potatoItem(name, cooked) {
    def(name, (P) => {
      P.fill([0, 0, 0, 0]);
      const base = cooked ? hx('#c88c3d') : hx('#b59a63'), dark = cooked ? hx('#8a5624') : hx('#7f6a44');
      for (let y = 4; y < 13; y++) for (let x = 4; x < 13; x++) if (Math.hypot(x - 8, y - 8.5) < 4.3) P.px(x, y, P.rand() < 0.18 ? dark : base);
      P.px(6, 6, cooked ? hx('#f0bd67') : hx('#d8c08d'));
    });
  }
  potatoItem('potato', false); potatoItem('baked_potato', true);
  def('chicken_raw', meatItem(hx('#e9b5a3'), hx('#c78676'), false));
  def('chicken_cooked', meatItem(hx('#b9793d'), hx('#805126'), true));
  function fishItem(name, cooked) {
    def(name, (P) => {
      P.fill([0, 0, 0, 0]);
      const base = cooked ? hx('#b17848') : hx('#5e91a2'), hi = cooked ? hx('#d8a36b') : hx('#8dc3ce');
      P.rect(4, 6, 8, 6, base); P.rect(2, 7, 3, 4, hi); P.px(12, 8, hi); P.px(13, 9, base);
      P.px(10, 7, hx('#101820')); P.px(4, 5, hi); P.px(4, 12, hi);
    });
  }
  fishItem('fish_raw', false); fishItem('fish_cooked', true);
  def('golden_apple', (P) => {
    P.fill([0, 0, 0, 0]);
    for (let y = 5; y < 14; y++) for (let x = 4; x < 13; x++) if (Math.hypot(x - 8, y - 9) < 4.4) P.px(x, y, x > 9 ? hx('#c28a13') : hx('#f0c52e'));
    P.px(5, 7, hx('#fff37a')); P.px(6, 6, hx('#fff37a')); P.px(8, 3, hx('#6b4a24')); P.rect(9, 3, 2, 1, hx('#e8cb38'));
  });
  def('paper', (P) => { P.fill([0, 0, 0, 0]); P.rect(3, 3, 10, 11, hx('#eee9d6')); P.rect(4, 4, 8, 1, hx('#fffdf3')); P.rect(5, 7, 6, 1, hx('#c8c2ae')); P.rect(5, 10, 5, 1, hx('#c8c2ae')); });
  def('book', (P) => { P.fill([0, 0, 0, 0]); P.rect(3, 3, 10, 11, hx('#6b321f')); P.rect(5, 4, 7, 9, hx('#e8dfbd')); P.rect(4, 3, 2, 11, hx('#9b4a2e')); P.rect(6, 6, 5, 1, hx('#8b7d61')); });
  def('clay_ball', lumpItem(hx('#9aa3ad'), hx('#c5ccd2'), hx('#737d87')));
  def('brick', ingotItem(hx('#a54834'), hx('#d16b51'), hx('#6f2e24')));
  def('glowstone_dust', lumpItem(hx('#d6a543'), hx('#fff09b'), hx('#916625')));
  def('lapis_lazuli', lumpItem(hx('#2053b7'), hx('#5b89e1'), hx('#102d70')));
  function bucketItem(name, liquid) {
    def(name, (P) => {
      P.fill([0, 0, 0, 0]);
      const metal = hx('#aeb5b8'), hi = hx('#e8edef'), dk = hx('#666d71');
      P.rect(4, 5, 8, 8, metal); P.rect(3, 4, 10, 2, hi); P.rect(5, 12, 6, 2, dk);
      P.px(3, 6, dk); P.px(12, 6, dk); P.rect(5, 3, 6, 1, dk);
      if (liquid) { P.rect(5, 6, 6, 5, liquid === 'water' ? hx('#3979d2') : hx('#e46b17')); P.rect(5, 6, 6, 1, liquid === 'water' ? hx('#72a8ed') : hx('#ffd044')); }
    });
  }
  bucketItem('bucket'); bucketItem('water_bucket', 'water'); bucketItem('lava_bucket', 'lava');
  def('flint_steel', (P) => {
    P.fill([0, 0, 0, 0]);
    P.rect(4, 4, 3, 9, hx('#44484b')); P.rect(6, 3, 6, 3, hx('#c6cbcd')); P.rect(10, 5, 3, 6, hx('#8a9093'));
    P.px(11, 3, hx('#f3f5f5')); P.px(5, 12, hx('#222629'));
  });
  def('bow', (P) => {
    P.fill([0, 0, 0, 0]);
    const wood = hx('#8b5a2b'), hi = hx('#bd8240'), line = hx('#e5e2d6');
    for (let y = 2; y < 14; y++) { const x = y < 8 ? 4 + ((y - 2) >> 2) : 5 - ((y - 8) >> 2); P.px(x, y, wood); P.px(x + 1, y, hi); }
    for (let y = 3; y < 13; y++) P.px(11, y, line); P.px(10, 2, line); P.px(10, 13, line);
  });
  def('arrow', (P) => {
    P.fill([0, 0, 0, 0]);
    for (let i = 0; i < 10; i++) { P.px(3 + i, 12 - i, hx('#8a6a3d')); P.px(4 + i, 12 - i, hx('#b38a50')); }
    P.rect(12, 2, 3, 3, hx('#999fa2')); P.px(14, 1, hx('#d9dddf')); P.rect(2, 11, 3, 1, hx('#f2f2e8')); P.rect(3, 13, 3, 1, hx('#d5d5cd'));
  });
  def('fishing_rod', (P) => {
    P.fill([0, 0, 0, 0]);
    for (let i = 0; i < 10; i++) { P.px(3 + i, 13 - i, hx('#6b4a24')); P.px(4 + i, 13 - i, hx('#8a6a3d')); }
    for (let y = 4; y < 13; y++) P.px(13, y, hx('#d8d8d0')); P.px(12, 13, hx('#d33c32'));
  });

  const ARMOR_COLORS = {
    leather: [hx('#8b572e'), hx('#c17a42')], gold: [hx('#e9c531'), hx('#fff071')],
    iron: [hx('#cbd0d2'), hx('#f5f7f7')], diamond: [hx('#39cfc1'), hx('#9ff2e9')],
  };
  function armorDef(part, material) {
    def('armor_' + part + '_' + material, (P) => {
      P.fill([0, 0, 0, 0]);
      const c = ARMOR_COLORS[material][0], hi = ARMOR_COLORS[material][1], dk = sh(c, 0.62);
      if (part === 'helmet') { P.rect(3, 3, 10, 8, c); P.rect(4, 4, 8, 2, hi); P.rect(5, 8, 6, 4, [0,0,0,0]); P.rect(3, 10, 2, 3, dk); P.rect(11, 10, 2, 3, dk); }
      else if (part === 'chestplate') { P.rect(5, 3, 6, 11, c); P.rect(2, 4, 4, 5, c); P.rect(10, 4, 4, 5, c); P.rect(6, 4, 4, 2, hi); P.rect(6, 12, 4, 2, dk); }
      else if (part === 'leggings') { P.rect(4, 3, 8, 5, c); P.rect(4, 7, 3, 7, c); P.rect(9, 7, 3, 7, c); P.rect(5, 4, 6, 2, hi); P.rect(7, 8, 2, 4, [0,0,0,0]); }
      else { P.rect(3, 8, 4, 6, c); P.rect(9, 8, 4, 6, c); P.rect(3, 12, 5, 2, dk); P.rect(8, 12, 5, 2, dk); P.px(4, 9, hi); P.px(10, 9, hi); }
    });
  }
  for (const material of ['leather', 'gold', 'iron', 'diamond'])
    for (const part of ['helmet', 'chestplate', 'leggings', 'boots']) armorDef(part, material);
  for (const material of ['leather', 'gold', 'iron', 'diamond']) {
    def('remote_armor_' + material, (P) => {
      const base = ARMOR_COLORS[material][0], hi = ARMOR_COLORS[material][1], dark = sh(base, 0.68);
      P.noise([base, base, hi, dark]);
      P.rect(0, 0, 16, 2, hi);
      P.rect(0, 14, 16, 2, dark);
      for (let i = 2; i < 14; i += 4) P.px(i, i - 1, hi);
    });
    for (const face of ['front', 'back', 'left', 'right', 'top', 'bottom']) {
      def('remote_armor_' + material + '_' + face, (P) => {
        const base = ARMOR_COLORS[material][0], hi = ARMOR_COLORS[material][1];
        const factor = face === 'top' ? 1.08 : face === 'bottom' ? 0.58 : (face === 'left' || face === 'right') ? 0.78 : 0.92;
        const tone = sh(base, factor), dark = sh(base, factor * 0.68), light = sh(hi, Math.min(1.15, factor));
        P.noise([tone, tone, light, dark]);
        if (face === 'front') { P.rect(3, 2, 10, 2, light); P.rect(6, 8, 4, 6, dark); }
        else if (face === 'back') { P.rect(7, 1, 2, 14, dark); P.rect(2, 12, 12, 2, sh(tone, 0.8)); }
        else if (face === 'top') P.rect(2, 2, 12, 12, tone);
        else if (face === 'bottom') P.border(dark);
        else P.rect(face === 'left' ? 12 : 2, 1, 2, 14, light);
      });
    }
  }
  def('remote_armor_glint', (P) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      if ((x + y * 2) % 9 < 2) P.px(x, y, [155, 78, 220, 190]);
    }
  });
  def('creeper_charge', (P) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      if ((x * 2 + y) % 7 < 2) P.px(x, y, [88, 154, 255, 190]);
    }
  });

  // ================= tools =================
  const TIER_COL = {
    wood: [hx('#8a6a3d'), hx('#a5875a')],
    stone: [hx('#7d7d7d'), hx('#9a9a9a')],
    iron: [hx('#d8d8d8'), hx('#f5f5f5')],
    gold: [hx('#e9c531'), hx('#fdf55f')],
    diamond: [hx('#4aedd9'), hx('#a5f7ec')],
  };
  const HANDLE = hx('#6b4a24'), HANDLE_HI = hx('#8a6a3d');

  function drawHandle(P, cells) {
    for (const [x, y] of cells) { P.px(x, y, HANDLE); P.px(x + 1, y, HANDLE_HI); }
  }
  function toolDef(kind, tier) {
    def(kind + '_' + tier, (P) => {
      P.fill([0, 0, 0, 0]);
      const [c, hi] = TIER_COL[tier];
      const dk = sh(c, 0.7);
      if (kind === 'pickaxe') {
        drawHandle(P, [[4, 12], [5, 11], [6, 10], [7, 9], [8, 8], [9, 7], [10, 6]]);
        for (let x = 4; x <= 11; x++) P.px(x, 3, c);
        P.px(5, 4, c); P.px(4, 4, c); P.px(3, 5, c); P.px(3, 6, dk); P.px(2, 7, dk);
        P.px(11, 4, c); P.px(12, 4, c); P.px(12, 5, c); P.px(13, 6, dk); P.px(13, 7, dk);
        P.px(6, 3, hi); P.px(7, 3, hi); P.px(8, 3, hi);
        P.px(4, 2, hi); P.px(11, 2, hi);
      } else if (kind === 'axe') {
        drawHandle(P, [[4, 12], [5, 11], [6, 10], [7, 9], [8, 8], [9, 7]]);
        P.rect(8, 2, 3, 2, c);
        P.rect(6, 3, 4, 3, c);
        P.rect(5, 4, 3, 4, c);
        P.px(5, 4, hi); P.px(6, 3, hi); P.px(8, 2, hi);
        P.px(5, 7, dk); P.px(6, 6, dk); P.px(10, 3, dk);
        P.px(11, 3, c); P.px(11, 4, dk);
      } else if (kind === 'shovel') {
        drawHandle(P, [[4, 12], [5, 11], [6, 10], [7, 9], [8, 8], [9, 7], [10, 6]]);
        P.rect(10, 2, 4, 4, c);
        P.px(10, 2, hi); P.px(11, 2, hi); P.px(10, 3, hi);
        P.px(13, 5, dk); P.px(13, 4, dk); P.px(12, 5, dk);
        P.px(9, 5, c); P.px(10, 5, c);
      } else if (kind === 'sword') {
        for (let i = 0; i < 8; i++) {
          P.px(6 + i, 9 - i, c);
          P.px(7 + i, 9 - i, i === 7 ? hi : dk);
          if (i < 7) P.px(6 + i, 8 - i, hi);
        }
        P.px(5, 10, hx('#4a4a4a')); P.px(6, 11, hx('#4a4a4a')); P.px(4, 9, hx('#4a4a4a')); P.px(5, 12, HANDLE);
        P.px(4, 12, HANDLE); P.px(3, 13, HANDLE); P.px(4, 13, HANDLE_HI); P.px(2, 14, HANDLE);
      } else if (kind === 'hoe') {
        drawHandle(P, [[4, 12], [5, 11], [6, 10], [7, 9], [8, 8], [9, 7], [10, 6]]);
        P.rect(8, 3, 6, 2, c); P.rect(8, 4, 2, 3, c);
        P.px(9, 3, hi); P.px(10, 3, hi); P.px(13, 4, dk);
      }
    });
  }
  for (const kind of ['pickaxe', 'axe', 'shovel', 'sword', 'hoe'])
    for (const tier of ['wood', 'stone', 'iron', 'gold', 'diamond'])
      toolDef(kind, tier);

  // ================= first-person player arm =================
  const ARM_SKIN = [hx('#c88b68'), hx('#d99a75'), hx('#b97858'), hx('#e3aa84')];
  const ARM_SLEEVE = [hx('#2f6f9f'), hx('#347baa'), hx('#285d87'), hx('#438bb5')];
  for (const face of ['front', 'back', 'left', 'right', 'top', 'bottom']) {
    def('player_arm_' + face, (P) => {
      if (face === 'top') {
        P.noise(ARM_SLEEVE);
      } else if (face === 'bottom') {
        P.noise(ARM_SKIN);
      } else {
        for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
          const cols = y < 7 ? ARM_SLEEVE : ARM_SKIN;
          P.px(x, y, cols[(P.rand() * cols.length) | 0]);
        }
        P.rect(0, 6, 16, 1, hx('#245575'));
      }
      if (face === 'front') {
        P.rect(4, 10, 2, 2, hx('#b16f52'));
        P.rect(10, 12, 2, 1, hx('#e0a17d'));
      }
    });
  }

  // ================= remote player skin =================
  const PLAYER_HAIR = [hx('#4b3024'), hx('#56372a'), hx('#3f281e'), hx('#62402f')];
  const PLAYER_HAIR_DARK = hx('#332018');
  function playerHair(P) {
    P.noise(PLAYER_HAIR);
    P.speck(PLAYER_HAIR_DARK, 20);
  }
  def('remote_player_face', (P) => {
    P.noise(ARM_SKIN);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 16; x++) P.px(x, y, PLAYER_HAIR[(x + y * 3) % PLAYER_HAIR.length]);
    P.rect(0, 3, 3, 5, PLAYER_HAIR[0]); P.rect(13, 3, 3, 5, PLAYER_HAIR_DARK);
    P.rect(3, 6, 3, 2, hx('#f5f5f2')); P.rect(10, 6, 3, 2, hx('#f5f5f2'));
    P.px(5, 7, hx('#315b8a')); P.px(10, 7, hx('#315b8a'));
    P.rect(6, 11, 4, 1, hx('#9f5f4b'));
  });
  def('remote_player_skin', (P) => {
    P.noise(ARM_SKIN);
    P.rect(0, 0, 16, 5, PLAYER_HAIR[0]);
    P.speck(PLAYER_HAIR_DARK, 16);
  });
  def('remote_player_head_back', playerHair);
  def('remote_player_head_left', (P) => {
    P.noise(ARM_SKIN);
    P.rect(0, 0, 16, 6, PLAYER_HAIR[0]);
    P.rect(0, 4, 4, 12, PLAYER_HAIR[2]);
    for (let i = 0; i < 12; i++) P.px((P.rand() * 16) | 0, (P.rand() * 6) | 0, PLAYER_HAIR_DARK);
  });
  def('remote_player_head_right', (P) => {
    P.noise(ARM_SKIN);
    P.rect(0, 0, 16, 6, PLAYER_HAIR[1]);
    P.rect(12, 4, 4, 12, PLAYER_HAIR[2]);
    for (let i = 0; i < 12; i++) P.px((P.rand() * 16) | 0, (P.rand() * 6) | 0, PLAYER_HAIR_DARK);
  });
  def('remote_player_head_top', playerHair);
  def('remote_player_head_bottom', (P) => {
    P.noise(ARM_SKIN.map(c => sh(c, 0.86)));
  });

  // The slightly larger second layer matches the classic skin hat/hair layer.
  def('remote_player_hair_front', (P) => {
    const fringe = [4, 5, 4, 6, 5, 4, 6, 5, 4, 5, 6, 4, 5, 6, 4, 5];
    for (let x = 0; x < 16; x++) for (let y = 0; y < fringe[x]; y++) {
      P.px(x, y, PLAYER_HAIR[(x + y) % PLAYER_HAIR.length]);
    }
    P.rect(0, 4, 2, 5, PLAYER_HAIR[2]);
    P.rect(14, 4, 2, 5, PLAYER_HAIR_DARK);
  });
  def('remote_player_hair_back', playerHair);
  def('remote_player_hair_left', (P) => {
    P.rect(0, 0, 16, 6, PLAYER_HAIR[0]);
    P.rect(0, 5, 5, 11, PLAYER_HAIR[2]);
    for (let i = 0; i < 8; i++) P.px((P.rand() * 16) | 0, (P.rand() * 6) | 0, PLAYER_HAIR_DARK);
  });
  def('remote_player_hair_right', (P) => {
    P.rect(0, 0, 16, 6, PLAYER_HAIR[1]);
    P.rect(11, 5, 5, 11, PLAYER_HAIR[2]);
    for (let i = 0; i < 8; i++) P.px((P.rand() * 16) | 0, (P.rand() * 6) | 0, PLAYER_HAIR_DARK);
  });
  def('remote_player_hair_top', playerHair);
  def('remote_player_hair_bottom', () => {});
  def('remote_player_body', (P) => {
    P.noise(ARM_SLEEVE);
    P.rect(0, 0, 16, 2, hx('#438bb5'));
    P.rect(7, 0, 2, 5, hx('#285d87'));
    P.rect(0, 14, 16, 2, hx('#245575'));
  });
  def('remote_player_leg', (P) => {
    P.noise([hx('#3a3a6c'), hx('#50508d'), hx('#45457d'), hx('#30305d')]);
    P.rect(0, 13, 16, 3, hx('#282842'));
  });

  // ================= mobs =================
  def('chicken_body', (P) => { P.noise([hx('#f0eee4'), hx('#d9d7cc'), hx('#fffdf4')]); P.rect(2, 9, 12, 2, hx('#c7c4b8')); });
  def('chicken_head', (P) => {
    P.noise([hx('#f4f1e8'), hx('#ddd9cf'), hx('#fffdf6')]);
    P.rect(3, 5, 2, 2, hx('#151515')); P.rect(11, 5, 2, 2, hx('#151515')); P.rect(7, 10, 2, 4, hx('#c52d25'));
  });
  def('chicken_head_side', (P) => {
    P.noise([hx('#f4f1e8'), hx('#ddd9cf'), hx('#fffdf6')]);
    P.rect(12, 3, 3, 10, hx('#e3dfd4'));
    P.rect(3, 12, 8, 2, hx('#ece8de'));
  });
  def('chicken_head_back', (P) => {
    P.noise([hx('#f1eee5'), hx('#d8d4ca'), hx('#fffdf6')]);
    P.rect(2, 12, 12, 2, hx('#d5d1c7'));
    P.rect(6, 3, 4, 2, hx('#fffdf8'));
  });
  def('chicken_head_top', (P) => {
    P.noise([hx('#fffdf6'), hx('#e8e4da'), hx('#f4f1e8')]);
    P.rect(3, 3, 10, 10, hx('#f7f4eb'));
    P.rect(6, 5, 4, 6, hx('#fffef9'));
  });
  def('chicken_head_bottom', (P) => {
    P.noise([hx('#ddd9cf'), hx('#ebe7dc'), hx('#d2cec4')]);
    P.rect(5, 3, 6, 10, hx('#e4e0d6'));
  });
  def('chicken_beak', (P) => { P.fill(hx('#e8a52b')); P.rect(1, 1, 14, 3, hx('#ffd05a')); P.border(hx('#a86d18')); });
  def('chicken_wattle', (P) => { P.noise([hx('#c52d25'), hx('#e04737'), hx('#8f1e1b')]); P.border(hx('#7b1917')); });
  def('chicken_leg', (P) => { P.noise([hx('#d79a2b'), hx('#f0b642'), hx('#a96d1f')]); });
  def('skeleton', (P) => {
    P.noise([hx('#c9c7b9'), hx('#e1dfd2'), hx('#aaa99f')]);
    P.rect(3, 5, 2, 2, hx('#242424')); P.rect(11, 5, 2, 2, hx('#242424')); P.rect(6, 10, 4, 2, hx('#696860'));
  });
  const DIRECTION_SHADE = { front: 1, back: 0.78, left: 0.86, right: 0.9, top: 1.08, bottom: 0.62 };
  function directionalMobTextures(prefix, parts, palette, decorate) {
    for (const part of parts) for (const face of ['front', 'back', 'left', 'right', 'top', 'bottom']) {
      def(prefix + '_' + part + '_' + face, (P) => {
        const factor = DIRECTION_SHADE[face];
        P.noise(palette.map(color => sh(color, factor)));
        if (decorate) decorate(P, part, face);
      });
    }
  }
  directionalMobTextures('chicken', ['body'], [hx('#f0eee4'), hx('#d9d7cc'), hx('#fffdf4')]);
  def('chicken_head_front', (P) => {
    P.noise([hx('#f4f1e8'), hx('#ddd9cf'), hx('#fffdf6')]);
    P.rect(3, 5, 2, 2, hx('#151515')); P.rect(11, 5, 2, 2, hx('#151515'));
  });
  def('chicken_head_left', (P) => P.noise([hx('#f4f1e8'), hx('#ddd9cf'), hx('#fffdf6')]));
  def('chicken_head_right', (P) => P.noise([hx('#f4f1e8'), hx('#ddd9cf'), hx('#fffdf6')]));
  for (const face of ['front', 'back', 'left', 'right', 'top', 'bottom']) {
    const factor = DIRECTION_SHADE[face];
    def('chicken_beak_' + face, (P) => P.noise([hx('#e8a52b'), sh(hx('#ffd05a'), factor), hx('#a86d18')]));
    def('chicken_wattle_' + face, (P) => P.noise([hx('#c52d25'), sh(hx('#e04737'), factor), hx('#8f1e1b')]));
    def('chicken_leg_' + face, (P) => P.noise([hx('#d79a2b'), sh(hx('#f0b642'), factor), hx('#a96d1f')]));
    def('chicken_wing_' + face, (P) => P.noise([hx('#f0eee4'), sh(hx('#fffdf4'), factor), hx('#c7c4b8')]));
  }
  directionalMobTextures('skeleton', ['head', 'body', 'limb'],
    [hx('#c9c7b9'), hx('#e1dfd2'), hx('#aaa99f')], (P, part, face) => {
      if (part === 'head' && face === 'front') {
        P.rect(3, 5, 3, 3, hx('#242424')); P.rect(10, 5, 3, 3, hx('#242424'));
        P.rect(5, 11, 6, 2, hx('#696860')); P.px(7, 9, hx('#575650')); P.px(8, 9, hx('#575650'));
      } else if (part === 'body' && (face === 'front' || face === 'back')) {
        for (let y = 3; y < 14; y += 3) P.rect(3, y, 10, 1, hx('#8f8e86'));
        P.rect(7, 1, 2, 15, hx('#aaa99f'));
      } else if (part === 'limb') P.rect(6, 0, 4, 16, hx('#dddace'));
    });
  def('spider_body', (P) => { P.noise([hx('#33251f'), hx('#241a17'), hx('#49332a')]); P.speck(hx('#684232'), 18); });
  def('spider_head', (P) => {
    P.noise([hx('#2d201c'), hx('#1c1513'), hx('#453029')]);
    for (const q of [[3,5],[6,4],[10,4],[12,6]]) { P.rect(q[0], q[1], 2, 2, hx('#b91919')); P.px(q[0], q[1], hx('#ff4a35')); }
  });
  def('spider_leg', (P) => { P.noise([hx('#2a1e1a'), hx('#3b2923'), hx('#181211')]); P.rect(0, 7, 16, 2, hx('#4b3028')); });
  function mobSkin(base, dark, light) {
    return { base, dark, light };
  }
  const SKINS = {
    pig: mobSkin(hx('#f0a5a2'), hx('#d98583'), hx('#f7bcb9')),
    cow: mobSkin(hx('#5d4433'), hx('#483426'), hx('#e8e2d8')),
    sheep: mobSkin(hx('#e6e2d5'), hx('#cfc9b8'), hx('#f5f2e8')),
    zombie: mobSkin(hx('#5d8f4c'), hx('#48713a'), hx('#70a55e')),
    creeper: mobSkin(hx('#4fa044'), hx('#3a7d31'), hx('#6ab85c')),
  };
  function mobNoise(P, sk) {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const r = P.rand();
      P.px(x, y, r < 0.18 ? sk.dark : r < 0.36 ? sk.light : sk.base);
    }
  }
  function mobPart(kind, part) {
    def(kind + '_' + part, (P) => {
      const sk = SKINS[kind];
      mobNoise(P, sk);
      if (kind === 'cow' && (part === 'body' || part === 'side')) {
        P.blobs(hx('#e8e2d8'), 3, 6);
      }
      if (kind === 'sheep' && part === 'face') {
        P.rect(4, 5, 8, 9, hx('#c9a87c'));
      }
      if (kind === 'cow' && part === 'leg') {
        P.rect(0, 12, 16, 4, hx('#8d8478'));
      }
      if (kind === 'zombie' && part === 'body') {
        for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
          const r = P.rand();
          P.px(x, y, r < 0.2 ? hx('#2a7a7a') : r < 0.4 ? hx('#3a9a9a') : hx('#338a8a'));
        }
      }
      if (kind === 'zombie' && part === 'leg') {
        for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
          const r = P.rand();
          P.px(x, y, r < 0.2 ? hx('#3a3a6c') : r < 0.4 ? hx('#50508d') : hx('#45457d'));
        }
      }
      if (part === 'face') {
        if (kind === 'pig') {
          P.px(3, 5, hx('#ffffff')); P.px(4, 5, hx('#101040'));
          P.px(11, 5, hx('#101040')); P.px(12, 5, hx('#ffffff'));
          P.rect(5, 8, 6, 4, hx('#d98583'));
          P.px(6, 9, hx('#8d4a48')); P.px(9, 9, hx('#8d4a48'));
          P.px(6, 10, hx('#8d4a48')); P.px(9, 10, hx('#8d4a48'));
        } else if (kind === 'cow') {
          P.px(3, 4, hx('#ffffff')); P.px(4, 4, hx('#101040'));
          P.px(11, 4, hx('#101040')); P.px(12, 4, hx('#ffffff'));
          P.rect(4, 9, 8, 6, hx('#d8cfc0'));
          P.px(5, 11, hx('#a89888')); P.px(10, 11, hx('#a89888'));
          P.px(1, 1, hx('#e8e2d8')); P.px(14, 1, hx('#e8e2d8'));
        } else if (kind === 'sheep') {
          P.px(4, 7, hx('#ffffff')); P.px(5, 7, hx('#101040'));
          P.px(10, 7, hx('#101040')); P.px(11, 7, hx('#ffffff'));
          P.rect(7, 10, 2, 2, hx('#b08d68'));
        } else if (kind === 'zombie') {
          P.rect(3, 5, 2, 2, hx('#101018'));
          P.rect(11, 5, 2, 2, hx('#101018'));
          P.rect(6, 10, 4, 2, hx('#2a4a22'));
          P.px(6, 10, hx('#101018')); P.px(9, 11, hx('#101018'));
        } else if (kind === 'creeper') {
          P.rect(3, 4, 3, 3, hx('#0d0d0d'));
          P.rect(10, 4, 3, 3, hx('#0d0d0d'));
          P.rect(6, 7, 4, 3, hx('#0d0d0d'));
          P.rect(5, 9, 2, 4, hx('#0d0d0d'));
          P.rect(9, 9, 2, 4, hx('#0d0d0d'));
          P.px(4, 5, hx('#2a2a2a')); P.px(11, 5, hx('#2a2a2a'));
        }
      }
    });
  }
  for (const kind of ['pig', 'cow', 'sheep', 'zombie', 'creeper'])
    for (const part of ['face', 'side', 'body', 'leg'])
      mobPart(kind, part);

  const ZOMBIE_TEX = {
    skin: [hx('#5d8f4c'), hx('#48713a'), hx('#70a55e'), hx('#3f7234')],
    shirt: [hx('#2a7a7a'), hx('#3a9a9a'), hx('#338a8a'), hx('#216969')],
    pants: [hx('#3a3a6c'), hx('#50508d'), hx('#45457d'), hx('#30305d')],
  };

  function zombieFace(part, face) {
    return (P) => {
      const faceShade = { front: 1, back: 0.76, left: 0.88, right: 0.72, top: 1.12, bottom: 0.58 }[face];
      const paint = (palette, x, y, shade) => {
        const col = palette[(P.rand() * palette.length) | 0];
        P.px(x, y, sh(col, faceShade * (shade || 1)));
      };
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        let palette = ZOMBIE_TEX.skin;
        if (part === 'body') palette = ZOMBIE_TEX.shirt;
        else if (part === 'leg') palette = ZOMBIE_TEX.pants;
        else if (part === 'arm') palette = y < 10 ? ZOMBIE_TEX.shirt : ZOMBIE_TEX.skin;
        paint(palette, x, y);
      }

      if (part === 'head') {
        if (face === 'front') {
          P.rect(3, 5, 2, 2, hx('#101018'));
          P.rect(11, 5, 2, 2, hx('#101018'));
          P.rect(6, 10, 4, 2, hx('#2a4a22'));
          P.px(6, 10, hx('#101018')); P.px(9, 11, hx('#101018'));
        } else if (face === 'back') {
          P.rect(2, 2, 12, 2, hx('#3d6d31'));
          P.rect(5, 8, 6, 2, hx('#4b7b3d'));
        } else if (face === 'left' || face === 'right') {
          P.rect(2, 5, 3, 2, hx('#24421e'));
        } else if (face === 'top') {
          P.rect(1, 1, 14, 3, hx('#3d6d31'));
        }
      } else if (part === 'body') {
        if (face === 'front') {
          P.rect(0, 0, 16, 2, hx('#4aa3a0'));
          P.rect(0, 12, 16, 2, hx('#215f65'));
          P.rect(7, 2, 2, 10, hx('#2e8584'));
        } else if (face === 'back') {
          P.rect(0, 1, 16, 2, hx('#236c70'));
          P.rect(0, 13, 16, 2, hx('#1c555b'));
        }
      } else if (part === 'arm') {
        P.rect(0, 9, 16, 1, hx('#215f65'));
        if (face === 'front') {
          P.rect(5, 11, 6, 3, hx('#5d8f4c'));
          P.rect(6, 13, 4, 1, hx('#70a55e'));
        }
      } else if (part === 'leg') {
        if (face === 'front') {
          P.rect(2, 1, 2, 13, hx('#5a5a9a'));
          P.rect(12, 1, 2, 13, hx('#2f2f59'));
          P.rect(0, 13, 16, 2, hx('#25254d'));
        } else if (face === 'back') {
          P.rect(0, 13, 16, 2, hx('#25254d'));
        }
      }
    };
  }
  for (const part of ['head', 'body', 'arm', 'leg'])
    for (const face of ['front', 'back', 'left', 'right', 'top', 'bottom'])
      def('zombie_' + part + '_' + face, zombieFace(part, face));

  const MOB_SURFACE = {
    pig: {
      body: [hx('#efa39f'), hx('#dd8e8b'), hx('#f7b7b2')],
      head: [hx('#efa39f'), hx('#d98784'), hx('#f7b7b2')],
      leg: [hx('#e89996'), hx('#cf7e7b'), hx('#f2aba7')],
      snout: [hx('#d98583'), hx('#c77573'), hx('#ed9c99')],
    },
    cow: {
      body: [hx('#604534'), hx('#493326'), hx('#765744')],
      head: [hx('#654938'), hx('#493326'), hx('#7b5c48')],
      leg: [hx('#594031'), hx('#3f2d23'), hx('#70513e')],
      snout: [hx('#d8cfc0'), hx('#b9ac9b'), hx('#ebe4d9')],
    },
    sheep: {
      wool: [hx('#e9e6da'), hx('#cfccbf'), hx('#f7f5ed')],
      body: [hx('#bd9271'), hx('#9d7558'), hx('#d2aa87')],
      head: [hx('#bd9271'), hx('#957052'), hx('#d2aa87')],
      leg: [hx('#a27b5d'), hx('#795940'), hx('#ba8e6b')],
    },
    creeper: {
      body: [hx('#4fa044'), hx('#397b31'), hx('#68b65b')],
      head: [hx('#53a748'), hx('#397b31'), hx('#6fbd62')],
      leg: [hx('#478f3d'), hx('#326d2b'), hx('#5da551')],
    },
  };

  function mobSurface(kind, part, face) {
    return (P) => {
      const faceShade = { front: 1, back: 0.82, left: 0.91, right: 0.78, top: 1.1, bottom: 0.62 }[face];
      const palette = MOB_SURFACE[kind][part].map(c => sh(c, faceShade));
      P.noise(palette);

      if (kind === 'cow' && part === 'body' && face !== 'top' && face !== 'bottom') {
        P.blobs(sh(hx('#e8e2d8'), faceShade), 5, 8);
        P.blobs(sh(hx('#f3eee6'), faceShade), 2, 5);
      }
      if (kind === 'sheep' && part === 'wool') {
        P.blobs(sh(hx('#ffffff'), faceShade), 5, 5);
        P.speck(sh(hx('#bbb8ac'), faceShade), 14);
      }

      if (part === 'head' && face === 'front') {
        if (kind === 'pig') {
          P.rect(3, 5, 2, 2, hx('#f7efea')); P.rect(11, 5, 2, 2, hx('#f7efea'));
          P.px(4, 6, hx('#171425')); P.px(11, 6, hx('#171425'));
        } else if (kind === 'cow') {
          P.rect(2, 5, 3, 2, hx('#f5f1e9')); P.rect(11, 5, 3, 2, hx('#f5f1e9'));
          P.px(4, 6, hx('#171425')); P.px(11, 6, hx('#171425'));
          P.rect(6, 11, 4, 2, hx('#3c2a22'));
        } else if (kind === 'sheep') {
          P.rect(3, 6, 3, 2, hx('#f7f5ed')); P.rect(10, 6, 3, 2, hx('#f7f5ed'));
          P.px(5, 7, hx('#171425')); P.px(10, 7, hx('#171425'));
          P.rect(7, 11, 2, 2, hx('#76533f'));
        } else if (kind === 'creeper') {
          P.rect(3, 4, 3, 3, hx('#111411'));
          P.rect(10, 4, 3, 3, hx('#111411'));
          P.rect(6, 7, 4, 3, hx('#111411'));
          P.rect(5, 9, 2, 4, hx('#111411'));
          P.rect(9, 9, 2, 4, hx('#111411'));
        }
      }

      if (part === 'snout' && face === 'front') {
        if (kind === 'pig') {
          P.rect(3, 5, 3, 5, hx('#a95f61'));
          P.rect(10, 5, 3, 5, hx('#a95f61'));
          P.px(4, 6, hx('#704044')); P.px(11, 6, hx('#704044'));
        } else {
          P.rect(3, 4, 3, 5, hx('#9f8f80'));
          P.rect(10, 4, 3, 5, hx('#9f8f80'));
          P.px(4, 6, hx('#66584d')); P.px(11, 6, hx('#66584d'));
        }
      }

      if (part === 'leg') {
        if (kind === 'cow' || kind === 'sheep') P.rect(0, 12, 16, 4, sh(hx('#51483f'), faceShade));
        else if (kind === 'pig') P.rect(0, 13, 16, 3, sh(hx('#b76c6e'), faceShade));
        else if (kind === 'creeper' && face === 'front') P.rect(2, 12, 12, 3, sh(hx('#2f692a'), faceShade));
      }
      if (part === 'body' && face === 'bottom' && kind === 'pig') P.rect(2, 2, 12, 12, hx('#f2aaa6'));
    };
  }

  const MOB_FACE_PARTS = {
    pig: ['body', 'head', 'leg', 'snout'],
    cow: ['body', 'head', 'leg', 'snout'],
    sheep: ['body', 'wool', 'head', 'leg'],
    creeper: ['body', 'head', 'leg'],
  };
  for (const kind in MOB_FACE_PARTS)
    for (const part of MOB_FACE_PARTS[kind])
      for (const face of ['front', 'back', 'left', 'right', 'top', 'bottom'])
        def(kind + '_' + part + '_' + face, mobSurface(kind, part, face));

  function mobAccessory(name, colors, accent) {
    def(name, (P) => {
      P.noise(colors);
      P.speck(accent || sh(colors[0], 0.78), 18);
    });
  }
  mobAccessory('pig_ear', [hx('#e89996'), hx('#d37e80'), hx('#f2aaa7')], hx('#a95f61'));
  mobAccessory('pig_tail', [hx('#e89a97'), hx('#ce7779'), hx('#f3ada9')]);
  mobAccessory('cow_ear', [hx('#5d4333'), hx('#3f2d23'), hx('#80604b')]);
  mobAccessory('cow_horn', [hx('#ddd2b9'), hx('#b9aa8d'), hx('#f2ead8')]);
  mobAccessory('cow_udder', [hx('#d9a2a1'), hx('#b87f80'), hx('#ebb9b5')], hx('#9d686b'));
  mobAccessory('cow_tail', [hx('#4f382b'), hx('#34251d'), hx('#6e503e')]);
  mobAccessory('sheep_wool_cap', [hx('#e9e6da'), hx('#cfccbf'), hx('#ffffff')]);
  mobAccessory('sheep_ear', [hx('#b58a69'), hx('#8e684e'), hx('#d0a17e')]);
  mobAccessory('sheep_tail', [hx('#e7e3d7'), hx('#c9c5b9'), hx('#f7f5ed')]);
  const originalAccessoryFaces = {
    cow_horn: [hx('#ddd2b9'), hx('#b9aa8d'), hx('#f2ead8')],
    cow_udder: [hx('#d9a2a1'), hx('#b87f80'), hx('#ebb9b5')],
  };
  for (const name in originalAccessoryFaces) {
    for (const face of ['front', 'back', 'left', 'right', 'top', 'bottom']) {
      const factor = DIRECTION_SHADE[face];
      def(name + '_' + face, (P) => P.noise(originalAccessoryFaces[name].map(color => sh(color, factor))));
    }
  }
  for (const part of ['head', 'leg']) {
    for (const face of ['front', 'back', 'left', 'right', 'top', 'bottom']) {
      def('sheep_wool_' + part + '_' + face, mobSurface('sheep', 'wool', face));
    }
  }
  def('slime', (P) => { P.noise([A(hx('#67c95a'), 205), A(hx('#8ee27c'), 215), A(hx('#4da743'), 205)]); P.border(A(hx('#b4f0a7'), 220)); });
  def('slime_eye', (P) => P.fill(hx('#18251b')));
  def('slime_core', (P) => { P.noise([hx('#4fae45'), hx('#69c95a'), hx('#3d9136')]); P.border(hx('#2f792b')); });
  def('slime_mouth', (P) => P.fill(hx('#223526')));
  def('enderman', (P) => { P.noise([hx('#17131b'), hx('#0d0b10'), hx('#241b29')]); P.speck(hx('#38263d'), 12); });
  def('enderman_face', (P) => { P.noise([hx('#17131b'), hx('#0d0b10')]); P.rect(2, 6, 5, 2, hx('#c63ee5')); P.rect(9, 6, 5, 2, hx('#c63ee5')); P.px(5, 6, hx('#f3a7ff')); P.px(10, 6, hx('#f3a7ff')); });
  def('wolf', (P) => { P.noise([hx('#a8a69e'), hx('#8c8a83'), hx('#c0beb5')]); P.rect(0, 12, 16, 4, hx('#77756f')); });
  def('wolf_face', (P) => { P.noise([hx('#aaa89f'), hx('#c3c1b8')]); P.rect(3, 5, 2, 2, hx('#242424')); P.rect(11, 5, 2, 2, hx('#242424')); P.rect(6, 9, 4, 3, hx('#5a514b')); });
  directionalMobTextures('wolf', ['body', 'head', 'leg', 'tail', 'muzzle', 'ear'],
    [hx('#a8a69e'), hx('#8c8a83'), hx('#c0beb5')], (P, part, face) => {
      if (part === 'head' && face === 'front') {
        P.rect(3, 5, 2, 2, hx('#242424')); P.rect(11, 5, 2, 2, hx('#242424'));
        P.rect(6, 9, 4, 3, hx('#5a514b'));
      }
      if (part === 'body' && face !== 'top') P.rect(0, 12, 16, 4, hx('#77756f'));
      if (part === 'tail') P.rect(0, 11, 16, 5, hx('#77756f'));
    });
  def('wolf_collar', (P) => { P.noise([hx('#b52222'), hx('#d83a32'), hx('#7f1717')]); P.rect(0, 0, 16, 3, hx('#ef5a4c')); });
  def('villager_skin', (P) => { P.noise([hx('#a87958'), hx('#bf8c68'), hx('#8f644a')]); });
  def('villager_face', (P) => { P.noise([hx('#a87958'), hx('#bf8c68')]); P.rect(3, 5, 2, 2, hx('#2d472a')); P.rect(11, 5, 2, 2, hx('#2d472a')); P.rect(7, 7, 2, 6, hx('#8c5e43')); });
  def('villager_robe', (P) => { P.noise([hx('#68452e'), hx('#7b5236'), hx('#583922')]); P.rect(0, 13, 16, 3, hx('#3f2a1c')); });
  def('villager_farmer', (P) => { P.noise([hx('#77512d'), hx('#90693b'), hx('#5b3d23')]); P.rect(0, 11, 16, 5, hx('#b89a45')); });
  def('villager_librarian', (P) => { P.noise([hx('#eee8d5'), hx('#d8cfb8'), hx('#fff9e5')]); P.rect(0, 12, 16, 4, hx('#b53b35')); });
  def('villager_toolsmith', (P) => { P.noise([hx('#3f4850'), hx('#56616a'), hx('#2d343a')]); P.rect(0, 12, 16, 4, hx('#7b4c2a')); });
  def('villager_butcher', (P) => { P.noise([hx('#e6e1d5'), hx('#cfc7b8')]); P.rect(0, 11, 16, 5, hx('#8b4b35')); });
  def('villager_cleric', (P) => { P.noise([hx('#7d4591'), hx('#9657aa'), hx('#623471')]); P.rect(0, 12, 16, 4, hx('#d2b15d')); });
  def('iron_golem', (P) => { P.noise([hx('#d3d0c3'), hx('#b8b5aa'), hx('#e2dfd4')]); P.speck(hx('#7a9862'), 18); P.rect(2, 10, 12, 2, hx('#a95e55')); });
  def('iron_golem_face', (P) => { P.noise([hx('#d3d0c3'), hx('#b8b5aa')]); P.rect(3, 5, 2, 2, hx('#7b2c28')); P.rect(11, 5, 2, 2, hx('#7b2c28')); P.rect(7, 7, 2, 5, hx('#a89d88')); });
  const originalVillagerPalettes = {
    unemployed: [hx('#8c6044'), hx('#a87958'), hx('#68452e')],
    farmer: [hx('#77512d'), hx('#90693b'), hx('#b89a45')],
    librarian: [hx('#eee8d5'), hx('#d8cfb8'), hx('#b53b35')],
    toolsmith: [hx('#3f4850'), hx('#56616a'), hx('#7b4c2a')],
    butcher: [hx('#e6e1d5'), hx('#cfc7b8'), hx('#8b4b35')],
    cleric: [hx('#7d4591'), hx('#9657aa'), hx('#d2b15d')],
  };
  for (const [profession, palette] of Object.entries(originalVillagerPalettes)) {
    directionalMobTextures('villager_original_' + profession,
      ['head', 'nose', 'body', 'robe', 'arms', 'leg'], palette, (P, part, face) => {
        if (part === 'head' && face === 'front') {
          P.rect(3, 5, 2, 2, hx('#2d472a'));
          P.rect(11, 5, 2, 2, hx('#2d472a'));
        }
        if (part === 'nose' && face === 'front') P.rect(5, 2, 6, 12, hx('#8c5e43'));
      });
  }
  directionalMobTextures('iron_golem_original',
    ['head', 'nose', 'body', 'waist', 'arm_left', 'arm_right', 'leg_left', 'leg_right'],
    [hx('#d3d0c3'), hx('#b8b5aa'), hx('#e2dfd4'), hx('#7a9862')], (P, part, face) => {
      if (part === 'head' && face === 'front') {
        P.rect(3, 5, 2, 2, hx('#7b2c28'));
        P.rect(11, 5, 2, 2, hx('#7b2c28'));
      }
      if (part === 'nose' && face === 'front') P.rect(5, 1, 6, 14, hx('#a89d88'));
    });
  def('cat', (P) => { P.noise([hx('#c98a43'), hx('#e0a258'), hx('#9b622f')]); P.rect(0, 12, 16, 4, hx('#7c4b27')); });
  def('cat_face', (P) => { P.noise([hx('#d99a50'), hx('#b87538')]); P.rect(3, 5, 2, 2, hx('#5bc5a1')); P.rect(11, 5, 2, 2, hx('#5bc5a1')); P.px(8, 9, hx('#704139')); });
  directionalMobTextures('cat', ['body', 'head', 'leg', 'tail', 'muzzle', 'ear'],
    [hx('#c98a43'), hx('#e0a258'), hx('#9b622f')], (P, part, face) => {
      if (part === 'head' && face === 'front') {
        P.rect(3, 5, 2, 2, hx('#5bc5a1')); P.rect(11, 5, 2, 2, hx('#5bc5a1'));
        P.px(7, 9, hx('#704139')); P.px(8, 9, hx('#704139'));
      }
      if ((part === 'body' || part === 'tail') && face !== 'top') P.rect(0, 12, 16, 4, hx('#7c4b27'));
    });
  def('squid', (P) => { P.noise([hx('#365f81'), hx('#294c69'), hx('#477596')]); P.speck(hx('#628ba6'), 16); });
  def('bat', (P) => { P.noise([hx('#3a2b29'), hx('#4b3732'), hx('#281e1d')]); });
  def('bat_face', (P) => { P.noise([hx('#42302d'), hx('#2b211f')]); P.px(4, 6, hx('#b7332e')); P.px(11, 6, hx('#b7332e')); });
  def('bat_wing', (P) => { P.noise([hx('#2c2020'), hx('#3a2928')]); P.rect(0, 7, 16, 2, hx('#56403a')); });
  def('blaze', (P) => { P.noise([hx('#d98a22'), hx('#efb331'), hx('#a85c18')]); });
  def('blaze_face', (P) => { P.noise([hx('#d98a22'), hx('#efb331')]); P.rect(3, 6, 3, 2, hx('#2b1a12')); P.rect(10, 6, 3, 2, hx('#2b1a12')); });
  def('blaze_rod_mob', (P) => { P.noise([hx('#d67b1d'), hx('#ffb936'), hx('#9d5012')]); P.rect(0, 0, 2, 16, hx('#ffe46f')); });
  def('dragon_body', (P) => { P.noise([hx('#19121f'), hx('#25182d'), hx('#0f0b14')]); P.speck(hx('#54305f'), 18); });
  def('dragon_face', (P) => { P.noise([hx('#19121f'), hx('#25182d')]); P.rect(2, 5, 5, 2, hx('#c65be1')); P.rect(9, 5, 5, 2, hx('#c65be1')); P.px(5, 5, hx('#f0b0ff')); P.px(10, 5, hx('#f0b0ff')); });
  def('dragon_wing', (P) => { P.noise([hx('#24152b'), hx('#321d3c'), hx('#160d1c')]); for (let x = 2; x < 16; x += 4) P.rect(x, 0, 1, 16, hx('#54315f')); });

  // ================= build & API =================
  function paintSkinProfile(data, profile) {
    const rand = mulberry32(hashName('player-skin:' + profile.id));
    const colors = {
      skin: [hx(profile.skin), hx(profile.skinHi), sh(hx(profile.skin), 0.88)],
      hair: [hx(profile.hair), hx(profile.hairDark), sh(hx(profile.hair), 1.15)],
      shirt: [hx(profile.shirt), hx(profile.shirtDark), sh(hx(profile.shirt), 1.12)],
      pants: [hx(profile.pants), sh(hx(profile.pants), 0.78), sh(hx(profile.pants), 1.12)],
      shoe: [hx(profile.shoe), sh(hx(profile.shoe), 1.18)],
    };
    const px = (x, y, color) => {
      if (!color || x < 0 || x >= 64 || y < 0 || y >= 64) return;
      const index = (y * 64 + x) * 4;
      data[index] = color[0]; data[index + 1] = color[1]; data[index + 2] = color[2];
      data[index + 3] = color[3] === undefined ? 255 : color[3];
    };
    const region = (part, face, painter) => {
      const rect = SKIN_UV[part][face];
      for (let y = 0; y < rect[3]; y++) for (let x = 0; x < rect[2]; x++) {
        px(rect[0] + x, rect[1] + y, painter(x, y, rect[2], rect[3]));
      }
    };
    const noisy = palette => palette[(rand() * palette.length) | 0];
    const baseFaces = ['right', 'front', 'left', 'back', 'top', 'bottom'];

    for (const face of baseFaces) region('head', face, (x, y, w) => {
      if (face === 'top' || face === 'back') return noisy(colors.hair);
      if ((face === 'left' || face === 'right') && (y < 3 || (face === 'left' ? x < 2 : x >= w - 2))) return noisy(colors.hair);
      if (face === 'front') {
        if (y < 3 || (y < 5 && (x === 0 || x === w - 1))) return noisy(colors.hair);
        if (y === 4 && (x === 1 || x === 6)) return hx('#f3f3ef');
        if (y === 4 && (x === 2 || x === 5)) return hx('#315b8a');
        if (y === 6 && x >= 3 && x <= 4) return sh(colors.skin[0], 0.72);
      }
      return noisy(colors.skin);
    });

    for (const face of baseFaces) region('body', face, (x, y, w) => {
      if (face === 'front' && y < 3 && x >= Math.floor(w / 2) - 1 && x <= Math.floor(w / 2)) return colors.shirt[1];
      if (face === 'bottom') return colors.shirt[1];
      return noisy(colors.shirt);
    });

    const paintArm = (part) => {
      for (const face of baseFaces) region(part, face, (x, y, w, h) => {
        if (face === 'top') return noisy(colors.shirt);
        if (face === 'bottom') return noisy(colors.skin);
        const sleeve = y < Math.ceil(h * 0.48);
        if (sleeve && y === Math.ceil(h * 0.48) - 1) return colors.shirt[1];
        return noisy(sleeve ? colors.shirt : colors.skin);
      });
    };
    paintArm('armR'); paintArm('armL');

    const paintLeg = (part) => {
      for (const face of baseFaces) region(part, face, (x, y, w, h) => {
        if (face === 'bottom' || y >= h - 2) return noisy(colors.shoe);
        if (face === 'front' && y === Math.floor(h * 0.55) && x === Math.floor(w / 2)) return colors.pants[1];
        return noisy(colors.pants);
      });
    };
    paintLeg('legR'); paintLeg('legL');

    for (const face of baseFaces) region('hat', face, (x, y, w) => {
      if (face === 'bottom') return null;
      if (face === 'top' || face === 'back') return noisy(colors.hair);
      if (face === 'front') return y < 2 + ((x + (x >> 1)) & 1) || (y < 5 && (x === 0 || x === w - 1)) ? noisy(colors.hair) : null;
      return y < 3 || (face === 'left' ? x < 2 : x >= w - 2) ? noisy(colors.hair) : null;
    });

    for (const face of baseFaces) region('jacket', face, (x, y, w, h) => {
      if (face === 'top' || face === 'bottom') return null;
      if (x === 0 || x === w - 1 || y === h - 1 || (face === 'front' && x === Math.floor(w / 2))) return sh(colors.shirt[0], 1.16);
      return ((x * 3 + y * 5) % 17 === 0) ? colors.shirt[1] : null;
    });

    const paintSleeve = (part) => {
      for (const face of baseFaces) region(part, face, (x, y, w, h) => {
        if (face === 'bottom' || y > Math.ceil(h * 0.52)) return null;
        if (face === 'top' || x === 0 || x === w - 1 || y === Math.ceil(h * 0.52)) return sh(colors.shirt[0], 1.14);
        return ((x + y) & 3) === 0 ? colors.shirt[1] : null;
      });
    };
    paintSleeve('sleeveR'); paintSleeve('sleeveL');

    const paintPants = (part) => {
      for (const face of baseFaces) region(part, face, (x, y, w, h) => {
        if (face === 'top') return sh(colors.pants[0], 1.12);
        if (face === 'bottom') return null;
        if (y < 2 || (face === 'front' && y === Math.floor(h * 0.58)) || x === 0) return sh(colors.pants[0], 1.1);
        return null;
      });
    };
    paintPants('pantsR'); paintPants('pantsL');
  }

  function skinUv(name) {
    if (typeof name !== 'string' || name.slice(0, 5) !== 'skin.') return null;
    const parts = name.split('.');
    if (parts.length !== 4) return null;
    const profileIndex = SKIN_PROFILE_INDEX.get(parts[1]);
    const faceSet = SKIN_UV[parts[2]];
    const rect = faceSet && faceSet[parts[3]];
    if (profileIndex === undefined || !rect) return null;
    const x = profileIndex * 64 + rect[0], y = SKIN_PAGE_Y + rect[1], e = 0.04;
    return [(x + e) / SIZE, (y + e) / SIZE, (x + rect[2] - e) / SIZE, (y + rect[3] - e) / SIZE];
  }

  const Textures = {
    atlas: null,
    build() {
      if (atlas) return atlas;
      if (typeof document === 'undefined') throw new Error('Textures.build() requires a DOM (document undefined)');
      const canvas = document.createElement('canvas');
      canvas.width = SIZE; canvas.height = SIZE;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, SIZE, SIZE);
      if (painters.length > GRID * (GRID - 4)) throw new Error('too many tiles before reserved skin pages: ' + painters.length);
      painters.forEach((p, i) => {
        const img = ctx.createImageData(TILE, TILE);
        const rand = mulberry32(hashName(p.name) ^ 0x9E3779B9);
        p.fn(makeP(img.data, rand));
        const sx = (i % GRID) * TILE, sy = ((i / GRID) | 0) * TILE;
        ctx.putImageData(img, sx, sy);
        slotOf.set(p.name, i);
      });
      SKIN_PROFILES.forEach((profile, index) => {
        const img = ctx.createImageData(64, 64);
        paintSkinProfile(img.data, profile);
        ctx.putImageData(img, index * 64, SKIN_PAGE_Y);
      });
      atlas = { canvas, size: SIZE, tile: TILE };
      defaultAtlasPixels = ctx.getImageData(0, 0, SIZE, SIZE);
      packAtlases.set('default', defaultAtlasPixels);
      this.atlas = atlas;
      return atlas;
    },
    uv(name) {
      const cached = uvCache.get(name);
      if (cached) return cached;
      const generatedSkinUv = skinUv(name);
      if (generatedSkinUv) { uvCache.set(name, generatedSkinUv); return generatedSkinUv; }
      let slot = slotOf.get(name);
      if (slot === undefined) {
        if (!warned[name]) { warned[name] = true; if (typeof console !== 'undefined') console.warn('[Textures] unknown tile: ' + name); }
        slot = slotOf.get('__fallback');
        if (slot === undefined) slot = 0;
      }
      const px = (slot % GRID) * TILE, py = ((slot / GRID) | 0) * TILE;
      const e = 0.04; // tiny inset against bleeding
      const uv = [(px + e) / SIZE, (py + e) / SIZE, (px + TILE - e) / SIZE, (py + TILE - e) / SIZE];
      uvCache.set(name, uv);
      return uv;
    },
    rect(name) {
      const cached = rectCache.get(name);
      if (cached) return cached;
      let slot = slotOf.get(name);
      if (slot === undefined) {
        if (!warned[name]) { warned[name] = true; if (typeof console !== 'undefined') console.warn('[Textures] unknown tile: ' + name); }
        slot = slotOf.get('__fallback') || 0;
      }
      const rect = [(slot % GRID) * TILE, ((slot / GRID) | 0) * TILE, TILE, TILE];
      rectCache.set(name, rect);
      return rect;
    },
    names() { return painters.map(p => p.name).concat(SKIN_TEXTURE_NAMES); },
    skinProfiles() { return SKIN_PROFILES.map(profile => ({ id: profile.id, name: profile.name })); },
    normalizeSkin(value) { return SKIN_PROFILE_INDEX.has(value) ? value : SKIN_PROFILES[0].id; },
    registerPack(id, config) {
      if (!id || id === 'default' || !config || !config.entries) return false;
      packs.set(id, {
        id,
        name: String(config.name || id),
        entries: Object.assign({}, config.entries),
      });
      return true;
    },
    availablePacks() {
      return [{ id:'default', name:'WebCraft 默认材质' }]
        .concat(Array.from(packs.values(), pack => ({ id:pack.id, name:pack.name })));
    },
    currentPack() { return activePack; },
    packVersion() { return packVersion; },
    packInfo(id) {
      if (id === 'default') return { id:'default', name:'WebCraft 默认材质', entries:0 };
      const pack = packs.get(id);
      return pack ? { id:pack.id, name:pack.name, entries:Object.keys(pack.entries).length } : null;
    },
    packHasTexture(id, name) {
      const pack = packs.get(id);
      return !!(pack && Object.prototype.hasOwnProperty.call(pack.entries, name));
    },
    packTextureInfo(id, name) {
      const pack = packs.get(id);
      if (!pack || !Object.prototype.hasOwnProperty.call(pack.entries, name)) return null;
      const raw = pack.entries[name];
      const spec = typeof raw === 'string' ? { path:raw } : raw;
      return {
        path:spec.path,
        source:Array.isArray(spec.source) ? spec.source.slice() : null,
        dest:Array.isArray(spec.dest) ? spec.dest.slice() : null,
      };
    },
    packStatus(id) {
      const result = packResults.get(id);
      return result ? Object.assign({}, result) : null;
    },
    async setPack(id) {
      this.build();
      id = id || 'default';
      if (id !== 'default' && !packs.has(id)) throw new Error('unknown texture pack: ' + id);
      if (id === activePack && packResults.has(id)) return packResults.get(id);
      if (packLoad) await packLoad;
      const apply = async () => {
        const ctx = atlas.canvas.getContext('2d');
        if (packAtlases.has(id)) {
          ctx.putImageData(packAtlases.get(id), 0, 0);
          activePack = id;
          const previous = packResults.get(id) || { loaded:0, failed:0, total:0 };
          const result = { id, loaded:previous.loaded, failed:previous.failed, total:previous.total, version:++packVersion };
          packResults.set(id, result);
          return result;
        }
        const pack = packs.get(id);
        const entries = Object.entries(pack.entries)
          .map(entry => [entry[0], typeof entry[1] === 'string' ? { path:entry[1] } : entry[1]])
          .filter(entry => entry[1] && entry[1].path && (slotOf.has(entry[0]) || Array.isArray(entry[1].dest)));
        const images = new Map();
        const paths = Array.from(new Set(entries.map(entry => entry[1].path)));
        let cursor = 0;
        const decode = async (path) => {
          if (typeof fetch === 'function' && typeof createImageBitmap === 'function') {
            const response = await fetch(path, { cache:'force-cache' });
            if (!response.ok) throw new Error('HTTP ' + response.status + ': ' + path);
            return createImageBitmap(await response.blob());
          }
          if (typeof Image === 'undefined') throw new Error('image decoding is unavailable');
          return new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = () => reject(new Error('failed to load ' + path));
            image.src = path;
          });
        };
        const worker = async () => {
          while (cursor < paths.length) {
            const index = cursor++;
            const path = paths[index];
            try { images.set(path, await decode(path)); }
            catch (error) { images.set(path, null); }
          }
        };
        await Promise.all(Array.from({ length:Math.min(8, paths.length) }, worker));
        if (!entries.some(entry => images.get(entry[1].path))) throw new Error('no textures could be loaded for ' + id);
        ctx.putImageData(defaultAtlasPixels, 0, 0);
        ctx.imageSmoothingEnabled = false;
        let loaded = 0;
        for (const entry of entries) {
          const name = entry[0], spec = entry[1], image = images.get(spec.path);
          if (!image) continue;
          const slot = slotOf.get(name);
          const dest = Array.isArray(spec.dest)
            ? spec.dest
            : [(slot % GRID) * TILE, ((slot / GRID) | 0) * TILE, TILE, TILE];
          const source = Array.isArray(spec.source)
            ? spec.source
            : [0, 0, Math.min(TILE, image.width), Math.min(TILE, image.height)];
          const dx = dest[0], dy = dest[1], dw = dest[2], dh = dest[3];
          ctx.clearRect(dx, dy, dw, dh);
          ctx.drawImage(image, source[0], source[1], source[2], source[3], dx, dy, dw, dh);
          if (spec.tint) {
            const pixels = ctx.getImageData(dx, dy, dw, dh);
            const tint = spec.tint;
            for (let i = 0; i < pixels.data.length; i += 4) {
              pixels.data[i] = pixels.data[i] * tint[0] / 255;
              pixels.data[i + 1] = pixels.data[i + 1] * tint[1] / 255;
              pixels.data[i + 2] = pixels.data[i + 2] * tint[2] / 255;
            }
            ctx.putImageData(pixels, dx, dy);
          }
          loaded++;
        }
        for (const image of images.values()) if (image && image.close) image.close();
        activePack = id;
        packAtlases.set(id, ctx.getImageData(0, 0, SIZE, SIZE));
        const result = { id, loaded, failed:entries.length - loaded, total:entries.length, version:++packVersion };
        packResults.set(id, result);
        return result;
      };
      packLoad = apply();
      try { return await packLoad; }
      finally { packLoad = null; }
    },
  };

  // fallback checker tile (registered last)
  def('__fallback', (P) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      P.px(x, y, ((x >> 2) + (y >> 2)) % 2 === 0 ? [255, 0, 255, 255] : [10, 10, 10, 255]);
    }
  });

  window.Textures = Textures;
})();
