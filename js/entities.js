/* entities.js — item drops, TNT, mobs (AI + models), particles, explosions */
'use strict';
(function () {
  const GRAV = 26;
  const list = [];
  const particles = [];
  let geometryVersion = 1;
  let particleVersion = 1;
  const SPATIAL_SIZE = 8;
  const MAX_ITEMS = 256;
  const MAX_PARTICLES = 700;
  const spatial = new Map();
  const QUERY_WORK = [];
  const RAY_QUERY_WORK = [];
  let rng = new U.RNG(0xE17E1234);
  let weatherParticleCarry = 0;
  let particleLevel = 0;
  let remoteProvider = null;
  let networkEntityProvider = null;
  let mobSpawningEnabled = true;
  const BREED_FOOD = Object.freeze({
    pig: Items.IT.CARROT,
    cow: Items.IT.WHEAT,
    sheep: Items.IT.WHEAT,
    chicken: Items.IT.WHEAT_SEEDS,
    rabbit: Items.IT.CARROT,
    horse: Items.IT.APPLE,
  });

  function R() { return rng.next(); }
  function particleCount(full) {
    if (particleLevel === 2) return Math.min(2, full);
    if (particleLevel === 1) return Math.max(1, Math.ceil(full * 0.5));
    return full;
  }
  function spatialKey(x, z) { return Math.floor(x / SPATIAL_SIZE) + ',' + Math.floor(z / SPATIAL_SIZE); }
  function spatialAdd(e) {
    const key = spatialKey(e.x, e.z);
    let bucket = spatial.get(key);
    if (!bucket) { bucket = []; spatial.set(key, bucket); }
    bucket.push(e);
    e._spatialKey = key;
  }
  function spatialRemove(e) {
    const key = e._spatialKey;
    if (key === undefined) return;
    const bucket = spatial.get(key);
    if (bucket) {
      const i = bucket.indexOf(e);
      if (i >= 0) bucket.splice(i, 1);
      if (bucket.length === 0) spatial.delete(key);
    }
    e._spatialKey = undefined;
  }
  function spatialUpdate(e) {
    const key = spatialKey(e.x, e.z);
    if (key === e._spatialKey) return;
    spatialRemove(e);
    spatialAdd(e);
  }
  function queryBox(x0, z0, x1, z1, out) {
    out = out || [];
    out.length = 0;
    const cx0 = Math.floor(x0 / SPATIAL_SIZE), cz0 = Math.floor(z0 / SPATIAL_SIZE);
    const cx1 = Math.floor(x1 / SPATIAL_SIZE), cz1 = Math.floor(z1 / SPATIAL_SIZE);
    for (let cx = cx0; cx <= cx1; cx++) for (let cz = cz0; cz <= cz1; cz++) {
      const bucket = spatial.get(cx + ',' + cz);
      if (!bucket) continue;
      for (const e of bucket) if (!e.dead && e.x >= x0 - e.w && e.x <= x1 + e.w && e.z >= z0 - e.w && e.z <= z1 + e.w) out.push(e);
    }
    return out;
  }

  // ---------------- models (units of 1/16 m) ----------------
  // part: {s:[w,h,l], c:[cx,cy,cz] center, anim:'leg0'|'leg1'|'head'|'armF0'|'armF1'|null, tex:{front,side,top?,...}}
  function boxTex(face, side) {
    return { front: face, back: side, left: side, right: side, top: side, bottom: side };
  }
  function allTex(t) { return { front: t, back: t, left: t, right: t, top: t, bottom: t }; }
  function faceTex(prefix) {
    return {
      front: prefix + '_front', back: prefix + '_back',
      left: prefix + '_left', right: prefix + '_right',
      top: prefix + '_top', bottom: prefix + '_bottom',
    };
  }
  const PACKED_FACE_CELLS = Object.freeze({
    right:[0,0,5,8], left:[5,0,5,8], top:[10,0,6,8],
    bottom:[0,8,5,8], back:[5,8,5,8], front:[10,8,6,8],
  });
  function packedTexture(name, page, cell) {
    return Object.freeze({ packed:true, name, page, cell:Object.freeze(cell.slice()) });
  }
  function packedFaceTex(prefix, page) {
    const tex = {};
    for (const face of ['front', 'back', 'left', 'right', 'top', 'bottom']) {
      tex[face] = packedTexture(prefix + '_' + face, page, PACKED_FACE_CELLS[face]);
    }
    return Object.freeze(tex);
  }
  function packedAllTex(name, page, face) {
    const ref = packedTexture(name, page, PACKED_FACE_CELLS[face || 'front']);
    return { front:ref, back:ref, left:ref, right:ref, top:ref, bottom:ref };
  }
  function textureUv(texture) {
    if (!texture || !texture.packed) return Textures.uv(texture);
    const page = Textures.rect(texture.page);
    const cell = texture.cell;
    const size = Textures.atlas && Textures.atlas.size ? Textures.atlas.size : 512;
    const inset = 0.04;
    return [
      (page[0] + cell[0] + inset) / size,
      (page[1] + cell[1] + inset) / size,
      (page[0] + cell[0] + cell[2] - inset) / size,
      (page[1] + cell[1] + cell[3] - inset) / size,
    ];
  }

  function villagerModel(robeTexture, professionHat) {
    const parts = [
      { s: [8, 12, 6], c: [0, 18, 0], anim: 'body', tex: allTex(robeTexture) },
      { s: [8, 8, 8], c: [0, 28, 0], anim: 'head', tex: boxTex('villager_face', 'villager_skin') },
      { s: [2, 4, 2], c: [0, 27, -5], anim: 'head', detail: true, tex: allTex('villager_skin') },
      { s: [4, 12, 4], c: [-2, 6, 0], anim: 'leg0', tex: allTex(robeTexture) },
      { s: [4, 12, 4], c: [2, 6, 0], anim: 'leg1', tex: allTex(robeTexture) },
      { s: [8, 4, 4], c: [0, 18, -4], tex: allTex('villager_skin') },
    ];
    if (professionHat) parts.push({ s:[9,2,9], c:[0,32.5,0], anim:'head', detail:true, tex:allTex(robeTexture) });
    return {
      w: 0.6, h: 1.95, hp: 20, speed: 1.0, headPivot: [0, 28, 0], sound: null,
      drops: [], parts,
    };
  }

  function originalVillagerModel(profession) {
    const texture = 'villager_original_' + profession;
    return {
      w: 0.6, h: 1.95, hp: 20, speed: 1.0, headPivot: [0, 24, 0], sound: null,
      drops: [], parts: [
        { s:[8,12,6], c:[0,18,0], anim:'body', tex:faceTex(texture + '_body') },
        { s:[8,10,8], c:[0,29,0], anim:'head', tex:faceTex(texture + '_head') },
        { s:[2,4,2], c:[0,25,-5], anim:'head', detail:true, tex:faceTex(texture + '_nose') },
        { s:[4,12,4], c:[-2,6,0], anim:'leg0', tex:faceTex(texture + '_leg') },
        { s:[4,12,4], c:[2,6,0], anim:'leg1', tex:faceTex(texture + '_leg') },
        { s:[8,4,4], c:[0,21,-1], tex:faceTex(texture + '_arms') },
        { s:[9,19,7], c:[0,15,0], anim:'body', layer:true, detail:true, tex:faceTex(texture + '_robe') },
      ],
    };
  }

  const MODELS = {
    pig: {
      w: 0.9, h: 1.0, hp: 10, speed: 1.1, drops: [{ id: () => Items.IT.PORK_RAW, n: [1, 2] }],
      headPivot: [0, 12, -10],
      sound: 'pig', parts: [
        { s: [10, 8, 16], c: [0, 10, 1], anim: 'body', tex: faceTex('pig_body') },
        { s: [8, 8, 8], c: [0, 12, -10], anim: 'head', tex: faceTex('pig_head') },
        { s: [6, 3, 2], c: [0, 10, -15], anim: 'head', detail: true, tex: faceTex('pig_snout') },
        { s: [2, 3, 1], c: [-4, 16, -10], anim: 'head', wiggle: 'ear0', detail: true, tex: allTex('pig_ear') },
        { s: [2, 3, 1], c: [4, 16, -10], anim: 'head', wiggle: 'ear1', detail: true, tex: allTex('pig_ear') },
        { s: [4, 6, 4], c: [-3, 3, -5], anim: 'leg0', tex: faceTex('pig_leg') },
        { s: [4, 6, 4], c: [3, 3, -5], anim: 'leg1', tex: faceTex('pig_leg') },
        { s: [4, 6, 4], c: [-3, 3, 6], anim: 'leg1', tex: faceTex('pig_leg') },
        { s: [4, 6, 4], c: [3, 3, 6], anim: 'leg0', tex: faceTex('pig_leg') },
        { s: [2, 2, 5], c: [0, 12, 11], anim: 'tail', pivot: [0, 12, 9], detail: true, tex: allTex('pig_tail') },
      ],
    },
    cow: {
      w: 0.9, h: 1.4, hp: 10, speed: 1.0,
      drops: [{ id: () => Items.IT.BEEF_RAW, n: [1, 2] }, { id: () => Items.IT.LEATHER, n: [0, 2] }],
      headPivot: [0, 18, -11],
      sound: 'cow', parts: [
        { s: [12, 10, 18], c: [0, 14, 1], anim: 'body', tex: faceTex('cow_body') },
        { s: [8, 8, 6], c: [0, 18, -11], anim: 'head', tex: faceTex('cow_head') },
        { s: [8, 4, 3], c: [0, 16, -15], anim: 'head', detail: true, tex: faceTex('cow_snout') },
        { s: [3, 2, 1], c: [-5, 21, -11], anim: 'head', wiggle: 'ear0', detail: true, tex: allTex('cow_ear') },
        { s: [3, 2, 1], c: [5, 21, -11], anim: 'head', wiggle: 'ear1', detail: true, tex: allTex('cow_ear') },
        { s: [2, 3, 2], c: [-4, 23, -11], anim: 'head', detail: true, tex: allTex('cow_horn') },
        { s: [2, 3, 2], c: [4, 23, -11], anim: 'head', detail: true, tex: allTex('cow_horn') },
        { s: [6, 3, 6], c: [0, 8, 3], detail: true, tex: allTex('cow_udder') },
        { s: [4, 10, 4], c: [-3.5, 5, -5], anim: 'leg0', tex: faceTex('cow_leg') },
        { s: [4, 10, 4], c: [3.5, 5, -5], anim: 'leg1', tex: faceTex('cow_leg') },
        { s: [4, 10, 4], c: [-3.5, 5, 7], anim: 'leg1', tex: faceTex('cow_leg') },
        { s: [4, 10, 4], c: [3.5, 5, 7], anim: 'leg0', tex: faceTex('cow_leg') },
        { s: [2, 3, 6], c: [0, 14, 12], anim: 'tail', pivot: [0, 14, 9], detail: true, tex: allTex('cow_tail') },
      ],
    },
    sheep: {
      w: 0.9, h: 1.3, hp: 8, speed: 1.0,
      drops: [{ id: () => Items.IT.MUTTON_RAW, n: [1, 1] }, { id: () => Blocks.ID.WOOL, n: [1, 1], unlessSheared: true }],
      headPivot: [0, 17, -9],
      sound: 'sheep', parts: [
        { s: [10, 8, 12], c: [0, 13, 1], anim: 'body', when: 'sheared', tex: faceTex('sheep_body') },
        { s: [12, 10, 14], c: [0, 13, 1], anim: 'body', when: 'wool', tex: faceTex('sheep_wool') },
        { s: [6, 6, 6], c: [0, 17, -9], anim: 'head', tex: faceTex('sheep_head') },
        { s: [8, 4, 5], c: [0, 20, -9], anim: 'head', when: 'wool', detail: true, tex: allTex('sheep_wool_cap') },
        { s: [2, 2, 1], c: [-4, 19, -9], anim: 'head', wiggle: 'ear0', detail: true, tex: allTex('sheep_ear') },
        { s: [2, 2, 1], c: [4, 19, -9], anim: 'head', wiggle: 'ear1', detail: true, tex: allTex('sheep_ear') },
        { s: [4, 8, 4], c: [-3, 4, -4], anim: 'leg0', tex: faceTex('sheep_leg') },
        { s: [4, 8, 4], c: [3, 4, -4], anim: 'leg1', tex: faceTex('sheep_leg') },
        { s: [4, 8, 4], c: [-3, 4, 5], anim: 'leg1', tex: faceTex('sheep_leg') },
        { s: [4, 8, 4], c: [3, 4, 5], anim: 'leg0', tex: faceTex('sheep_leg') },
        { s: [3, 3, 4], c: [0, 14, 10], anim: 'tail', pivot: [0, 14, 8], detail: true, tex: allTex('sheep_tail') },
      ],
    },
    chicken: {
      w: 0.45, h: 0.72, hp: 4, speed: 1.25,
      drops: [{ id: () => Items.IT.CHICKEN_RAW, n: [1, 1] }, { id: () => Items.IT.FEATHER, n: [0, 2] }],
      headPivot: [0, 10, -4], sound: null, parts: [
        { s: [6, 8, 6], c: [0, 8, 1], anim: 'body', tex: allTex('chicken_body') },
        { s: [4, 4, 4], c: [0, 12, -4], anim: 'head', tex: {
          front: 'chicken_head', back: 'chicken_head_back',
          left: 'chicken_head_side', right: 'chicken_head_side',
          top: 'chicken_head_top', bottom: 'chicken_head_bottom',
        } },
        { s: [4, 2, 2], c: [0, 11, -7], anim: 'head', detail: true, tex: allTex('chicken_beak') },
        { s: [1, 5, 1], c: [-2, 2.5, 0], anim: 'leg0', joint: [0, 2.5, 0], tex: allTex('chicken_leg') },
        { s: [1, 5, 1], c: [2, 2.5, 0], anim: 'leg1', joint: [0, 2.5, 0], tex: allTex('chicken_leg') },
        { s: [1, 4, 6], c: [-3.5, 8, 1], anim: 'wing0', joint: [0.5, 2, 0], detail: true, tex: allTex('chicken_body') },
        { s: [1, 4, 6], c: [3.5, 8, 1], anim: 'wing1', joint: [-0.5, 2, 0], detail: true, tex: allTex('chicken_body') },
      ],
    },
    zombie: {
      w: 0.6, h: 1.95, hp: 20, speed: 1.9, hostile: true, dmg: 3,
      drops: [
        { id: () => Items.IT.FLESH, n: [0, 2] },
        { id: () => Items.IT.CARROT, n: [1, 1], chance: 0.025 },
        { id: () => Items.IT.POTATO, n: [1, 1], chance: 0.025 },
      ],
      headPivot: [0, 28, 0],
      sound: 'zombie', parts: [
        { s: [8, 12, 4], c: [0, 18, 0], anim: null, tex: faceTex('zombie_body') },
        { s: [8, 8, 8], c: [0, 28, 0], anim: 'head', tex: faceTex('zombie_head') },
        { s: [4, 12, 4], c: [-2, 6, 0], anim: 'leg0', tex: faceTex('zombie_leg') },
        { s: [4, 12, 4], c: [2, 6, 0], anim: 'leg1', tex: faceTex('zombie_leg') },
        { s: [4, 12, 4], c: [-6, 18, 0], anim: 'armF0', tex: faceTex('zombie_arm') },
        { s: [4, 12, 4], c: [6, 18, 0], anim: 'armF1', tex: faceTex('zombie_arm') },
      ],
    },
    skeleton: {
      w: 0.6, h: 1.95, hp: 20, speed: 1.9, hostile: true, dmg: 3,
      drops: [{ id: () => Items.IT.BONE, n: [0, 2] }, { id: () => Items.IT.ARROW, n: [0, 2] }],
      headPivot: [0, 28, 0], sound: null, parts: [
        { s: [8, 12, 4], c: [0, 18, 0], tex: faceTex('skeleton_body') },
        { s: [8, 8, 8], c: [0, 28, 0], anim: 'head', tex: faceTex('skeleton_head') },
        { s: [2, 12, 2], c: [-2, 6, 0], anim: 'leg0', joint: [0, 6, 0], tex: faceTex('skeleton_limb') },
        { s: [2, 12, 2], c: [2, 6, 0], anim: 'leg1', joint: [0, 6, 0], tex: faceTex('skeleton_limb') },
        { s: [2, 12, 2], c: [-5, 18, 0], anim: 'armF0', joint: [0, 6, 0], tex: faceTex('skeleton_limb') },
        { s: [2, 12, 2], c: [5, 18, 0], anim: 'armF1', joint: [0, 6, 0], tex: faceTex('skeleton_limb') },
      ],
    },
    spider: {
      w: 1.3, h: 0.65, hp: 16, speed: 2.2, hostile: true, dmg: 2,
      drops: [{ id: () => Items.IT.STRING, n: [0, 2] }],
      headPivot: [0, 7, -7], sound: null, parts: [
        { s: [10, 7, 12], c: [0, 6, 2], anim: 'body', tex: allTex('spider_body') },
        { s: [8, 6, 6], c: [0, 7, -7], anim: 'head', tex: allTex('spider_head') },
        { s: [10, 2, 2], c: [-8, 5, -5], anim: 'leg0', rot:[0,-0.48,-0.08], tex: allTex('spider_leg') },
        { s: [10, 2, 2], c: [8, 5, -5], anim: 'leg1', rot:[0,0.48,0.08], tex: allTex('spider_leg') },
        { s: [11, 2, 2], c: [-8.5, 4.5, -2], anim: 'leg1', rot:[0,-0.18,-0.04], tex: allTex('spider_leg') },
        { s: [11, 2, 2], c: [8.5, 4.5, -2], anim: 'leg0', rot:[0,0.18,0.04], tex: allTex('spider_leg') },
        { s: [11, 2, 2], c: [-8.5, 4.5, 2], anim: 'leg0', rot:[0,0.18,-0.04], tex: allTex('spider_leg') },
        { s: [11, 2, 2], c: [8.5, 4.5, 2], anim: 'leg1', rot:[0,-0.18,0.04], tex: allTex('spider_leg') },
        { s: [10, 2, 2], c: [-8, 4, 5], anim: 'leg1', rot:[0,0.48,-0.08], tex: allTex('spider_leg') },
        { s: [10, 2, 2], c: [8, 4, 5], anim: 'leg0', rot:[0,-0.48,0.08], tex: allTex('spider_leg') },
      ],
    },
    creeper: {
      w: 0.6, h: 1.65, hp: 20, speed: 1.4, hostile: true,
      drops: [{ id: () => Items.IT.GUNPOWDER, n: [1, 2] }],
      headPivot: [0, 22, 0],
      sound: null, parts: [
        { s: [8, 12, 4], c: [0, 12, 0], anim: 'body', tex: faceTex('creeper_body') },
        { s: [9, 13, 5], c: [0, 12, 0], anim: 'body', when: 'fusing', detail: true, tex: allTex('creeper_charge') },
        { s: [8, 8, 8], c: [0, 22, 0], anim: 'head', tex: faceTex('creeper_head') },
        { s: [9, 9, 9], c: [0, 22, 0], anim: 'head', when: 'fusing', detail: true, tex: allTex('creeper_charge') },
        { s: [4, 6, 4], c: [-2, 3, -3], anim: 'leg0', tex: faceTex('creeper_leg') },
        { s: [4, 6, 4], c: [2, 3, -3], anim: 'leg1', tex: faceTex('creeper_leg') },
        { s: [4, 6, 4], c: [-2, 3, 3], anim: 'leg1', tex: faceTex('creeper_leg') },
        { s: [4, 6, 4], c: [2, 3, 3], anim: 'leg0', tex: faceTex('creeper_leg') },
      ],
    },
    slime: {
      w: 0.8, h: 0.8, hp: 12, speed: 1.35, hostile: true, dmg: 2,
      drops: [{ id: () => Items.IT.SLIME_BALL, n: [0, 2] }], headPivot: [0, 7, 0], sound: null,
      parts: [
        { s: [12, 12, 12], c: [0, 6, 0], anim: 'body', tex: allTex('slime') },
        { s: [8, 8, 8], c: [0, 6, 0], anim: 'body', detail: true, tex: allTex('slime_core') },
        { s: [2, 2, 1], c: [-3, 8, -6.2], tex: allTex('slime_eye') },
        { s: [2, 2, 1], c: [3, 8, -6.2], tex: allTex('slime_eye') },
        { s: [4, 1, 1], c: [0, 4.5, -6.25], detail: true, tex: allTex('slime_mouth') },
      ],
    },
    enderman: {
      w: 0.6, h: 2.9, hp: 40, speed: 2.5, hostile: true, neutral: true, dmg: 7,
      drops: [{ id: () => Items.IT.ENDER_PEARL, n: [0, 1] }], headPivot: [0, 42, 0], sound: null,
      parts: [
        { s: [8, 18, 4], c: [0, 25, 0], anim: 'body', tex: allTex('enderman') },
        { s: [8, 8, 8], c: [0, 42, 0], anim: 'head', tex: boxTex('enderman_face', 'enderman') },
        { s: [3, 24, 3], c: [-2, 12, 0], anim: 'leg0', tex: allTex('enderman') },
        { s: [3, 24, 3], c: [2, 12, 0], anim: 'leg1', tex: allTex('enderman') },
        { s: [3, 24, 3], c: [-5.5, 25, 0], anim: 'armF0', tex: allTex('enderman') },
        { s: [3, 24, 3], c: [5.5, 25, 0], anim: 'armF1', tex: allTex('enderman') },
      ],
    },
    wolf: {
      w: 0.65, h: 0.85, hp: 8, speed: 1.7, headPivot: [0, 12, -7], sound: null,
      drops: [], parts: [
        { s: [7, 7, 12], c: [0, 9, 1], anim: 'body', tex: faceTex('wolf_body') },
        { s: [7, 7, 7], c: [0, 12, -7], anim: 'head', tex: faceTex('wolf_head') },
        { s: [3, 7, 3], c: [-2, 3.5, -3], anim: 'leg0', joint: [0, 3.5, 0], tex: faceTex('wolf_leg') },
        { s: [3, 7, 3], c: [2, 3.5, -3], anim: 'leg1', joint: [0, 3.5, 0], tex: faceTex('wolf_leg') },
        { s: [3, 7, 3], c: [-2, 3.5, 5], anim: 'leg1', joint: [0, 3.5, 0], tex: faceTex('wolf_leg') },
        { s: [3, 7, 3], c: [2, 3.5, 5], anim: 'leg0', joint: [0, 3.5, 0], tex: faceTex('wolf_leg') },
        { s: [2, 2, 8], c: [0, 11, 9], anim: 'tail', pivot: [0, 11, 6], tex: faceTex('wolf_tail') },
        { s: [8, 2, 8], c: [0, 11, -5], anim: 'head', when: 'tamed', detail: true, tex: allTex('wolf_collar') },
      ],
    },
    villager: villagerModel('villager_robe'),
    cat: {
      w: 0.55, h: 0.7, hp: 10, speed: 1.45, headPivot: [0, 10, -7], sound: null,
      drops: [], parts: [
        { s: [6, 6, 12], c: [0, 7, 1], anim: 'body', tex: faceTex('cat_body') },
        { s: [6, 6, 6], c: [0, 10, -7], anim: 'head', tex: faceTex('cat_head') },
        { s: [2, 6, 2], c: [-2, 3, -3], anim: 'leg0', joint: [0, 3, 0], tex: faceTex('cat_leg') },
        { s: [2, 6, 2], c: [2, 3, -3], anim: 'leg1', joint: [0, 3, 0], tex: faceTex('cat_leg') },
        { s: [2, 6, 2], c: [-2, 3, 5], anim: 'leg1', joint: [0, 3, 0], tex: faceTex('cat_leg') },
        { s: [2, 6, 2], c: [2, 3, 5], anim: 'leg0', joint: [0, 3, 0], tex: faceTex('cat_leg') },
        { s: [2, 2, 10], c: [0, 9, 10], anim: 'tail', pivot: [0, 9, 6], tex: faceTex('cat_tail') },
      ],
    },
    rabbit: {
      w: 0.42, h: 0.52, hp: 3, speed: 1.8, headPivot: [0, 7, -4], sound: null,
      drops: [], parts: [
        { s:[6,5,8], c:[0,5,1], anim:'body', tex:allTex('rabbit') },
        { s:[5,5,5], c:[0,7,-4], anim:'head', tex:boxTex('rabbit_face', 'rabbit') },
        { s:[2,6,2], c:[-1.5,12,-3], anim:'head', detail:true, tex:allTex('rabbit') },
        { s:[2,6,2], c:[1.5,12,-3], anim:'head', detail:true, tex:allTex('rabbit') },
        { s:[2,3,4], c:[-2,1.5,3], anim:'leg0', tex:allTex('rabbit') },
        { s:[2,3,4], c:[2,1.5,3], anim:'leg1', tex:allTex('rabbit') },
        { s:[3,3,3], c:[0,5,6], anim:'tail', detail:true, tex:allTex('rabbit_tail') },
      ],
    },
    horse: {
      w: 1.4, h: 1.6, hp: 30, speed: 2.25, headPivot: [0, 21, -10], sound: null,
      drops: [{ id: () => Items.IT.LEATHER, n: [0, 2] }], parts: [
        { s:[10,10,18], c:[0,15,1], anim:'body', tex:allTex('horse') },
        { s:[6,10,6], c:[0,20,-8], anim:'head', rot:[-0.35,0,0], tex:allTex('horse') },
        { s:[6,5,8], c:[0,21,-13], anim:'head', tex:boxTex('horse_face', 'horse') },
        { s:[2,5,1], c:[-2,26,-10], anim:'head', detail:true, tex:allTex('horse') },
        { s:[2,5,1], c:[2,26,-10], anim:'head', detail:true, tex:allTex('horse') },
        { s:[4,12,4], c:[-3,6,-5], anim:'leg0', tex:allTex('horse') },
        { s:[4,12,4], c:[3,6,-5], anim:'leg1', tex:allTex('horse') },
        { s:[4,12,4], c:[-3,6,7], anim:'leg1', tex:allTex('horse') },
        { s:[4,12,4], c:[3,6,7], anim:'leg0', tex:allTex('horse') },
        { s:[2,8,4], c:[0,13,12], anim:'tail', pivot:[0,16,9], detail:true, tex:allTex('horse_tail') },
        { s:[1,8,10], c:[0,22,-3], detail:true, tex:allTex('horse_mane') },
      ],
    },
    iron_golem: {
      w: 1.35, h: 2.7, hp: 100, speed: 1.15, headPivot: [0, 39, -2], sound: null,
      drops: [{ id: () => Items.IT.IRON_INGOT, n: [3, 5] }, { id: () => Blocks.ID.FLOWER_RED, n: [0, 1] }], parts: [
        { s: [18, 18, 10], c: [0, 25, 0], anim: 'body', tex: allTex('iron_golem') },
        { s: [8, 10, 8], c: [0, 39, -2], anim: 'head', tex: boxTex('iron_golem_face', 'iron_golem') },
        { s: [6, 20, 6], c: [-4, 10, 0], anim: 'leg0', tex: allTex('iron_golem') },
        { s: [6, 20, 6], c: [4, 10, 0], anim: 'leg1', tex: allTex('iron_golem') },
        { s: [6, 24, 6], c: [-12, 23, 0], anim: 'armF0', tex: allTex('iron_golem') },
        { s: [6, 24, 6], c: [12, 23, 0], anim: 'armF1', tex: allTex('iron_golem') },
      ],
    },
    squid: {
      w: 0.8, h: 0.8, hp: 10, speed: 1.15, aquatic: true, headPivot: [0, 8, 0], sound: null,
      drops: [], parts: [
        { s: [12, 12, 12], c: [0, 10, 0], anim: 'body', tex: allTex('squid') },
        { s: [2, 9, 2], c: [-4, 0, -4], anim: 'tentacle0', tex: allTex('squid') },
        { s: [2, 9, 2], c: [0, 0, -5], anim: 'tentacle1', tex: allTex('squid') },
        { s: [2, 9, 2], c: [4, 0, -4], anim: 'tentacle2', tex: allTex('squid') },
        { s: [2, 9, 2], c: [-5, 0, 0], anim: 'tentacle3', tex: allTex('squid') },
        { s: [2, 9, 2], c: [5, 0, 0], anim: 'tentacle4', tex: allTex('squid') },
        { s: [2, 9, 2], c: [-4, 0, 4], anim: 'tentacle5', tex: allTex('squid') },
        { s: [2, 9, 2], c: [0, 0, 5], anim: 'tentacle6', tex: allTex('squid') },
        { s: [2, 9, 2], c: [4, 0, 4], anim: 'tentacle7', tex: allTex('squid') },
      ],
    },
    bat: {
      w: 0.5, h: 0.45, hp: 6, speed: 1.8, flying: true, headPivot: [0, 5, -2], sound: null,
      drops: [], parts: [
        { s: [5, 6, 4], c: [0, 5, 0], anim: 'body', tex: allTex('bat') },
        { s: [4, 4, 4], c: [0, 7, -3], anim: 'head', tex: boxTex('bat_face', 'bat') },
        { s: [8, 1, 5], c: [-6, 6, 0], anim: 'wing0', tex: allTex('bat_wing') },
        { s: [8, 1, 5], c: [6, 6, 0], anim: 'wing1', tex: allTex('bat_wing') },
      ],
    },
    blaze: {
      w: 0.65, h: 1.8, hp: 20, speed: 1.65, hostile: true, flying: true, dmg: 5,
      drops: [{ id: () => Items.IT.BLAZE_ROD, n: [0, 1] }], headPivot: [0, 22, 0], sound: null,
      parts: [
        { s: [8, 8, 8], c: [0, 22, 0], anim: 'head', tex: boxTex('blaze_face', 'blaze') },
        { s:[2,8,2], c:[0,18,0], orbit:{r:8,y:18,s:1.65,p:0}, tex:allTex('blaze_rod_mob') },
        { s:[2,8,2], c:[0,18,0], orbit:{r:8,y:18,s:1.65,p:2.094}, tex:allTex('blaze_rod_mob') },
        { s:[2,8,2], c:[0,18,0], orbit:{r:8,y:18,s:1.65,p:4.189}, tex:allTex('blaze_rod_mob') },
        { s:[2,8,2], c:[0,12,0], orbit:{r:10,y:12,s:-1.25,p:0.55}, tex:allTex('blaze_rod_mob') },
        { s:[2,8,2], c:[0,12,0], orbit:{r:10,y:12,s:-1.25,p:2.121}, tex:allTex('blaze_rod_mob') },
        { s:[2,8,2], c:[0,12,0], orbit:{r:10,y:12,s:-1.25,p:3.692}, tex:allTex('blaze_rod_mob') },
        { s:[2,8,2], c:[0,12,0], orbit:{r:10,y:12,s:-1.25,p:5.263}, tex:allTex('blaze_rod_mob') },
        { s:[2,8,2], c:[0,6,0], orbit:{r:7,y:6,s:1.9,p:0.3}, tex:allTex('blaze_rod_mob') },
        { s:[2,8,2], c:[0,6,0], orbit:{r:7,y:6,s:1.9,p:1.557}, tex:allTex('blaze_rod_mob') },
        { s:[2,8,2], c:[0,6,0], orbit:{r:7,y:6,s:1.9,p:2.813}, tex:allTex('blaze_rod_mob') },
        { s:[2,8,2], c:[0,6,0], orbit:{r:7,y:6,s:1.9,p:4.07}, tex:allTex('blaze_rod_mob') },
        { s:[2,8,2], c:[0,6,0], orbit:{r:7,y:6,s:1.9,p:5.327}, tex:allTex('blaze_rod_mob') },
      ],
    },
    ender_dragon: {
      w: 5.0, h: 3.0, hp: 200, speed: 4.0, hostile: true, flying: true, boss: true, dmg: 10,
      drops: [], headPivot: [0, 30, -28], sound: null, parts: [
        { s: [24, 20, 42], c: [0, 24, 2], anim: 'body', tex: allTex('dragon_body') },
        { s: [16, 14, 18], c: [0, 30, -28], anim: 'head', tex: boxTex('dragon_face', 'dragon_body') },
        { s: [8, 8, 16], c: [0, 27, -44], anim: 'head', tex: allTex('dragon_body') },
        { s: [48, 2, 24], c: [-30, 31, 2], anim: 'wing0', tex: allTex('dragon_wing') },
        { s: [48, 2, 24], c: [30, 31, 2], anim: 'wing1', tex: allTex('dragon_wing') },
        { s: [7, 22, 7], c: [-9, 10, -5], anim: 'leg0', tex: allTex('dragon_body') },
        { s: [7, 22, 7], c: [9, 10, -5], anim: 'leg1', tex: allTex('dragon_body') },
        { s: [8, 8, 30], c: [0, 23, 36], anim: 'tail', pivot: [0, 23, 20], tex: allTex('dragon_body') },
      ],
    },
  };

  const QUARTER_TURN_X = [Math.PI / 2, 0, 0];
  const HORSE_NECK_ROT = [-Math.PI / 6, 0, 0];
  const HORSE_TAIL_BASE_ROT = [1.134464, 0, 0];
  const HORSE_TAIL_TIP_ROT = [1.40215, 0, 0];
  const originalVariant = (kind, config) => Object.assign({}, MODELS[kind], config);

  function originalBlazeModel() {
    const parts = [
      { s:[8,8,8], c:[0,22,0], anim:'head', tex:packedFaceTex('blaze_original_head', 'blaze') },
    ];
    const rings = [
      { first:0, count:4, radius:9, y:20, speed:-Math.PI * 0.1, phase:0, ySpeed:0.25, yPhase:0, yStep:0.5 },
      { first:4, count:4, radius:7, y:16, speed:Math.PI * 0.03, phase:Math.PI / 4, ySpeed:0.25, yPhase:2, yStep:0.5 },
      { first:8, count:4, radius:5, y:7, speed:-Math.PI * 0.05, phase:0.47123894, ySpeed:0.5, yPhase:6, yStep:0.75 },
    ];
    for (const ring of rings) for (let i = 0; i < ring.count; i++) {
      parts.push({
        s:[2,8,2], c:[0,ring.y,0], tex:packedFaceTex('blaze_original_rod', 'blaze_rod_mob'),
        orbit:{
          r:ring.radius, y:ring.y, s:ring.speed, p:ring.phase + i,
          xOffset:1, zOffset:1, yAmp:-1, ySpeed:ring.ySpeed,
          yPhase:ring.yPhase + i * ring.yStep,
        },
      });
    }
    return originalVariant('blaze', { headPivot:[0,22,0], parts });
  }

  function originalDragonModel() {
    const parts = [
      { s:[24,24,64], c:[0,24,8], anim:'body', tex:packedFaceTex('dragon_original_body', 'dragon_body') },
      { s:[2,6,12], c:[0,39,-2], anim:'body', detail:true, tex:packedFaceTex('dragon_original_body_scale', 'dragon_face') },
      { s:[2,6,12], c:[0,39,18], anim:'body', detail:true, tex:packedFaceTex('dragon_original_body_scale', 'dragon_face') },
      { s:[2,6,12], c:[0,39,38], anim:'body', detail:true, tex:packedFaceTex('dragon_original_body_scale', 'dragon_face') },
    ];

    for (let i = 0; i < 5; i++) {
      const y = 29 + i;
      const z = -20 - i * 10;
      parts.push(
        { s:[10,10,10], c:[0,y,z], tex:packedFaceTex('dragon_original_spine', 'dragon_wing') },
        { s:[2,4,6], c:[0,y + 7,z], detail:true, tex:packedFaceTex('dragon_original_spine_scale', 'blaze_face') }
      );
    }

    parts.push(
      { s:[16,16,16], c:[0,34,-64], anim:'head', tex:packedFaceTex('dragon_original_upper_head', 'cow_udder') },
      { s:[16.25,16.25,16.25], c:[0,34,-64], anim:'head', detail:true, tex:packedFaceTex('dragon_original_eyes', 'chicken_beak') },
      { s:[12,5,16], c:[0,30.5,-78], anim:'head', tex:packedFaceTex('dragon_original_upper_lip', 'cow_tail') },
      { s:[12,4,16], c:[0,25.5,-78], anim:'head', tex:packedFaceTex('dragon_original_jaw', 'sheep_wool_cap') },
      { s:[2,4,6], c:[-4,45,-63], anim:'head', mirror:true, detail:true, tex:packedFaceTex('dragon_original_head_scale', 'sheep_ear') },
      { s:[2,4,6], c:[4,45,-63], anim:'head', detail:true, tex:packedFaceTex('dragon_original_head_scale', 'sheep_ear') },
      { s:[2,2,4], c:[-4,31,-84], anim:'head', mirror:true, detail:true, tex:packedFaceTex('dragon_original_nostril', 'sheep_tail') },
      { s:[2,2,4], c:[4,31,-84], anim:'head', detail:true, tex:packedFaceTex('dragon_original_nostril', 'sheep_tail') }
    );

    for (const side of [-1, 1]) {
      const wingAnim = side < 0 ? 'wing0' : 'wing1';
      parts.push(
        { s:[56,8,8], c:[side * 40,31,2], anim:wingAnim, joint:[side * -28,0,0], mirror:side > 0, tex:packedFaceTex('dragon_original_wing_bone', 'chicken_wattle') },
        { s:[56,0,56], c:[side * 40,31,32], anim:wingAnim, joint:[side * -28,0,0], mirror:side > 0, detail:true, tex:packedAllTex('dragon_original_wing_skin', 'chicken_leg') },
        { s:[56,4,4], c:[side * 96,31,2], anim:wingAnim, joint:[side * -28,0,0], mirror:side > 0, tex:packedFaceTex('dragon_original_wing_tip_bone', 'wolf') },
        { s:[56,0,56], c:[side * 96,31,32], anim:wingAnim, joint:[side * -28,0,0], mirror:side > 0, detail:true, tex:packedAllTex('dragon_original_wing_tip_skin', 'wolf_face') },

        { s:[8,24,8], c:[side * 12,19,-4], rot:[1.3,0,0], tex:packedFaceTex('dragon_original_front_leg', 'cat_face') },
        { s:[6,24,6], c:[side * 12,9,-12], rot:[-0.5,0,0], tex:packedFaceTex('dragon_original_front_leg_tip', 'horse') },
        { s:[8,4,16], c:[side * 12,2,-21], rot:[0.75,0,0], tex:packedFaceTex('dragon_original_front_foot', 'horse_face') },
        { s:[16,32,16], c:[side * 16,21,25], rot:[1,0,0], tex:packedFaceTex('dragon_original_rear_leg', 'horse_tail') },
        { s:[12,32,12], c:[side * 16,10,39], rot:[0.5,0,0], tex:packedFaceTex('dragon_original_rear_leg_tip', 'horse_mane') },
        { s:[18,6,24], c:[side * 16,3,51], rot:[0.75,0,0], tex:packedFaceTex('dragon_original_rear_foot', 'zombie_face') }
      );
    }

    for (let i = 0; i < 12; i++) {
      const y = 23 - Math.sin(i * 0.45) * 2;
      const z = 49 + i * 10;
      parts.push(
        { s:[10,10,10], c:[0,y,z], anim:'tail', pivot:[0,23,40], tex:packedFaceTex('dragon_original_spine', 'dragon_wing') },
        { s:[2,4,6], c:[0,y + 7,z], anim:'tail', pivot:[0,23,40], detail:true, tex:packedFaceTex('dragon_original_spine_scale', 'blaze_face') }
      );
    }
    return originalVariant('ender_dragon', { headPivot:[0,34,-64], parts });
  }

  function originalSpiderLeg(side, pair, z, yaw, roll) {
    return {
      s:[16,2,2], c:[side * 11,9,z], anim:'spiderLeg',
      spiderLeg:{ side, pair, pivot:[side * 4,9,z], yaw, roll },
      tex:packedFaceTex('spider_original_leg', 'creeper_charge'),
    };
  }

  const ORIGINAL_MODELS = Object.freeze(Object.assign({}, MODELS, {
    zombie: originalVariant('zombie', {
      headPivot:[0,28,0], parts: [
        { s:[8,12,4], c:[0,18,0], tex:faceTex('zombie_body') },
        { s:[8,8,8], c:[0,28,0], anim:'head', tex:faceTex('zombie_head') },
        { s:[4,12,4], c:[-1.9,6,0], anim:'leg0', joint:[0,6,0], tex:faceTex('zombie_leg') },
        { s:[4,12,4], c:[1.9,6,0], anim:'leg1', joint:[0,6,0], mirror:true, tex:faceTex('zombie_leg') },
        { s:[4,12,4], c:[-6,18,0], anim:'armF0', joint:[1,4,0], tex:faceTex('zombie_arm') },
        { s:[4,12,4], c:[6,18,0], anim:'armF1', joint:[-1,4,0], mirror:true, tex:faceTex('zombie_arm') },
      ],
    }),
    skeleton: originalVariant('skeleton', {
      headPivot:[0,28,0], parts: [
        { s:[8,12,4], c:[0,18,0], tex:faceTex('skeleton_body') },
        { s:[8,8,8], c:[0,28,0], anim:'head', tex:faceTex('skeleton_head') },
        { s:[2,12,2], c:[-2,6,0], anim:'leg0', joint:[0,6,0], tex:faceTex('skeleton_limb') },
        { s:[2,12,2], c:[2,6,0], anim:'leg1', joint:[0,6,0], mirror:true, tex:faceTex('skeleton_limb') },
        { s:[2,12,2], c:[-5,18,0], anim:'armF0', joint:[0,4,0], tex:faceTex('skeleton_limb') },
        { s:[2,12,2], c:[5,18,0], anim:'armF1', joint:[0,4,0], mirror:true, tex:faceTex('skeleton_limb') },
      ],
    }),
    creeper: originalVariant('creeper', {
      headPivot:[0,22,0], parts: [
        { s:[8,12,4], c:[0,12,0], anim:'body', tex:faceTex('creeper_body') },
        { s:[8,8,8], c:[0,22,0], anim:'head', tex:faceTex('creeper_head') },
        { s:[4,6,4], c:[-2,3,4], anim:'leg0', joint:[0,3,0], tex:faceTex('creeper_leg') },
        { s:[4,6,4], c:[2,3,4], anim:'leg1', joint:[0,3,0], tex:faceTex('creeper_leg') },
        { s:[4,6,4], c:[-2,3,-4], anim:'leg1', joint:[0,3,0], tex:faceTex('creeper_leg') },
        { s:[4,6,4], c:[2,3,-4], anim:'leg0', joint:[0,3,0], tex:faceTex('creeper_leg') },
      ],
    }),
    spider: originalVariant('spider', {
      headPivot:[0,9,-7], parts: [
        { s:[8,8,8], c:[0,9,-7], anim:'head', tex:packedFaceTex('spider_original_head', 'spider_head') },
        { s:[6,6,6], c:[0,9,0], anim:'body', tex:packedFaceTex('spider_original_neck', 'spider_body') },
        { s:[10,8,12], c:[0,9,9], anim:'body', tex:packedFaceTex('spider_original_body', 'spider_leg') },
        originalSpiderLeg(-1,0,2,Math.PI / 4,-Math.PI / 4),
        originalSpiderLeg(1,0,2,-Math.PI / 4,Math.PI / 4),
        originalSpiderLeg(-1,1,1,Math.PI / 8,-0.58119464),
        originalSpiderLeg(1,1,1,-Math.PI / 8,0.58119464),
        originalSpiderLeg(-1,2,0,-Math.PI / 8,-0.58119464),
        originalSpiderLeg(1,2,0,Math.PI / 8,0.58119464),
        originalSpiderLeg(-1,3,-1,-Math.PI / 4,-Math.PI / 4),
        originalSpiderLeg(1,3,-1,Math.PI / 4,Math.PI / 4),
        { s:[8.04,8.04,8.04], c:[0,9,-7], anim:'head', detail:true, tex:packedFaceTex('spider_original_eyes', 'skeleton') },
      ],
    }),
    slime: originalVariant('slime', {
      headPivot:[0,4,0], parts: [
        { s:[8,8,8], c:[0,4,0], anim:'body', layer:true, detail:true, tex:packedFaceTex('slime_original_outer', 'slime') },
        { s:[6,6,6], c:[0,4,0], anim:'body', tex:packedFaceTex('slime_original_inner', 'slime_core') },
        { s:[2,2,2], c:[-2.25,5,-2.5], tex:packedFaceTex('slime_original_right_eye', 'slime_eye') },
        { s:[2,2,2], c:[2.25,5,-2.5], tex:packedFaceTex('slime_original_left_eye', 'slime_mouth') },
        { s:[1,1,1], c:[0.5,2.5,-3], detail:true, tex:packedFaceTex('slime_original_mouth', 'pig_ear') },
      ],
    }),
    enderman: originalVariant('enderman', {
      headPivot:[0,42,0], parts: [
        { s:[8,12,4], c:[0,33,0], anim:'body', tex:packedFaceTex('enderman_original_body', 'pig_tail') },
        { s:[8,8,8], c:[0,42,0], anim:'head', tex:packedFaceTex('enderman_original_head', 'enderman') },
        { s:[2,30,2], c:[-2,15,0], anim:'leg0', joint:[0,15,0], tex:packedFaceTex('enderman_original_limb', 'cow_ear') },
        { s:[2,30,2], c:[2,15,0], anim:'leg1', joint:[0,15,0], mirror:true, tex:packedFaceTex('enderman_original_limb', 'cow_ear') },
        { s:[2,30,2], c:[-3,24,0], anim:'armF0', joint:[0,13,0], tex:packedFaceTex('enderman_original_limb', 'cow_ear') },
        { s:[2,30,2], c:[5,24,0], anim:'armF1', joint:[0,13,0], mirror:true, tex:packedFaceTex('enderman_original_limb', 'cow_ear') },
        { s:[7,7,7], c:[0,42,0], anim:'head', layer:true, detail:true, tex:packedFaceTex('enderman_original_headwear', 'enderman_face') },
        { s:[8.04,8.04,8.04], c:[0,42,0], anim:'head', detail:true, tex:packedFaceTex('enderman_original_eyes', 'cow_horn') },
      ],
    }),
    blaze: originalBlazeModel(),
    ender_dragon: originalDragonModel(),
    pig: originalVariant('pig', {
      headPivot: [0,12,-6],
      parts: [
        { s:[10,16,8], c:[0,10,0], rot:QUARTER_TURN_X, anim:'body', tex:faceTex('pig_body') },
        { s:[8,8,8], c:[0,12,-10], anim:'head', tex:faceTex('pig_head') },
        { s:[4,3,1], c:[0,10.5,-14.5], anim:'head', tex:faceTex('pig_snout') },
        { s:[4,6,4], c:[-3,3,-5], anim:'leg0', tex:faceTex('pig_leg') },
        { s:[4,6,4], c:[3,3,-5], anim:'leg1', tex:faceTex('pig_leg') },
        { s:[4,6,4], c:[-3,3,7], anim:'leg1', tex:faceTex('pig_leg') },
        { s:[4,6,4], c:[3,3,7], anim:'leg0', tex:faceTex('pig_leg') },
      ],
    }),
    cow: originalVariant('cow', {
      headPivot: [0,20,-8],
      parts: [
        { s:[12,18,10], c:[0,17,1], rot:QUARTER_TURN_X, anim:'body', tex:faceTex('cow_body') },
        { s:[8,8,6], c:[0,20,-11], anim:'head', tex:faceTex('cow_head') },
        { s:[1,3,1], c:[-4.5,23.5,-11.5], anim:'head', detail:true, tex:faceTex('cow_horn') },
        { s:[1,3,1], c:[4.5,23.5,-11.5], anim:'head', detail:true, tex:faceTex('cow_horn') },
        { s:[4,6,1], c:[0,11.5,7], rot:QUARTER_TURN_X, detail:true, tex:faceTex('cow_udder') },
        { s:[4,12,4], c:[-4,6,-5], anim:'leg0', tex:faceTex('cow_leg') },
        { s:[4,12,4], c:[4,6,-5], anim:'leg1', tex:faceTex('cow_leg') },
        { s:[4,12,4], c:[-4,6,7], anim:'leg1', tex:faceTex('cow_leg') },
        { s:[4,12,4], c:[4,6,7], anim:'leg0', tex:faceTex('cow_leg') },
      ],
    }),
    sheep: originalVariant('sheep', {
      headPivot: [0,12,-8],
      parts: [
        { s:[8,16,6], c:[0,9,0], rot:QUARTER_TURN_X, anim:'body', tex:faceTex('sheep_body') },
        { s:[11.5,19.5,9.5], c:[0,9,0], rot:QUARTER_TURN_X, anim:'body', when:'wool', detail:true, tex:faceTex('sheep_wool') },
        { s:[6,6,8], c:[0,13,-10], anim:'head', tex:faceTex('sheep_head') },
        { s:[7.2,7.2,7.2], c:[0,13,-9], anim:'head', when:'wool', detail:true, tex:faceTex('sheep_wool_head') },
        { s:[4,6,4], c:[-3,3,-5], anim:'leg0', tex:faceTex('sheep_leg') },
        { s:[4,6,4], c:[3,3,-5], anim:'leg1', tex:faceTex('sheep_leg') },
        { s:[4,6,4], c:[-3,3,7], anim:'leg1', tex:faceTex('sheep_leg') },
        { s:[4,6,4], c:[3,3,7], anim:'leg0', tex:faceTex('sheep_leg') },
        { s:[5,7,5], c:[-3,3,-5], anim:'leg0', when:'wool', detail:true, tex:faceTex('sheep_wool_leg') },
        { s:[5,7,5], c:[3,3,-5], anim:'leg1', when:'wool', detail:true, tex:faceTex('sheep_wool_leg') },
        { s:[5,7,5], c:[-3,3,7], anim:'leg1', when:'wool', detail:true, tex:faceTex('sheep_wool_leg') },
        { s:[5,7,5], c:[3,3,7], anim:'leg0', when:'wool', detail:true, tex:faceTex('sheep_wool_leg') },
      ],
    }),
    chicken: originalVariant('chicken', {
      headPivot: [0,9,-4],
      parts: [
        { s:[6,8,6], c:[0,8,0], rot:QUARTER_TURN_X, anim:'body', tex:faceTex('chicken_body') },
        { s:[4,6,3], c:[0,12,-4.5], anim:'head', tex:faceTex('chicken_head') },
        { s:[4,2,2], c:[0,12,-7], anim:'head', detail:true, tex:faceTex('chicken_beak') },
        { s:[2,2,2], c:[0,10,-6], anim:'head', detail:true, tex:faceTex('chicken_wattle') },
        { s:[3,5,3], c:[-2,2.5,-0.5], anim:'leg0', joint:[0,2.5,0], tex:faceTex('chicken_leg') },
        { s:[3,5,3], c:[2,2.5,-0.5], anim:'leg1', joint:[0,2.5,0], tex:faceTex('chicken_leg') },
        { s:[1,4,6], c:[-3.5,9,0], anim:'wing0', joint:[0.5,2,0], detail:true, tex:faceTex('chicken_wing') },
        { s:[1,4,6], c:[3.5,9,0], anim:'wing1', joint:[-0.5,2,0], detail:true, tex:faceTex('chicken_wing') },
      ],
    }),
    wolf: originalVariant('wolf', {
      headPivot: [0, 13, -7],
      parts: [
        { s:[6,9,6], c:[0,11,1], rot:QUARTER_TURN_X, anim:'body', tex:faceTex('wolf_body') },
        { s:[6,6,4], c:[0,13,-7], anim:'head', tex:faceTex('wolf_head') },
        { s:[3,3,4], c:[0,11.5,-11], anim:'head', detail:true, tex:faceTex('wolf_muzzle') },
        { s:[2,2,1], c:[-2,16,-6.5], anim:'head', detail:true, tex:faceTex('wolf_ear') },
        { s:[2,2,1], c:[2,16,-6.5], anim:'head', detail:true, tex:faceTex('wolf_ear') },
        { s:[2,8,2], c:[-2,4,-3], anim:'leg0', joint:[0,4,0], tex:faceTex('wolf_leg') },
        { s:[2,8,2], c:[2,4,-3], anim:'leg1', joint:[0,4,0], tex:faceTex('wolf_leg') },
        { s:[2,8,2], c:[-2,4,5], anim:'leg1', joint:[0,4,0], tex:faceTex('wolf_leg') },
        { s:[2,8,2], c:[2,4,5], anim:'leg0', joint:[0,4,0], tex:faceTex('wolf_leg') },
        { s:[2,8,2], c:[0,13,8], anim:'tail', pivot:[0,11,6], rot:[0.7,0,0], tex:faceTex('wolf_tail') },
        { s:[7,2,5], c:[0,12,-5], anim:'head', when:'tamed', detail:true, tex:allTex('wolf_collar') },
      ],
    }),
    cat: originalVariant('cat', {
      headPivot: [0, 11, -7],
      parts: [
        { s:[4,16,6], c:[0,9,1], rot:QUARTER_TURN_X, anim:'body', tex:faceTex('cat_body') },
        { s:[5,4,5], c:[0,11,-7], anim:'head', tex:faceTex('cat_head') },
        { s:[3,2,2], c:[0,10,-10.5], anim:'head', detail:true, tex:faceTex('cat_muzzle') },
        { s:[1,1,2], c:[-2,13.5,-6.5], anim:'head', detail:true, tex:faceTex('cat_ear') },
        { s:[1,1,2], c:[2,13.5,-6.5], anim:'head', detail:true, tex:faceTex('cat_ear') },
        { s:[2,10,2], c:[-2,5,-4], anim:'leg0', joint:[0,5,0], tex:faceTex('cat_leg') },
        { s:[2,10,2], c:[2,5,-4], anim:'leg1', joint:[0,5,0], tex:faceTex('cat_leg') },
        { s:[2,6,2], c:[-2,3,5], anim:'leg1', joint:[0,3,0], tex:faceTex('cat_leg') },
        { s:[2,6,2], c:[2,3,5], anim:'leg0', joint:[0,3,0], tex:faceTex('cat_leg') },
        { s:[1,8,1], c:[0,10,7], anim:'tail', pivot:[0,7,7], rot:[0.35,0,0], tex:faceTex('cat_tail') },
        { s:[1,8,1], c:[0,16,9], anim:'tail', pivot:[0,12,8], rot:[-0.55,0,0], tex:faceTex('cat_tail') },
      ],
    }),
    horse: originalVariant('horse', {
      headPivot: [0,20,-10],
      parts: [
        { s:[10,10,24], c:[0,16,2], anim:'body', tex:faceTex('horse_original_body') },

        { s:[4,9,5], c:[3.5,12.5,11], anim:'leg0', joint:[0,2.5,0], tex:faceTex('horse_original_leg') },
        { s:[3,5,3], c:[3.5,5.5,11], anim:'leg0', joint:[0,9.5,0], tex:faceTex('horse_original_shin') },
        { s:[4,3,4], c:[3.5,1.4,11], anim:'leg0', joint:[0,13.6,0], tex:faceTex('horse_original_hoof') },
        { s:[4,9,5], c:[-3.5,12.5,11], anim:'leg1', joint:[0,2.5,0], tex:faceTex('horse_original_leg') },
        { s:[3,5,3], c:[-3.5,5.5,11], anim:'leg1', joint:[0,9.5,0], tex:faceTex('horse_original_shin') },
        { s:[4,3,4], c:[-3.5,1.4,11], anim:'leg1', joint:[0,13.6,0], tex:faceTex('horse_original_hoof') },

        { s:[3,8,4], c:[3.6,12,-8.1], anim:'leg1', joint:[0,3,0.1], tex:faceTex('horse_original_leg') },
        { s:[3,5,3], c:[3.6,5.5,-8.1], anim:'leg1', joint:[0,9.5,0.1], tex:faceTex('horse_original_shin') },
        { s:[4,3,4], c:[3.6,1.4,-8.1], anim:'leg1', joint:[0,13.6,0.1], tex:faceTex('horse_original_hoof') },
        { s:[3,8,4], c:[-3.6,12,-8.1], anim:'leg0', joint:[0,3,0.1], tex:faceTex('horse_original_leg') },
        { s:[3,5,3], c:[-3.6,5.5,-8.1], anim:'leg0', joint:[0,9.5,0.1], tex:faceTex('horse_original_shin') },
        { s:[4,3,4], c:[-3.6,1.4,-8.1], anim:'leg0', joint:[0,13.6,0.1], tex:faceTex('horse_original_hoof') },

        { s:[4,14,8], c:[-0.05,23.425,-9.668], anim:'head', rot:HORSE_NECK_ROT, tex:faceTex('horse_original_neck') },
        { s:[2,16,4], c:[0,26.531,-5.688], anim:'head', rot:HORSE_NECK_ROT, tex:faceTex('horse_original_mane') },
        { s:[5,5,7], c:[0,27.495,-12.018], anim:'head', rot:HORSE_NECK_ROT, tex:faceTex('horse_original_head') },
        { s:[4,3,6], c:[0,25.411,-17.714], anim:'head', rot:HORSE_NECK_ROT, tex:faceTex('horse_original_upper_mouth') },
        { s:[4,2,5], c:[0,23.196,-16.464], anim:'head', rot:HORSE_NECK_ROT, tex:faceTex('horse_original_lower_mouth') },
        { s:[2,3,1], c:[1.45,31.343,-11.353], anim:'head', rot:HORSE_NECK_ROT, wiggle:'ear0', tex:faceTex('horse_original_ear') },
        { s:[2,3,1], c:[-1.45,31.343,-11.353], anim:'head', rot:HORSE_NECK_ROT, wiggle:'ear1', tex:faceTex('horse_original_ear') },

        { s:[2,2,3], c:[0,19.641,14.634], anim:'tail', pivot:[0,21,14], rot:HORSE_TAIL_BASE_ROT, tex:faceTex('horse_original_tail') },
        { s:[3,4,7], c:[0,15.109,16.747], anim:'tail', pivot:[0,21,14], rot:HORSE_TAIL_BASE_ROT, tex:faceTex('horse_original_tail') },
        { s:[3,4,7], c:[0,9.093,18.553], anim:'tail', pivot:[0,21,14], rot:HORSE_TAIL_TIP_ROT, tex:faceTex('horse_original_tail') },
      ],
    }),
    squid: originalVariant('squid', {
      parts: [
        { s:[12,16,12], c:[0,10,0], anim:'body', tex:allTex('squid') },
        { s:[2,18,2], c:[-4,-7,-4], anim:'tentacle0', tex:allTex('squid') },
        { s:[2,18,2], c:[0,-7,-5], anim:'tentacle1', tex:allTex('squid') },
        { s:[2,18,2], c:[4,-7,-4], anim:'tentacle2', tex:allTex('squid') },
        { s:[2,18,2], c:[-5,-7,0], anim:'tentacle3', tex:allTex('squid') },
        { s:[2,18,2], c:[5,-7,0], anim:'tentacle4', tex:allTex('squid') },
        { s:[2,18,2], c:[-4,-7,4], anim:'tentacle5', tex:allTex('squid') },
        { s:[2,18,2], c:[0,-7,5], anim:'tentacle6', tex:allTex('squid') },
        { s:[2,18,2], c:[4,-7,4], anim:'tentacle7', tex:allTex('squid') },
      ],
    }),
    bat: originalVariant('bat', {
      headPivot: [0, 8, -2],
      parts: [
        { s:[3,5,2], c:[0,5,0], anim:'body', tex:allTex('bat') },
        { s:[6,6,6], c:[0,8,-2], anim:'head', tex:boxTex('bat_face', 'bat') },
        { s:[10,1,6], c:[-6.5,6,0], anim:'wing0', tex:allTex('bat_wing') },
        { s:[10,1,6], c:[6.5,6,0], anim:'wing1', tex:allTex('bat_wing') },
      ],
    }),
    villager: originalVillagerModel('unemployed'),
    iron_golem: originalVariant('iron_golem', {
      headPivot: [0,34,-2],
      parts: [
        { s:[18,12,11], c:[0,25,0], anim:'body', tex:faceTex('iron_golem_original_body') },
        { s:[8,10,8], c:[0,39,-2], anim:'head', tex:faceTex('iron_golem_original_head') },
        { s:[6,16,5], c:[-4,8,0], anim:'leg0', tex:faceTex('iron_golem_original_leg_left') },
        { s:[6,16,5], c:[4,8,0], anim:'leg1', tex:faceTex('iron_golem_original_leg_right') },
        { s:[4,30,6], c:[-11,23,0], anim:'golemArm0', tex:faceTex('iron_golem_original_arm_left') },
        { s:[4,30,6], c:[11,23,0], anim:'golemArm1', tex:faceTex('iron_golem_original_arm_right') },
        { s:[2,4,2], c:[0,37,-7], anim:'head', detail:true, tex:faceTex('iron_golem_original_nose') },
        { s:[10,6,7], c:[0,16.5,0], anim:'body', layer:true, detail:true, tex:faceTex('iron_golem_original_waist') },
      ],
    }),
  }));
  let activeModelProfile = 'original';

  function modelForKind(kind) {
    if (activeModelProfile === 'original' && ORIGINAL_MODELS[kind]) return ORIGINAL_MODELS[kind];
    return MODELS[kind];
  }

  const VILLAGER_MODELS = Object.freeze({
    unemployed: MODELS.villager,
    farmer: villagerModel('villager_farmer', true),
    librarian: villagerModel('villager_librarian', true),
    toolsmith: villagerModel('villager_toolsmith', true),
    butcher: villagerModel('villager_butcher', true),
    cleric: villagerModel('villager_cleric', true),
  });
  const ORIGINAL_VILLAGER_MODELS = Object.freeze({
    unemployed: ORIGINAL_MODELS.villager,
    farmer: originalVillagerModel('farmer'),
    librarian: originalVillagerModel('librarian'),
    toolsmith: originalVillagerModel('toolsmith'),
    butcher: originalVillagerModel('butcher'),
    cleric: originalVillagerModel('cleric'),
  });
  const VILLAGER_TRADES = Object.freeze({
    unemployed: { cost: 1, id: Items.IT.BREAD, n: 2, uses: 4 },
    farmer: { cost: 1, id: Items.IT.BREAD, n: 6, uses: 8 },
    librarian: { cost: 2, id: Items.IT.BOOK, n: 1, uses: 6 },
    toolsmith: { cost: 4, id: Items.IT.PICK_IRON, n: 1, uses: 3 },
    butcher: { cost: 1, id: Items.IT.BEEF_COOKED, n: 3, uses: 6 },
    cleric: { cost: 2, id: Items.IT.GLOWSTONE_DUST, n: 4, uses: 5 },
  });

  function entityModel(e) {
    if (e && e.kind === 'villager') {
      const variants = activeModelProfile === 'original' ? ORIGINAL_VILLAGER_MODELS : VILLAGER_MODELS;
      return variants[e.profession] || variants.unemployed;
    }
    return modelForKind(e && e.kind);
  }

  const PLAYER_SKINS = Object.freeze(['steve', 'alex', 'miner', 'wanderer']);
  function playerSkinTex(skin, part) {
    const tex = {};
    for (const face of ['front', 'back', 'left', 'right', 'top', 'bottom']) tex[face] = 'skin.' + skin + '.' + part + '.' + face;
    return tex;
  }
  function makeRemotePlayerModel(skin, modelType, originalProfile) {
    const slim = modelType === 'slim';
    const armWidth = slim ? 3 : 4;
    const armX = slim ? 5.5 : 6;
    const jacketSize = originalProfile ? [8.5, 12.5, 4.5] : [9, 13, 5];
    return {
      w: 0.6, h: 1.8, headPivot: [0, 28, 0], skin, modelType: slim ? 'slim' : 'classic', parts: [
        { s: [8, 12, 4], c: [0, 18, 0], anim: 'body', tex: playerSkinTex(skin, 'body') },
        { s: jacketSize, c: [0, 18, 0], anim: 'body', layer: true, detail: true, tex: playerSkinTex(skin, 'jacket') },
        { s: [8, 8, 8], c: [0, 28, 0], anim: 'head', tex: playerSkinTex(skin, 'head') },
        { s: [9, 9, 9], c: [0, 28, 0], anim: 'head', layer: true, detail: true, tex: playerSkinTex(skin, 'hat') },
        { s: [4, 12, 4], c: [-2, 6, 0], anim: 'leg0', tex: playerSkinTex(skin, 'legL') },
        { s: [4.5, 12.5, 4.5], c: [-2, 6, 0], anim: 'leg0', layer: true, detail: true, tex: playerSkinTex(skin, 'pantsL') },
        { s: [4, 12, 4], c: [2, 6, 0], anim: 'leg1', tex: playerSkinTex(skin, 'legR') },
        { s: [4.5, 12.5, 4.5], c: [2, 6, 0], anim: 'leg1', layer: true, detail: true, tex: playerSkinTex(skin, 'pantsR') },
        { s: [armWidth, 12, 4], c: [-armX, 18, 0], anim: 'arm0', tex: playerSkinTex(skin, 'armL') },
        { s: [armWidth + 0.5, 12.5, 4.5], c: [-armX, 18, 0], anim: 'arm0', layer: true, detail: true, tex: playerSkinTex(skin, 'sleeveL') },
        { s: [armWidth, 12, 4], c: [armX, 18, 0], anim: 'arm1', tex: playerSkinTex(skin, 'armR') },
        { s: [armWidth + 0.5, 12.5, 4.5], c: [armX, 18, 0], anim: 'arm1', layer: true, detail: true, tex: playerSkinTex(skin, 'sleeveR') },
      ],
    };
  }
  const REMOTE_PLAYER_MODELS = new Map();
  const ORIGINAL_REMOTE_PLAYER_MODELS = new Map();
  for (const skin of PLAYER_SKINS) for (const modelType of ['classic', 'slim']) {
    REMOTE_PLAYER_MODELS.set(skin + ':' + modelType, makeRemotePlayerModel(skin, modelType));
    ORIGINAL_REMOTE_PLAYER_MODELS.set(skin + ':' + modelType, makeRemotePlayerModel(skin, modelType, true));
  }
  function remotePlayerModel(e) {
    const skin = PLAYER_SKINS.includes(e && e.skin) ? e.skin : 'steve';
    const modelType = e && e.modelType === 'slim' ? 'slim' : 'classic';
    const models = activeModelProfile === 'original' ? ORIGINAL_REMOTE_PLAYER_MODELS : REMOTE_PLAYER_MODELS;
    return models.get(skin + ':' + modelType);
  }
  const MINECART_MODEL = Object.freeze({
    w: 20 / 16, h: 11 / 16, parts: Object.freeze([
      { s:[20,2,16], c:[0,2,0], tex:allTex('minecart') },
      { s:[2,8,16], c:[-9,7,0], tex:allTex('minecart') },
      { s:[2,8,16], c:[9,7,0], tex:allTex('minecart') },
      { s:[16,8,2], c:[0,7,-7], tex:allTex('minecart') },
      { s:[16,8,2], c:[0,7,7], tex:allTex('minecart') },
    ]),
  });
  const MINECART_RIDER_Y_OFFSET = 3 / 16;

  function setModelProfile(profile) {
    const next = profile === 'original' || profile === 'original_1_12' ? 'original' : 'default';
    if (next === activeModelProfile) return false;
    activeModelProfile = next;
    for (const entity of list) {
      if (entity.type !== 'mob') continue;
      const model = entityModel(entity);
      if (!model) continue;
      entity.model = model;
      const scale = entity.babyTime > 0 ? 0.55 : 1;
      entity.w = model.w * scale;
      entity.h = model.h * scale;
    }
    geometryVersion++;
    return true;
  }
  const REMOTE_ARMOR_CACHE = new Map();
  function remoteArmorParts(slot, material, modelType, enchanted) {
    const key = slot + ':' + material + ':' + modelType + ':' + (enchanted ? 1 : 0);
    if (REMOTE_ARMOR_CACHE.has(key)) return REMOTE_ARMOR_CACHE.get(key);
    const tex = faceTex('remote_armor_' + material);
    const armWidth = modelType === 'slim' ? 4 : 5;
    const armX = modelType === 'slim' ? 5.5 : 6;
    let parts;
    if (slot === 0) parts = [{ s:[9.5,9.5,9.5], c:[0,28,0], anim:'head', armor:true, tex }];
    else if (slot === 1) parts = [
      { s:[9,13,5], c:[0,18,0], anim:'body', armor:true, tex },
      { s:[armWidth,13,5], c:[-armX,18,0], anim:'arm0', armor:true, tex },
      { s:[armWidth,13,5], c:[armX,18,0], anim:'arm1', armor:true, tex },
    ];
    else if (slot === 2) parts = [
      { s:[9,4,5], c:[0,11,0], armor:true, tex },
      { s:[4.8,10,4.8], c:[-2,6.5,0], anim:'leg0', armor:true, tex },
      { s:[4.8,10,4.8], c:[2,6.5,0], anim:'leg1', armor:true, tex },
    ];
    else parts = [
      { s:[4.9,5.5,5.1], c:[-2,2.75,-0.05], anim:'leg0', armor:true, tex },
      { s:[4.9,5.5,5.1], c:[2,2.75,-0.05], anim:'leg1', armor:true, tex },
    ];
    if (enchanted) {
      const glint = allTex('remote_armor_glint');
      parts = parts.concat(parts.map(part => ({
        s: part.s.map(value => value + 0.22), c: part.c.slice(), anim: part.anim,
        armor: true, glint: true, detail: true, tex: glint,
      })));
    }
    REMOTE_ARMOR_CACHE.set(key, parts);
    return parts;
  }
  function pushRemoteArmor(out, glintOut, e, world, light) {
    const equipment = Array.isArray(e.equipment) ? e.equipment : [];
    for (let slot = 0; slot < 4; slot++) {
      const stack = equipment[slot];
      const id = Number.isInteger(stack) ? stack : stack && stack.id;
      const item = id ? Items.get(id) : null;
      if (!item || !item.armor || item.armor.slot !== slot) continue;
      const material = item.armor.material;
      if (!['leather', 'gold', 'iron', 'diamond'].includes(material)) continue;
      for (const part of remoteArmorParts(slot, material, e.model.modelType, !!(stack && stack.enchanted))) {
        pushBox(part.glint ? glintOut : out, e, part, world, 0, light);
      }
    }
  }

  // ---------------- base ----------------
  let nextId = 1;
  function baseEntity(type, x, y, z, w, h) {
    return {
      id: nextId++, type, x, y, z, vx: 0, vy: 0, vz: 0, w, h,
      yaw: 0, onGround: false, dead: false, age: 0, hp: 1, maxHp: 1,
      flash: 0, hurtAnim: 0, headYaw: 0, headPitch: 0, attackAnim: 0,
      grazeAnim: 0, fuseProgress: 0, hurtCooldown: 0,
      playerDamageTime: 0, embeddedArrows: 0,
    };
  }

  function physicsTick(world, e, dt, buoyant) {
    const inWater = Physics.isInLiquid(world, e, 'water');
    const inLava = Physics.isInLiquid(world, e, 'lava');
    if (inWater || inLava) {
      e.vy -= GRAV * 0.25 * dt;
      e.vy *= (1 - 2.2 * dt);
      e.vx *= (1 - 2.5 * dt);
      e.vz *= (1 - 2.5 * dt);
      if (buoyant && e.vy < 1.2) e.vy += 6 * dt;
    } else {
      e.vy -= GRAV * dt;
      if (e.vy < -55) e.vy = -55;
    }
    Physics.move(world, e, dt);
    return { inWater, inLava };
  }

  // ---------------- items ----------------
  function spawnItem(x, y, z, itemId, count, vx, vy, vz, meta) {
    if (typeof Network !== 'undefined' && Network.isConnected && Network.isConnected()) {
      return { id: -1, type: 'item', itemId, count, x, y, z, dead: true, pickupDelay: 0 };
    }
    const e = baseEntity('item', x, y, z, 0.25, 0.25);
    e.itemId = itemId;
    e.count = count;
    e.vx = vx !== undefined ? vx : (R() - 0.5) * 3;
    e.vy = vy !== undefined ? vy : 4 + R() * 2;
    e.vz = vz !== undefined ? vz : (R() - 0.5) * 3;
    e.pickupDelay = 0.5;
    if (meta) {
      if (meta.dur !== undefined) e.dur = meta.dur;
      if (meta.ench) e.ench = Object.assign({}, meta.ench);
      if (meta.name) e.customName = String(meta.name).slice(0, 32);
    }
    list.push(e);
    spatialAdd(e);
    geometryVersion++;
    return e;
  }

  function spawnXP(x, y, z, value) {
    const e = baseEntity('xp', x, y, z, 0.2, 0.2);
    e.value = Math.max(1, value | 0);
    e.vx = (R() - 0.5) * 2.2; e.vy = 2.5 + R() * 1.5; e.vz = (R() - 0.5) * 2.2;
    list.push(e); spatialAdd(e); geometryVersion++;
    return e;
  }

  function spawnArrow(x, y, z, vx, vy, vz, damage) {
    const e = baseEntity('arrow', x, y, z, 0.12, 0.12);
    e.itemId = Items.IT.ARROW;
    e.count = 1;
    e.vx = vx; e.vy = vy; e.vz = vz;
    e.damage = Math.max(1, Number(damage) || 2);
    list.push(e);
    spatialAdd(e);
    geometryVersion++;
    return e;
  }

  function spawnEgg(x, y, z, vx, vy, vz) {
    const e = baseEntity('egg', x, y, z, 0.18, 0.18);
    e.itemId = Items.IT.EGG;
    e.count = 1;
    e.vx = Number(vx) || 0;
    e.vy = Number(vy) || 0;
    e.vz = Number(vz) || 0;
    list.push(e);
    spatialAdd(e);
    geometryVersion++;
    return e;
  }

  function spawnEnderPearl(x, y, z, vx, vy, vz) {
    const e = baseEntity('ender_pearl', x, y, z, 0.18, 0.18);
    e.itemId = Items.IT.ENDER_PEARL;
    e.count = 1;
    e.vx = Number(vx) || 0;
    e.vy = Number(vy) || 0;
    e.vz = Number(vz) || 0;
    list.push(e);
    spatialAdd(e);
    geometryVersion++;
    return e;
  }

  function breakEgg(e) {
    if (!e || e.dead) return;
    const hatch = R() < 0.125;
    const chicks = hatch ? (R() < 0.03125 ? 4 : 1) : 0;
    const speed = Math.hypot(e.vx, e.vy, e.vz) || 1;
    const spawnX = e.x - e.vx / speed * 0.3;
    const spawnY = e.y - e.vy / speed * 0.15;
    const spawnZ = e.z - e.vz / speed * 0.3;
    e.dead = true;
    for (let index = 0; index < particleCount(8); index++) {
      particles.push({
        x: e.x, y: e.y, z: e.z,
        vx: (R() - 0.5) * 2.4, vy: 0.8 + R() * 2.2, vz: (R() - 0.5) * 2.4,
        life: 0.28 + R() * 0.24, tile: 'egg', size: 0.07 + R() * 0.04, gravity: 0.7,
      });
    }
    for (let index = 0; index < chicks; index++) {
      const chick = spawnMob('chicken', spawnX + (R() - 0.5) * 0.35, spawnY, spawnZ + (R() - 0.5) * 0.35);
      if (!chick) continue;
      chick.babyTime = 300;
      chick.w = chick.model.w * 0.55;
      chick.h = chick.model.h * 0.55;
    }
    Sound.emit('egg.break', { x: e.x, y: e.y, z: e.z, volume: 0.55, pitch: 1.08 });
    particleVersion++;
    geometryVersion++;
  }

  function landEnderPearl(e, world, player) {
    if (!e || e.dead) return;
    e.dead = true;
    const speed = Math.hypot(e.vx, e.vy, e.vz) || 1;
    const old = { x: player.x, y: player.y, z: player.z };
    player.x = e.x - e.vx / speed * 0.3;
    player.y = e.y - e.vy / speed * 0.1;
    player.z = e.z - e.vz / speed * 0.3;
    if (!Physics.canOccupy(world, player, player.x, player.y, player.z) &&
        (!Physics.resolvePenetration || !Physics.resolvePenetration(world, player, 3))) {
      player.x = old.x; player.y = old.y; player.z = old.z;
    }
    player.prevX = player.x; player.prevY = player.y; player.prevZ = player.z;
    player.vx = player.vy = player.vz = 0;
    player.fallStart = null;
    player.damage(5, 'ender_pearl');
    for (let index = 0; index < particleCount(18); index++) {
      particles.push({
        x: player.x, y: player.y + 0.8, z: player.z,
        vx: (R() - 0.5) * 3.2, vy: (R() - 0.25) * 2.8, vz: (R() - 0.5) * 3.2,
        life: 0.35 + R() * 0.35, tile: 'ender_pearl', size: 0.06 + R() * 0.05, gravity: 0.15,
      });
    }
    Sound.emit('ender_pearl.land', { x: player.x, y: player.y + 0.8, z: player.z, volume: 0.72 });
    particleVersion++;
    geometryVersion++;
  }

  // ---------------- TNT ----------------
  function spawnTNT(world, x, y, z, fuse) {
    const e = baseEntity('tnt', x + 0.5, y, z + 0.5, 0.98, 0.98);
    e.fuse = fuse !== undefined ? fuse : 4;
    e.vy = 3;
    list.push(e);
    spatialAdd(e);
    geometryVersion++;
    Sound.emit('tnt.fuse', { x: e.x, y: e.y, z: e.z, volume: 0.8 });
    return e;
  }

  function explode(world, x, y, z, power) {
    const ID = Blocks.ID;
    const r = Math.ceil(power);
    Sound.emit('explosion', { x, y, z, volume: 1 });
    // blocks
    world.beginBatch();
    for (let dx = -r; dx <= r; dx++)
      for (let dy = -r; dy <= r; dy++)
        for (let dz = -r; dz <= r; dz++) {
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (d > power) continue;
          const bx = Math.floor(x) + dx, by = Math.floor(y) + dy, bz = Math.floor(z) + dz;
          const id = world.getBlock(bx, by, bz);
          const state = world.getState(bx, by, bz);
          if (id === 0 || id === ID.BEDROCK || id === ID.WATER) continue;
          const resist = id === ID.LAVA ? 1 : (Blocks.get(id).hardness < 0 ? Infinity : 0);
          if (resist === Infinity) continue;
          const p = 1 - d / power;
          if (R() < p * 1.4) {
            if (id === ID.TNT) {
              world.setBlock(bx, by, bz, 0);
              spawnTNT(world, bx, by, bz, 0.3 + R() * 0.7);
              continue;
            }
            world.setBlock(bx, by, bz, 0);
            if (world.getBE(bx, by, bz)) dropBE(world, bx, by, bz);
            if (R() < 0.3) {
              const drops = Blocks.dropsFor(id, state, R);
              for (const dr of drops) spawnItem(bx + 0.5, by + 0.3, bz + 0.5, dr.id, dr.n);
            }
          }
        }
    world.endBatch();
    // entity damage + knockback (player handled by caller via Entities.onExplosion)
    const entityRadius = power * 2;
    for (const e of queryBox(x - entityRadius, z - entityRadius, x + entityRadius, z + entityRadius)) {
      if (e.dead || e.type === 'item' || e.type === 'xp') continue;
      const d = Math.sqrt(U.dist2(e.x, e.y + e.h / 2, e.z, x, y, z));
      if (d < power * 2) {
        const dmg = Math.round(14 * power / 3 * (1 - d / (power * 2)));
        hurtMob(null, e, dmg, x, z, 1.6);
      }
    }
    if (Entities.onExplosion) Entities.onExplosion(x, y, z, power);
    // smoke
    for (let i = 0; i < particleCount(40); i++) {
      const a = R() * Math.PI * 2, b = R() * Math.PI - Math.PI / 2;
      const sp = R() * power * 2;
      particles.push({
        x, y: y + 0.5, z,
        vx: Math.cos(a) * Math.cos(b) * sp, vy: Math.sin(b) * sp + 2, vz: Math.sin(a) * Math.cos(b) * sp,
        life: 0.6 + R() * 0.8, tile: null, col: [0.35, 0.35, 0.35], size: 0.25 + R() * 0.2,
        gravity: 2,
      });
    }
    particleVersion++;
  }

  function dropBE(world, x, y, z) {
    const be = world.removeBE(x, y, z);
    if (!be) return;
    if (typeof Network !== 'undefined' && Network.isConnected && Network.isConnected()) return;
    const slots = be.slots || [];
    for (const s of slots) {
      if (s) {
        spawnItem(x + 0.5, y + 0.5, z + 0.5, s.id, s.n, undefined, undefined, undefined, s);
      }
    }
  }

  // ---------------- mobs ----------------
  function spawnMob(kind, x, y, z) {
    const M = modelForKind(kind);
    if (!M) return null;
    const e = baseEntity('mob', x, y, z, M.w, M.h);
    e.kind = kind;
    e.hp = e.maxHp = M.hp;
    e.model = M;
    e.ai = {
      mode: 'idle', timer: 1 + R() * 3, dirX: 0, dirZ: 0,
      pathTimer: R() * 0.5, senseTimer: R() * 0.2, pathX: null, pathZ: null,
      memory: 0, lastSeenX: x, lastSeenZ: z,
    };
    e.animPhase = R() * 6;
    e.animSpeed = 0;
    e.attackCd = 0;
    if (kind === 'skeleton') { e.held = Items.IT.BOW; e.action = 'bow'; e.actionPhase = 1; }
    e.soundCd = 5 + R() * 10;
    e.audioStepDist = 0;
    e.fuse = -1; // creeper
    e.burnTime = 0;
    e.provoked = 0;
    e.tamed = false;
    e.sheared = false;
    e.woolRegrow = 0;
    e.eggTimer = kind === 'chicken' ? 180 + R() * 300 : 0;
    list.push(e);
    spatialAdd(e);
    geometryVersion++;
    return e;
  }

  function configureVillageMob(entity, plan, resident) {
    if (!entity || !plan) return entity;
    entity.villageId = plan.id;
    entity.meeting = { x: plan.meeting.x, y: plan.meeting.y, z: plan.meeting.z };
    if (resident) {
      entity.home = resident.home ? { x: resident.home.x, y: resident.home.y, z: resident.home.z } : null;
      entity.jobSite = resident.job ? { x: resident.job.x, y: resident.job.y, z: resident.job.z } : null;
      entity.profession = resident.profession || 'unemployed';
      entity.model = entityModel(entity);
      entity.tradeLevel = 1;
      entity.tradeUses = 0;
      entity.restockAt = 0;
    }
    return entity;
  }

  function tradeOffer(entity) {
    if (!entity || entity.kind !== 'villager') return null;
    const offer = VILLAGER_TRADES[entity.profession] || VILLAGER_TRADES.unemployed;
    if ((entity.tradeUses || 0) >= offer.uses) return null;
    return Object.assign({ profession: entity.profession || 'unemployed' }, offer);
  }

  function recordVillagerTrade(entity, world) {
    if (!entity || entity.kind !== 'villager') return;
    entity.tradeUses = (entity.tradeUses || 0) + 1;
    entity.tradeLevel = Math.min(5, (entity.tradeLevel || 1) + ((entity.tradeUses % 3) === 0 ? 1 : 0));
    entity.restockAt = Math.max(entity.restockAt || 0, (world ? world.time : 0) + 120);
  }

  function hurtMob(world, e, dmg, fromX, fromZ, kb) {
    if (e.dead || dmg <= 0 || e.hurtCooldown > 0) return false;
    if (e.type === 'mob') {
      e.hp -= dmg;
      if (e.model.neutral) e.provoked = 20;
      e.hurtCooldown = 0.5;
      if (world && fromX !== undefined) e.playerDamageTime = 5;
      e.flash = 0.35;
      e.hurtAnim = 0.35;
      Sound.emit('entity.' + (e.kind || 'generic') + '.hurt', { x: e.x, y: e.y + e.h * 0.55, z: e.z, volume: 0.9 });
      if (fromX !== undefined) {
        const dx = e.x - fromX, dz = e.z - fromZ;
        const d = Math.hypot(dx, dz) || 1;
        e.vx += dx / d * 6 * (kb || 1);
        e.vz += dz / d * 6 * (kb || 1);
        e.vy += 4.5 * (kb || 1) * 0.6;
      }
      if (e.kind === 'enderman' && world && R() < 0.45) {
        const oldX = e.x, oldY = e.y, oldZ = e.z;
        for (let attempt = 0; attempt < 10; attempt++) {
          const tx = e.x + (R() - 0.5) * 24, tz = e.z + (R() - 0.5) * 24;
          const ty = walkY(world, Math.floor(tx), Math.floor(tz), e.y);
          if (ty === null) continue;
          e.x = tx; e.y = ty; e.z = tz; e.vx = e.vy = e.vz = 0;
          Sound.emit('entity.enderman.special', { x: oldX, y: oldY + 1.4, z: oldZ, volume: 0.82 });
          Sound.emit('entity.enderman.special', { x: e.x, y: e.y + 1.4, z: e.z, volume: 0.82, pitch: 1.08 });
          break;
        }
      }
      if (e.ai && !e.model.hostile) {
        e.ai.mode = 'flee';
        e.ai.timer = 3;
        e.ai.fleeX = fromX; e.ai.fleeZ = fromZ;
      }
      if (e.hp <= 0) killMob(world, e);
      return true;
    } else if (e.type === 'tnt') {
      // nothing
    }
    return false;
  }

  function killMob(world, e) {
    e.dead = true;
    if (e.playerDamageTime > 0 && Entities.onMobKilled) Entities.onMobKilled(e);
    Sound.emit('entity.' + (e.kind || 'generic') + '.death', { x: e.x, y: e.y + e.h * 0.55, z: e.z, volume: 0.86 });
    for (let i = 0; i < particleCount(10); i++) {
      particles.push({
        x: e.x, y: e.y + e.h / 2, z: e.z,
        vx: (R() - 0.5) * 2, vy: R() * 2.5, vz: (R() - 0.5) * 2,
        life: 0.5 + R() * 0.4, tile: null, col: [0.9, 0.9, 0.9], size: 0.18, gravity: -0.5,
      });
    }
    particleVersion++;
    if (e.model && e.model.drops) {
      for (const d of e.model.drops) {
        if (d.unlessSheared && e.sheared) continue;
        if (d.chance !== undefined && R() >= d.chance) continue;
        const n = d.n[0] + Math.floor(R() * (d.n[1] - d.n[0] + 1));
        if (n > 0) spawnItem(e.x, e.y + 0.3, e.z, d.id(), n);
      }
    }
    if (e.kind === 'slime' && !e.small) {
      for (let i = 0; i < 2; i++) {
        const child = spawnMob('slime', e.x + (i ? 0.35 : -0.35), e.y, e.z);
        if (!child) continue;
        child.small = true; child.babyTime = 9999; child.w *= 0.55; child.h *= 0.55;
        child.hp = child.maxHp = 4;
      }
    }
    if (e.kind === 'ender_dragon' && world) {
      world.dragonDefeated = true;
      const cx = World.END_OFFSET + 8, cy = 63, cz = 8;
      world.ensureChunk(cx >> 4, cz >> 4);
      world.beginBatch();
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) world.setBlock(cx + dx, cy, cz + dz, Blocks.ID.END_PORTAL);
      world.setBlock(cx, cy + 1, cz, Blocks.ID.DRAGON_EGG);
      world.endBatch();
      for (let i = 0; i < 20; i++) spawnXP(e.x, e.y + 1, e.z, 25);
    }
  }

  function shearSheep(e) {
    if (!e || e.dead || e.type !== 'mob' || e.kind !== 'sheep' || e.sheared) return false;
    e.sheared = true;
    e.woolRegrow = 25 + R() * 25;
    const count = 1 + Math.floor(R() * 3);
    spawnItem(e.x, e.y + 0.65, e.z, Blocks.ID.WOOL, count, 0, 2.8, 0);
    Sound.emit('entity.sheep.special', { x: e.x, y: e.y + 0.7, z: e.z, volume: 0.8, pitch: 1.15 });
    return true;
  }

  function loveParticles(e) {
    for (let i = 0; i < particleCount(7); i++) particles.push({
      x: e.x + (R() - 0.5) * e.w, y: e.y + e.h * (0.65 + R() * 0.35), z: e.z + (R() - 0.5) * e.w,
      vx: (R() - 0.5) * 0.35, vy: 0.55 + R() * 0.45, vz: (R() - 0.5) * 0.35,
      life: 0.65 + R() * 0.35, tile: '__white', col: [1, 0.18, 0.28], size: 0.07, gravity: -0.12,
    });
    particleVersion++;
  }

  function feedAnimal(e, itemId) {
    if (!e || e.dead || e.type !== 'mob' || BREED_FOOD[e.kind] !== itemId) return false;
    loveParticles(e);
    if (e.babyTime > 0) {
      e.babyTime = Math.max(0, e.babyTime - 30);
      if (e.babyTime === 0 && e.model) { e.w = e.model.w; e.h = e.model.h; }
      return true;
    }
    if (e.breedCooldown > 0) return true;
    e.loveTime = 30;
    const mate = list.find(other => other !== e && !other.dead && other.type === 'mob' && other.kind === e.kind &&
      other.loveTime > 0 && !(other.babyTime > 0) && !(other.breedCooldown > 0) &&
      U.dist2(e.x, e.y, e.z, other.x, other.y, other.z) <= 8 * 8);
    if (!mate) return true;
    const child = spawnMob(e.kind, (e.x + mate.x) / 2, Math.max(e.y, mate.y), (e.z + mate.z) / 2);
    if (child) {
      child.babyTime = 300;
      child.w = child.model.w * 0.55;
      child.h = child.model.h * 0.55;
      loveParticles(mate);
    }
    e.loveTime = 0; mate.loveTime = 0;
    e.breedCooldown = 300; mate.breedCooldown = 300;
    return true;
  }

  function angleDelta(target, current) {
    return Math.atan2(Math.sin(target - current), Math.cos(target - current));
  }

  function hasLineOfSight(world, e, player, maxDist) {
    const ox = e.x, oy = e.y + e.h * 0.82, oz = e.z;
    const tx = player.x, ty = player.y + (player.eye || 1.35), tz = player.z;
    const dx = tx - ox, dy = ty - oy, dz = tz - oz;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > maxDist) return false;
    const hit = world.raycast(ox, oy, oz, dx / dist, dy / dist, dz / dist, dist);
    return !hit || hit.dist >= dist - 0.45;
  }

  function walkY(world, x, z, nearY) {
    const base = Math.floor(nearY);
    for (let off = 2; off >= -3; off--) {
      const y = base + off;
      const ground = world.getBlock(x, y - 1, z);
      const feet = world.getBlock(x, y, z);
      const head = world.getBlock(x, y + 1, z);
      if (!Blocks.isSolid(ground) || Blocks.get(ground).liquid) continue;
      if (Blocks.isSolid(feet) || Blocks.isSolid(head) || Blocks.get(feet).liquid || Blocks.get(head).liquid) continue;
      return y;
    }
    return null;
  }

  const PATH_RADIUS = 10;
  const PATH_SIZE = PATH_RADIUS * 2 + 1;
  const PATH_CENTER = PATH_RADIUS * PATH_SIZE + PATH_RADIUS;
  const PATH_COST = new Float32Array(PATH_SIZE * PATH_SIZE);
  const PATH_CLOSED = new Uint8Array(PATH_SIZE * PATH_SIZE);
  const PATH_DX = new Int8Array([1, -1, 0, 0]);
  const PATH_DZ = new Int8Array([0, 0, 1, -1]);

  function pathHeapPush(heap, node) {
    let i = heap.length;
    heap.push(node);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heap[parent].f <= node.f) break;
      heap[i] = heap[parent];
      i = parent;
    }
    heap[i] = node;
  }

  function pathHeapPop(heap) {
    const root = heap[0];
    const last = heap.pop();
    if (!heap.length) return root;
    let i = 0;
    while (true) {
      let child = i * 2 + 1;
      if (child >= heap.length) break;
      if (child + 1 < heap.length && heap[child + 1].f < heap[child].f) child++;
      if (heap[child].f >= last.f) break;
      heap[i] = heap[child];
      i = child;
    }
    heap[i] = last;
    return root;
  }

  function findPathStep(world, e, targetX, targetZ) {
    const sx = Math.floor(e.x), sz = Math.floor(e.z), sy = walkY(world, sx, sz, e.y);
    if (sy === null) return null;
    let gx = Math.floor(targetX), gz = Math.floor(targetZ);
    const gdx = gx - sx, gdz = gz - sz;
    const gd = Math.hypot(gdx, gdz);
    if (gd > 10) {
      gx = Math.round(sx + gdx / gd * 10);
      gz = Math.round(sz + gdz / gd * 10);
    }
    const start = { x: sx, y: sy, z: sz, g: 0, f: Math.abs(gx - sx) + Math.abs(gz - sz), parent: null };
    const open = [start];
    const cost = PATH_COST, closed = PATH_CLOSED;
    cost.fill(Infinity); closed.fill(0);
    cost[PATH_CENTER] = 0;
    let nearest = start;
    for (let visited = 0; open.length && visited < 128; visited++) {
      const cur = pathHeapPop(open);
      const ci = (cur.x - sx + PATH_RADIUS) * PATH_SIZE + (cur.z - sz + PATH_RADIUS);
      if (closed[ci]) continue;
      closed[ci] = 1;
      if (Math.abs(gx - cur.x) + Math.abs(gz - cur.z) < Math.abs(gx - nearest.x) + Math.abs(gz - nearest.z)) nearest = cur;
      if (cur.x === gx && cur.z === gz) { nearest = cur; break; }
      for (let d = 0; d < 4; d++) {
        const nx = cur.x + PATH_DX[d], nz = cur.z + PATH_DZ[d];
        if (Math.abs(nx - sx) > 10 || Math.abs(nz - sz) > 10) continue;
        const ny = walkY(world, nx, nz, cur.y);
        if (ny === null || ny - cur.y > 1 || cur.y - ny > 2) continue;
        const ni = (nx - sx + PATH_RADIUS) * PATH_SIZE + (nz - sz + PATH_RADIUS);
        const ng = cur.g + 1 + Math.abs(ny - cur.y) * 0.35;
        if (cost[ni] <= ng) continue;
        cost[ni] = ng;
        pathHeapPush(open, { x: nx, y: ny, z: nz, g: ng, f: ng + Math.abs(gx - nx) + Math.abs(gz - nz), parent: cur });
      }
    }
    if (nearest === start) return null;
    while (nearest.parent && nearest.parent !== start) nearest = nearest.parent;
    return { x: nearest.x + 0.5, y: nearest.y, z: nearest.z + 0.5 };
  }

  function updateMobPose(e, player, dt, distP) {
    let targetYaw = 0;
    let targetPitch = 0;
    const grazing = e.ai.mode === 'graze';
    const watching = !player.dead && ((e.model.hostile && e.ai.mode === 'chase' && player.mode !== 'creative') ||
      (!e.model.hostile && e.ai.mode !== 'flee' && distP < 6));
    if (grazing) {
      targetPitch = -0.92;
    } else if (watching) {
      const dx = player.x - e.x;
      const dz = player.z - e.z;
      const horizontal = Math.hypot(dx, dz) || 1;
      const worldYaw = Math.atan2(dx, -dz);
      targetYaw = U.clamp(angleDelta(worldYaw, e.yaw), -0.78, 0.78);
      const playerEye = player.y + (player.eye || 1.35);
      const headY = e.y + ((e.model.headPivot && e.model.headPivot[1] / 16) || e.h * 0.82);
      targetPitch = U.clamp(Math.atan2(playerEye - headY, horizontal), -0.55, 0.45);
    }
    const turn = Math.min(1, dt * 8);
    e.headYaw = U.lerp(e.headYaw || 0, targetYaw, turn);
    e.headPitch = U.lerp(e.headPitch || 0, targetPitch, turn);
  }

  function updateAnimationSpeed(e, target, dt) {
    const blend = 1 - Math.exp(-Math.max(0, dt) * 10);
    e.animSpeed = U.lerp(e.animSpeed || 0, target, blend);
    if (target < 0.02 && e.animSpeed < 0.02) e.animSpeed = 0;
    return e.animSpeed;
  }

  function mobStepHeight(world, e, moveX, moveZ) {
    const length = Math.hypot(moveX, moveZ);
    if (!e.onGround || length < 1e-6) return 0;
    const nx = moveX / length, nz = moveZ / length;
    const speed = Math.hypot(e.vx || 0, e.vz || 0);
    const lookAhead = e.w * 0.5 + U.clamp(0.16 + speed * 0.04, 0.16, 0.32);
    const aheadX = e.x + nx * lookAhead;
    const aheadZ = e.z + nz * lookAhead;
    if (Physics.canOccupy(world, e, aheadX, e.y, aheadZ)) return 0;
    return Physics.findStepHeight(world, e, aheadX, aheadZ, 1.05);
  }

  function updateUndeadDaylight(world, e, dt, dayFactor) {
    if (e.kind !== 'zombie' && e.kind !== 'skeleton') return;
    const bx = Math.floor(e.x), by = Math.floor(e.y + e.h + 0.05), bz = Math.floor(e.z);
    const exposed = world.getSky(bx, by, bz) >= 14;
    const dimension = world.dimensionAt ? world.dimensionAt(bx, bz) : 'overworld';
    const inWater = Physics.isInLiquid(world, e, 'water');
    const rainWet = world.weather === 'rain' && exposed;
    const ignitedBySun = dimension === 'overworld' && exposed && dayFactor > 0.55;
    if (inWater || rainWet) e.fireTime = 0;
    else if (ignitedBySun) e.fireTime = Math.max(e.fireTime || 0, 8);
    else e.fireTime = Math.max(0, (e.fireTime || 0) - dt);
    e.burning = e.fireTime > 0;
    if (!e.burning) {
      e.burnTime = 0;
      return;
    }
    e.burnTime = (e.burnTime || 0) + dt;
    if (e.burnTime >= 1) {
      e.burnTime %= 1;
      hurtMob(world, e, 2);
    }
  }

  function emitBurningParticle(e, dt) {
    if (!e || e.dead || !e.burning) {
      if (e) e.fireParticleClock = 0;
      return;
    }
    e.fireParticleClock = (e.fireParticleClock || 0) - dt;
    if (e.fireParticleClock > 0) return;
    e.fireParticleClock = [0.12, 0.20, 0.32][particleLevel] * (0.8 + R() * 0.4);
    particles.push({
      x: e.x + (R() - 0.5) * e.w * 0.8,
      y: e.y + e.h * (0.18 + R() * 0.72),
      z: e.z + (R() - 0.5) * e.w * 0.8,
      vx: (R() - 0.5) * 0.12, vy: 0.55 + R() * 0.35, vz: (R() - 0.5) * 0.12,
      life: 0.32 + R() * 0.24, tile: 'fire', u0: R() * 0.75, v0: R() * 0.75,
      size: 0.10 + R() * 0.06, gravity: -0.12,
    });
  }

  function villageScheduleTarget(entity, world) {
    const time = ((world.timeOfDay % 1) + 1) % 1;
    if (time < 0.20 || time > 0.78) return entity.home ? { point: entity.home, role: 'home' } : null;
    if (time >= 0.25 && time < 0.56 && entity.jobSite) return { point: entity.jobSite, role: 'job' };
    if (time >= 0.56 && time < 0.72 && entity.meeting) return { point: entity.meeting, role: 'meeting' };
    return entity.home ? { point: entity.home, role: 'home' } : (entity.meeting ? { point: entity.meeting, role: 'meeting' } : null);
  }

  function nearestVillageThreat(entity, range) {
    let target = null, best = range * range;
    for (const candidate of list) {
      if (candidate.dead || candidate.type !== 'mob' || !candidate.model || !candidate.model.hostile || candidate.kind === 'ender_dragon') continue;
      const distance = U.dist2(entity.x, entity.y, entity.z, candidate.x, candidate.y, candidate.z);
      if (distance < best) { best = distance; target = candidate; }
    }
    return target;
  }

  function mobAI(world, e, player, dt, dayFactor) {
    e.model = entityModel(e) || e.model;
    const M = e.model;
    const ai = e.ai;
    const distP = Math.sqrt(U.dist2(e.x, e.y, e.z, player.x, player.y, player.z));
    e.attackCd = Math.max(0, e.attackCd - dt);
    e.provoked = Math.max(0, (e.provoked || 0) - dt);
    e.attackAnim = Math.max(0, e.attackAnim - dt);
    e.jumpCooldown = Math.max(0, (e.jumpCooldown || 0) - dt);
    e.woolRegrow = Math.max(0, (e.woolRegrow || 0) - dt);
    e.loveTime = Math.max(0, (e.loveTime || 0) - dt);
    e.breedCooldown = Math.max(0, (e.breedCooldown || 0) - dt);
    if (e.babyTime > 0) {
      e.babyTime = Math.max(0, e.babyTime - dt);
      if (e.babyTime === 0) { e.w = M.w; e.h = M.h; }
    }
    if (e.kind === 'chicken') {
      e.eggTimer -= dt;
      if (e.eggTimer <= 0) {
        spawnItem(e.x, e.y + 0.2, e.z, Items.IT.EGG, 1, 0, 0.8, 0);
        e.eggTimer = 180 + R() * 300;
        Sound.emit('entity.chicken.special', { x: e.x, y: e.y + 0.35, z: e.z, volume: 0.42, pitch: 1.1 });
      }
    }
    e.soundCd -= dt;
    if (e.soundCd <= 0 && distP < 28) {
      Sound.emit('entity.' + e.kind + '.ambient', { x: e.x, y: e.y + e.h * 0.55, z: e.z, volume: M.boss ? 0.95 : 0.68 });
      e.soundCd = (M.hostile ? 5 : 7) + R() * (M.hostile ? 10 : 15);
    }

    const activeHostile = !!(M.hostile && (!M.neutral || e.provoked > 0));
    if (M.aquatic) {
      ai.timer -= dt;
      if (ai.timer <= 0) {
        const a = R() * Math.PI * 2;
        ai.dirX = Math.cos(a); ai.dirZ = Math.sin(a); ai.dirY = (R() - 0.5) * 0.8;
        ai.timer = 1.5 + R() * 3;
      }
      const inWater = Physics.isInLiquid(world, e, 'water');
      e.vx += (ai.dirX * M.speed - e.vx) * Math.min(1, dt * 3);
      e.vz += (ai.dirZ * M.speed - e.vz) * Math.min(1, dt * 3);
      e.vy += ((inWater ? ai.dirY : -1.5) - e.vy) * Math.min(1, dt * 3);
      e.yaw = Math.atan2(e.vx, -e.vz);
      updateAnimationSpeed(e, Math.hypot(e.vx, e.vy, e.vz), dt);
      e.animPhase += e.animSpeed * dt * 3.4;
      return;
    }
    if (M.flying) {
      ai.timer -= dt;
      let dx = ai.dirX || 0, dz = ai.dirZ || 0, dy = ai.dirY || 0;
      if (activeHostile && !player.dead && player.mode !== 'creative' && distP < 24) {
        const distance = Math.max(0.1, Math.hypot(player.x - e.x, player.y + 1 - e.y, player.z - e.z));
        dx = (player.x - e.x) / distance; dy = (player.y + 1 - e.y) / distance; dz = (player.z - e.z) / distance;
        if (distP < 1.7 && e.attackCd <= 0) {
          e.attackCd = 1.1; e.attackAnim = 0.42;
          if (Entities.onMobAttack) Entities.onMobAttack(e, M.dmg || 2);
        }
      } else if (ai.timer <= 0) {
        const a = R() * Math.PI * 2;
        ai.dirX = dx = Math.cos(a); ai.dirZ = dz = Math.sin(a); ai.dirY = dy = (R() - 0.5) * 0.7;
        ai.timer = 1 + R() * 3;
      }
      e.vx += (dx * M.speed - e.vx) * Math.min(1, dt * 4);
      e.vz += (dz * M.speed - e.vz) * Math.min(1, dt * 4);
      e.vy += (dy * M.speed - e.vy) * Math.min(1, dt * 4);
      e.yaw = Math.atan2(e.vx, -e.vz);
      updateAnimationSpeed(e, Math.hypot(e.vx, e.vy, e.vz), dt);
      e.animPhase += e.animSpeed * dt * 3.2;
      return;
    }

    updateUndeadDaylight(world, e, dt, dayFactor);
    if (e.dead) return;

    let wantJump = false;
    let moveX = 0, moveZ = 0, speed = M.speed;

    const held = !player.dead && player.held ? player.held() : null;
    const tempted = !M.hostile && held && held.id === BREED_FOOD[e.kind] && distP < 10 && ai.mode !== 'flee';
    if (tempted) ai.mode = 'tempt';
    else if (e.kind === 'wolf' && e.tamed && distP > 3 && ai.mode !== 'flee') ai.mode = 'follow';
    else if (ai.mode === 'tempt') { ai.mode = 'idle'; ai.timer = 0.5 + R(); }

    if (e.kind === 'villager' && e.villageId && ai.mode !== 'flee' && !tempted) {
      const threat = nearestVillageThreat(e, 10);
      if (threat) {
        ai.mode = 'flee'; ai.timer = 2.5; ai.fleeX = threat.x; ai.fleeZ = threat.z;
        e.sleeping = false;
      } else {
        const schedule = villageScheduleTarget(e, world);
        if (schedule && schedule.point) {
          ai.mode = 'village'; ai.targetX = schedule.point.x + 0.5; ai.targetZ = schedule.point.z + 0.5;
          ai.villageRole = schedule.role;
          const distance = Math.hypot(ai.targetX - e.x, ai.targetZ - e.z);
          const time = ((world.timeOfDay % 1) + 1) % 1;
          e.sleeping = schedule.role === 'home' && (time < 0.20 || time > 0.78) && distance < 1.25;
          if (schedule.role === 'job' && distance < 1.5 && (e.restockAt || 0) <= world.time) {
            e.tradeUses = 0; e.restockAt = world.time + 120;
          }
        }
      }
    } else if (e.kind === 'cat' && e.meeting && ai.mode !== 'flee') {
      const distance = Math.hypot(e.meeting.x + 0.5 - e.x, e.meeting.z + 0.5 - e.z);
      if (distance > 12) {
        ai.mode = 'village'; ai.targetX = e.meeting.x + 0.5; ai.targetZ = e.meeting.z + 0.5; ai.villageRole = 'meeting';
      }
    } else if (e.kind === 'iron_golem') {
      const threat = nearestVillageThreat(e, 18);
      if (threat) { ai.mode = 'defend'; ai.targetEntity = threat; }
      else if (ai.mode === 'defend') { ai.mode = 'idle'; ai.timer = 1; ai.targetEntity = null; }
    }

    if (activeHostile && !player.dead && player.mode !== 'creative') {
      ai.senseTimer = (ai.senseTimer || 0) - dt;
      if (ai.senseTimer <= 0) {
        ai.canSee = hasLineOfSight(world, e, player, 20);
        ai.senseTimer = 0.18 + R() * 0.08;
      }
      if (ai.canSee) {
        ai.mode = 'chase';
        ai.memory = 4.5;
        ai.lastSeenX = player.x;
        ai.lastSeenZ = player.z;
      } else {
        ai.memory = Math.max(0, (ai.memory || 0) - dt);
      }
      if (ai.mode === 'chase' && (!ai.memory || distP > 28)) {
        ai.mode = 'idle'; ai.timer = 1;
      }
    } else if (M.hostile) {
      ai.canSee = false;
      if (ai.mode === 'chase') { ai.mode = 'idle'; ai.timer = 1; }
      if (e.kind === 'creeper' && e.fuse >= 0) { e.fuse = -1; e.fuseProgress = 0; }
    }

    if (e.kind === 'creeper') {
      if (ai.mode === 'chase' && ai.canSee && distP < 2.6 && e.fuse < 0) {
        e.fuse = 1.5;
        Sound.emit('tnt.fuse', { x: e.x, y: e.y + 0.8, z: e.z, volume: 1, pitch: 1.12 });
      }
      if (e.fuse >= 0) {
        if (distP > 6) { e.fuse = -1; } // defused
        else {
          e.fuse -= dt;
          e.fuseProgress = U.clamp(1 - e.fuse / 1.5, 0, 1);
          if (e.fuse <= 0) {
            e.dead = true;
            explode(world, e.x, e.y + 0.6, e.z, 3);
            return;
          }
        }
        speed = 0; // stand still while primed
      } else {
        e.fuseProgress = Math.max(0, (e.fuseProgress || 0) - dt * 3);
      }
    }

    switch (ai.mode) {
      case 'idle':
        ai.timer -= dt;
        if (ai.timer <= 0) {
          const under = world.getBlock(Math.floor(e.x), Math.floor(e.y - 0.1), Math.floor(e.z));
          if (!M.hostile && (under === Blocks.ID.GRASS || under === Blocks.ID.GRASS_SNOW) && R() < 0.36) {
            ai.mode = 'graze';
            ai.timer = 1.8;
          } else {
            ai.mode = 'wander';
            ai.timer = 2 + R() * 4;
            const a = R() * Math.PI * 2;
            ai.dirX = Math.cos(a); ai.dirZ = Math.sin(a);
          }
        }
        break;
      case 'wander':
        ai.timer -= dt;
        moveX = ai.dirX; moveZ = ai.dirZ;
        speed *= 0.7;
        if (ai.timer <= 0) { ai.mode = 'idle'; ai.timer = 1 + R() * 4; }
        break;
      case 'graze':
        ai.timer -= dt;
        if (ai.timer <= 0) {
          if (e.kind === 'sheep' && e.sheared && e.woolRegrow <= 0) {
            e.sheared = false;
            Sound.emit('block.grass.hit', { x: e.x, y: e.y, z: e.z, volume: 0.45, pitch: 0.85 });
          }
          ai.mode = 'idle';
          ai.timer = 1.5 + R() * 2;
        }
        break;
      case 'tempt': {
        const dx = player.x - e.x, dz = player.z - e.z;
        const d = Math.hypot(dx, dz) || 1;
        if (d > 2.1) { moveX = dx / d; moveZ = dz / d; speed *= 1.05; }
        break;
      }
      case 'follow': {
        const dx = player.x - e.x, dz = player.z - e.z;
        const d = Math.hypot(dx, dz) || 1;
        if (d > 3) { moveX = dx / d; moveZ = dz / d; speed *= 1.15; }
        else { ai.mode = 'idle'; ai.timer = 1; }
        break;
      }
      case 'village': {
        const dx = (ai.targetX || e.x) - e.x, dz = (ai.targetZ || e.z) - e.z;
        const d = Math.hypot(dx, dz) || 1;
        if (d > 0.75 && !e.sleeping) { moveX = dx / d; moveZ = dz / d; speed *= 0.82; }
        break;
      }
      case 'defend': {
        const target = ai.targetEntity;
        if (!target || target.dead) { ai.mode = 'idle'; ai.timer = 0.5; break; }
        const dx = target.x - e.x, dz = target.z - e.z;
        const d = Math.hypot(dx, dz) || 1;
        moveX = dx / d; moveZ = dz / d; speed *= 1.12;
        if (d < 2.1 && Math.abs(target.y - e.y) < 2.5 && e.attackCd <= 0) {
          e.attackCd = 1.2; e.attackAnim = 0.42;
          Sound.emit('entity.' + e.kind + '.attack', { x: e.x, y: e.y + e.h * 0.55, z: e.z, volume: 0.82 });
          hurtMob(world, target, 8 + Math.floor(R() * 5), e.x, e.z, 1.35);
        }
        break;
      }
      case 'chase': {
        let targetX = ai.canSee ? player.x : ai.lastSeenX;
        let targetZ = ai.canSee ? player.z : ai.lastSeenZ;
        if (!ai.canSee) {
          ai.pathTimer -= dt;
          if (ai.pathTimer <= 0) {
            const step = findPathStep(world, e, targetX, targetZ);
            ai.pathX = step ? step.x : null;
            ai.pathZ = step ? step.z : null;
            ai.pathTimer = 0.55 + R() * 0.25;
          }
          if (ai.pathX !== null) {
            targetX = ai.pathX; targetZ = ai.pathZ;
            if (Math.hypot(targetX - e.x, targetZ - e.z) < 0.35) ai.pathTimer = 0;
          }
        }
        const dx = targetX - e.x, dz = targetZ - e.z;
        const d = Math.hypot(dx, dz) || 1;
        moveX = dx / d; moveZ = dz / d;
        if (M.hostile && e.kind !== 'creeper' && ai.canSee && distP < 1.5 && e.attackCd <= 0 && Math.abs(player.y - e.y) < 2) {
          e.attackCd = 1.0;
          e.attackAnim = 0.42;
          Sound.emit('entity.' + e.kind + '.attack', { x: e.x, y: e.y + e.h * 0.55, z: e.z, volume: 0.82 });
          if (Entities.onMobAttack) Entities.onMobAttack(e, M.dmg || 2);
        }
        break;
      }
      case 'flee': {
        ai.timer -= dt;
        const dx = e.x - ai.fleeX, dz = e.z - ai.fleeZ;
        const d = Math.hypot(dx, dz) || 1;
        moveX = dx / d; moveZ = dz / d;
        speed *= 1.6;
        if (ai.timer <= 0) { ai.mode = 'idle'; ai.timer = 2; }
        break;
      }
    }

    if (ai.mode === 'wander' && (moveX !== 0 || moveZ !== 0)) {
      const nextY = walkY(world, Math.floor(e.x + moveX * 0.9), Math.floor(e.z + moveZ * 0.9), e.y);
      if (nextY === null || e.y - nextY > 1.2) {
        ai.mode = 'idle'; ai.timer = 0.5 + R();
        moveX = 0; moveZ = 0;
      }
    }

    if (moveX !== 0 || moveZ !== 0) {
      const moveYaw = Math.atan2(moveX, -moveZ);
      const turnRate = ai.mode === 'flee' ? 8 : M.hostile ? 5 : 3.5;
      const bodyTurn = Math.min(1, dt * turnRate);
      e.yaw += angleDelta(moveYaw, e.yaw) * bodyTurn;
      const accel = 18;
      e.vx += (moveX * speed - e.vx) * Math.min(1, accel * dt) * (e.onGround ? 1 : 0.3);
      e.vz += (moveZ * speed - e.vz) * Math.min(1, accel * dt) * (e.onGround ? 1 : 0.3);
      const stepHeight = e.jumpCooldown <= 0 ? mobStepHeight(world, e, moveX, moveZ) : 0;
      if (stepHeight > 0) wantJump = true;
      if (e.kind === 'slime' && e.onGround && e.jumpCooldown <= 0) wantJump = true;
    } else {
      e.vx *= (1 - Math.min(1, 8 * dt));
      e.vz *= (1 - Math.min(1, 8 * dt));
    }
    const inW = Physics.headInLiquid(world, e, 'water');
    if (wantJump && e.onGround) {
      e.vy = e.kind === 'slime' ? 7.2 : 7.8;
      e.onGround = false;
      e.jumpCooldown = e.kind === 'slime' ? 0.55 : 0.28;
    }
    if (inW) e.vy += 14 * dt;
    const grazeTarget = ai.mode === 'graze' ? 1 : 0;
    e.grazeAnim = U.lerp(e.grazeAnim || 0, grazeTarget, Math.min(1, dt * 6));
    updateMobPose(e, player, dt, distP);

    updateAnimationSpeed(e, Math.hypot(e.vx, e.vz), dt);
    const cadence = { pig: 3.0, cow: 2.35, sheep: 2.75, chicken: 3.5, zombie: 2.6, skeleton: 2.7, spider: 3.7, creeper: 3.15 }[e.kind] || 2.6;
    e.animPhase += e.animSpeed * dt * cadence;
  }

  // ---------------- spawn management ----------------
  let spawnTimer = 0;
  let villageLifeClock = 0;
  let villageRaidClock = 0;
  let ambientScanCursor = 0;
  let ambientScanCenter = null;
  const ambientTorches = new Map();
  const AMBIENT_Y_ORDER = [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, 7];

  function spawnVillagePopulations(world) {
    if (!world.takeVillagePopulations) return;
    for (const plan of world.takeVillagePopulations()) {
      for (const resident of plan.residents) {
        const villager = spawnMob('villager', resident.x, resident.y, resident.z);
        configureVillageMob(villager, plan, resident);
      }
      if (plan.residents.length >= 4) {
        const golem = spawnMob('iron_golem', plan.x + 0.5, plan.y + 1, plan.z + 6.5);
        configureVillageMob(golem, plan, null);
      }
      const cat = spawnMob('cat', plan.x - 3.5, plan.y + 1, plan.z + 2.5);
      configureVillageMob(cat, plan, null);
    }
  }

  function updateVillageLife(world, player, dt) {
    spawnVillagePopulations(world);
    villageLifeClock += dt;
    villageRaidClock += dt;
    if (villageLifeClock >= 45) {
      villageLifeClock = 0;
      const ids = new Set(list.filter(entity => !entity.dead && entity.kind === 'villager' && entity.villageId).map(entity => entity.villageId));
      for (const id of ids) {
        const plan = world.villageById ? world.villageById(id) : null;
        if (!plan) continue;
        const villagers = list.filter(entity => !entity.dead && entity.kind === 'villager' && entity.villageId === id);
        if (villagers.length >= plan.beds.length || R() >= 0.35) continue;
        const baby = spawnMob('villager', plan.x + 0.5, plan.y + 1, plan.z + 0.5);
        if (!baby) continue;
        configureVillageMob(baby, plan, plan.residents[villagers.length % Math.max(1, plan.residents.length)] || null);
        baby.babyTime = 300; baby.w *= 0.55; baby.h *= 0.55;
        loveParticles(baby);
      }
    }
    if (villageRaidClock >= 75) {
      villageRaidClock = 0;
      const night = world.timeOfDay > 0.72 || world.timeOfDay < 0.20;
      if (!night || player.difficulty === 0 || R() >= 0.30 || !world.nearestVillage) return;
      const plan = world.nearestVillage(player.x, player.z, 72);
      if (!plan) return;
      const count = 2 + Math.floor(R() * 3);
      for (let index = 0; index < count; index++) {
        const angle = index / count * Math.PI * 2 + R() * 0.35;
        const x = plan.x + Math.cos(angle) * 22, z = plan.z + Math.sin(angle) * 22;
        const y = walkY(world, Math.floor(x), Math.floor(z), plan.y);
        if (y === null) continue;
        const zombie = spawnMob('zombie', x, y, z);
        if (zombie) zombie.villageRaid = plan.id;
      }
      UI.toast('村庄附近出现了僵尸围攻');
    }
  }

  function spawnLogic(world, player, dt, dayFactor) {
    if (!mobSpawningEnabled) return;
    const peaceful = player.difficulty === 0;
    if (peaceful) {
      for (const e of list) if (e.type === 'mob' && e.model && e.model.hostile && e.kind !== 'ender_dragon') e.dead = true;
    }
    const playerDimension = world.dimensionAt ? world.dimensionAt(player.x, player.z) : 'overworld';
    if (playerDimension === 'end' && !world.dragonDefeated && !list.some(e => !e.dead && e.kind === 'ender_dragon')) {
      spawnMob('ender_dragon', World.END_OFFSET + 8.5, 88, 8.5);
    }
    spawnTimer -= dt;
    if (spawnTimer > 0) return;
    spawnTimer = 1.0;
    let passive = 0, hostile = 0;
    for (const e of list) {
      if (e.type !== 'mob' || e.dead) continue;
      if (e.model.hostile) hostile++; else passive++;
    }
    const tryOnce = (hostileWanted) => {
      const ang = R() * Math.PI * 2;
      const dist = 24 + R() * 24;
      const x = Math.floor(player.x + Math.cos(ang) * dist);
      const z = Math.floor(player.z + Math.sin(ang) * dist);
      const ch = world.chunkOf(x, z);
      if (!ch || !ch.generated) return;
      const dimension = world.dimensionAt ? world.dimensionAt(x, z) : 'overworld';
      if (!hostileWanted && dimension !== 'overworld') return;
      // find surface
      let y = dimension === 'nether' ? 105 : World.CH_H - 2;
      while (y > 1 && world.getBlock(x, y, z) === 0) y--;
      const ground = world.getBlock(x, y, z);
      const spawnY = y + 1;
      if (Blocks.get(ground).liquid || !Blocks.isSolid(ground)) return;
      if (world.getBlock(x, spawnY, z) !== 0 || world.getBlock(x, spawnY + 1, z) !== 0) return;
      const sky = world.getSky(x, spawnY, z);
      const blk = world.getBlkLight(x, spawnY, z);
      const light = Math.max(sky * dayFactor, blk);
      if (hostileWanted) {
        if (dimension === 'overworld' && light > 7) return;
        const roll = R();
        const kind = dimension === 'nether' ? (roll < 0.55 ? 'blaze' : 'skeleton') :
          dimension === 'end' ? 'enderman' :
          roll < 0.28 ? 'zombie' : roll < 0.48 ? 'skeleton' : roll < 0.66 ? 'spider' : roll < 0.82 ? 'creeper' : roll < 0.93 ? 'slime' : 'bat';
        spawnMob(kind, x + 0.5, spawnY, z + 0.5);
      } else {
        if (ground !== Blocks.ID.GRASS && ground !== Blocks.ID.GRASS_SNOW) return;
        if (light < 8) return;
        const biome = world.biomeAt(x, z);
        const kinds = biome === 'forest' || biome === 'birch_forest' ? ['pig', 'cow', 'sheep', 'chicken', 'wolf', 'rabbit'] :
          biome === 'plains' ? ['pig', 'cow', 'sheep', 'chicken', 'horse', 'rabbit'] :
          ['pig', 'cow', 'sheep', 'chicken', 'rabbit'];
        spawnMob(kinds[Math.floor(R() * kinds.length)], x + 0.5, spawnY, z + 0.5);
      }
    };
    if (passive < 8) tryOnce(false);
    if (!peaceful && hostile < 10) tryOnce(true);
    // despawn far mobs
    for (const e of list) {
      if (e.type === 'mob' && !e.dead) {
        const d = Math.sqrt(U.dist2(e.x, e.y, e.z, player.x, player.y, player.z));
        const persistent = !!e.villageId || !!e.tamed || e.kind === 'ender_dragon';
        if (!persistent && d > 128) e.dead = true;
      }
    }
  }

  // ---------------- main update ----------------
  function update(world, player, dt, dayFactor) {
    const particlesWereActive = particles.length > 0;
    if (mobSpawningEnabled) updateVillageLife(world, player, dt);
    spawnLogic(world, player, dt, dayFactor);
    weatherParticles(world, player, dt);
    ambientBlockParticles(world, player);
    for (const e of list) {
      if (e.dead) continue;
      e.age += dt;
      e.flash = Math.max(0, e.flash - dt);
      e.hurtAnim = Math.max(0, (e.hurtAnim || 0) - dt);
      e.hurtCooldown = Math.max(0, (e.hurtCooldown || 0) - dt);
      e.playerDamageTime = Math.max(0, (e.playerDamageTime || 0) - dt);
      if (e.type === 'item') {
        physicsTick(world, e, dt, true);
        const itemDrag = Math.pow(e.onGround ? 0.58 : 0.98, dt * 20);
        e.vx *= itemDrag;
        e.vz *= itemDrag;
        if (e.onGround) {
          if (Math.abs(e.vx) < 0.02) e.vx = 0;
          if (Math.abs(e.vz) < 0.02) e.vz = 0;
        }
        // magnet + pickup
        if (e.pickupDelay > 0) e.pickupDelay -= dt;
        else if (!player.dead) {
          const d = Math.sqrt(U.dist2(e.x, e.y, e.z, player.x, player.y + 0.8, player.z));
          let pickupBlocked = false;
          if (d < 0.9 && Entities.onPickup) {
            const previousCount = e.count;
            const left = Entities.onPickup(e.itemId, e.count, e.dur, e.ench, e.customName);
            if (left <= 0) e.dead = true;
            else {
              e.count = left;
              pickupBlocked = left >= previousCount;
            }
          }
          if (!e.dead && !pickupBlocked && d > 1e-4 && d < 2.0) {
            const dx = player.x - e.x, dy = player.y + 0.8 - e.y, dz = player.z - e.z;
            const pull = U.clamp((2 - d) / 2, 0.15, 1) * 18 * dt;
            e.vx += dx / d * pull; e.vy += dy / d * pull; e.vz += dz / d * pull;
            const speed = Math.hypot(e.vx, e.vy, e.vz);
            if (speed > 6) {
              const scale = 6 / speed;
              e.vx *= scale; e.vy *= scale; e.vz *= scale;
            }
          }
        }
        if (e.age > 300) e.dead = true;
        // merge
        if ((e.id & 3) === 0) {
          for (const o of queryBox(e.x - 0.8, e.z - 0.8, e.x + 0.8, e.z + 0.8, QUERY_WORK)) {
            if (o !== e && !o.dead && o.type === 'item' && o.itemId === e.itemId &&
                e.dur === undefined && o.dur === undefined && !e.ench && !o.ench && !e.customName && !o.customName &&
                U.dist2(e.x, e.y, e.z, o.x, o.y, o.z) < 0.6) {
              const max = Items.maxStack(e.itemId);
              if (e.count + o.count <= max) { e.count += o.count; o.dead = true; }
            }
          }
        }
      } else if (e.type === 'xp') {
        physicsTick(world, e, dt, true);
        if (!player.dead) {
          const d = Math.sqrt(U.dist2(e.x, e.y, e.z, player.x, player.y + 0.8, player.z));
          if (d < 8 && d > 1e-4) {
            const pull = U.clamp((8 - d) / 8, 0.1, 1) * 28;
            e.vx += (player.x - e.x) / d * pull * dt;
            e.vy += (player.y + 0.8 - e.y) / d * pull * dt;
            e.vz += (player.z - e.z) / d * pull * dt;
          }
          if (d < 0.75) {
            if (Entities.onXP) Entities.onXP(e.value);
            e.dead = true;
          }
        }
        if (e.age > 300) e.dead = true;
      } else if (e.type === 'egg' || e.type === 'ender_pearl') {
        e.vy -= 9.8 * dt;
        const speed = Math.hypot(e.vx, e.vy, e.vz);
        const travel = speed * dt;
        const steps = Math.max(1, Math.ceil(travel / 0.3));
        const stepDt = dt / steps;
        for (let step = 0; step < steps && !e.dead; step++) {
          const stepSpeed = Math.hypot(e.vx, e.vy, e.vz);
          const stepDistance = stepSpeed * stepDt;
          if (stepDistance <= 1e-6) break;
          const dx = e.vx / stepSpeed, dy = e.vy / stepSpeed, dz = e.vz / stepSpeed;
          const blockHit = world.raycast(e.x, e.y, e.z, dx, dy, dz, stepDistance);
          const mobHit = raycastEntity(e.x, e.y, e.z, dx, dy, dz, stepDistance, candidate => candidate.type === 'mob');
          const hitDistance = mobHit && (!blockHit || mobHit.dist < blockHit.dist) ? mobHit.dist : (blockHit ? blockHit.dist : null);
          if (hitDistance !== null) {
            e.x += dx * Math.max(0, hitDistance - 0.01);
            e.y += dy * Math.max(0, hitDistance - 0.01);
            e.z += dz * Math.max(0, hitDistance - 0.01);
            if (e.type === 'egg') breakEgg(e);
            else landEnderPearl(e, world, player);
            break;
          }
          e.x += e.vx * stepDt; e.y += e.vy * stepDt; e.z += e.vz * stepDt;
        }
        if (!e.dead && (e.age > 30 || e.y < -16)) e.dead = true;
      } else if (e.type === 'arrow') {
        if (e.stuck) {
          e.vx = e.vy = e.vz = 0;
          if (e.age - (e.stuckAt || 0) > 0.5 && U.dist2(e.x, e.y, e.z, player.x, player.y + 0.8, player.z) < 1.5 * 1.5) {
            const left = Entities.onPickup ? Entities.onPickup(Items.IT.ARROW, 1) : 1;
            if (left <= 0) e.dead = true;
          }
          if (e.age - (e.stuckAt || 0) > 60) e.dead = true;
          continue;
        }
        e.vy -= 3.2 * dt;
        const speed = Math.hypot(e.vx, e.vy, e.vz);
        const travel = speed * dt;
        const steps = Math.max(1, Math.ceil(travel / 0.35));
        const stepDt = dt / steps;
        for (let step = 0; step < steps && !e.dead; step++) {
          const stepDistance = Math.hypot(e.vx, e.vy, e.vz) * stepDt;
          if (stepDistance <= 1e-6) break;
          const inv = 1 / Math.hypot(e.vx, e.vy, e.vz);
          const dx = e.vx * inv, dy = e.vy * inv, dz = e.vz * inv;
          const blockHit = world.raycast(e.x, e.y, e.z, dx, dy, dz, stepDistance);
          const mobHit = raycastEntity(e.x, e.y, e.z, dx, dy, dz, stepDistance, candidate => candidate.type === 'mob');
          if (mobHit && (!blockHit || mobHit.dist < blockHit.dist)) {
            e.x += dx * mobHit.dist; e.y += dy * mobHit.dist; e.z += dz * mobHit.dist;
            hurtMob(world, mobHit.entity, e.damage, e.x, e.z, 0.8);
            if (!mobHit.entity.dead) mobHit.entity.embeddedArrows = Math.min(4, (mobHit.entity.embeddedArrows || 0) + 1);
            e.dead = true;
            break;
          }
          if (blockHit) {
            e.x += dx * Math.max(0, blockHit.dist - 0.03);
            e.y += dy * Math.max(0, blockHit.dist - 0.03);
            e.z += dz * Math.max(0, blockHit.dist - 0.03);
            e.vx = e.vy = e.vz = 0;
            e.stuck = true; e.stuckAt = e.age;
            const hitSound = Blocks.soundEvent ? Blocks.soundEvent(blockHit.id, 'hit') : 'block.wood.hit';
            Sound.emit(hitSound, { x: e.x, y: e.y, z: e.z, volume: 0.35, pitch: 1.35 });
            break;
          }
          e.x += e.vx * stepDt; e.y += e.vy * stepDt; e.z += e.vz * stepDt;
        }
        if ((!e.stuck && e.age > 30) || e.y < -16) e.dead = true;
      } else if (e.type === 'tnt') {
        physicsTick(world, e, dt, false);
        e.fuse -= dt;
        if (e.fuse <= 0) {
          e.dead = true;
          explode(world, e.x, e.y + 0.5, e.z, 3.6);
        }
      } else if (e.type === 'mob') {
        mobAI(world, e, player, dt, dayFactor);
        if (!e.dead) {
          const audioX = e.x, audioZ = e.z;
          let env;
          if (e.model && e.model.flying) {
            Physics.move(world, e, dt);
            env = { inWater: Physics.isInLiquid(world, e, 'water'), inLava: Physics.isInLiquid(world, e, 'lava') };
          } else {
            env = physicsTick(world, e, dt, !!(e.model && e.model.aquatic));
          }
          if (e.onGround && !(e.model && (e.model.aquatic || e.model.flying))) {
            e.audioStepDist = (e.audioStepDist || 0) + Math.hypot(e.x - audioX, e.z - audioZ);
            const stride = Math.max(0.45, Math.min(2.2, e.w * (e.kind === 'chicken' ? 1.4 : 1.9)));
            if (e.audioStepDist >= stride) {
              e.audioStepDist %= stride;
              Sound.emit('entity.' + e.kind + '.step', {
                x: e.x, y: e.y + Math.min(0.5, e.h * 0.3), z: e.z,
                volume: U.clamp(0.24 + e.w * 0.22, 0.25, 0.72),
              });
            }
          }
          if (env.inLava) { e.burnLava = (e.burnLava || 0) + dt; if (e.burnLava > 0.5) { e.burnLava = 0; hurtMob(world, e, 4); } }
          emitBurningParticle(e, dt);
          if (e.y < -10) e.dead = true;
        }
      }
    }
    const syncedEntities = networkEntityProvider ? networkEntityProvider() : null;
    if (syncedEntities) for (const entity of syncedEntities) emitBurningParticle(entity, dt);
    // particles
    for (const p of particles) {
      p.life -= dt;
      if (p.life <= 0) continue;
      p.vy -= (p.gravity || 0) * dt * 9;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    }
    let write = 0;
    for (let i = 0; i < list.length; i++) {
      if (list[i].dead) spatialRemove(list[i]);
      else { spatialUpdate(list[i]); list[write++] = list[i]; }
    }
    list.length = write;
    write = 0;
    for (let i = 0; i < particles.length; i++) if (particles[i].life > 0) particles[write++] = particles[i];
    particles.length = write;
    if (particles.length > MAX_PARTICLES) particles.splice(0, particles.length - MAX_PARTICLES);
    if (particlesWereActive || particles.length > 0) particleVersion++;
    let itemCount = 0;
    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i];
      if (e.type !== 'item') continue;
      if (++itemCount > MAX_ITEMS) e.dead = true;
    }
    geometryVersion++;
  }

  // ---------------- geometry building (shared vertex format: x,y,z,u,v,sky,blk) ----------------
  const ENTITY_BOX_FACES = [
    { c: [5, 1, 3, 7], key: 'right', shade: 0.6 },
    { c: [0, 4, 6, 2], key: 'left', shade: 0.6 },
    { c: [2, 6, 7, 3], key: 'top', shade: 1.0 },
    { c: [0, 1, 5, 4], key: 'bottom', shade: 0.5 },
    { c: [4, 5, 7, 6], key: 'back', shade: 0.8 },
    { c: [1, 0, 2, 3], key: 'front', shade: 0.8 },
  ];
  const ITEM_BOX_FACES = [
    { c: [5, 1, 3, 7], key: 'right', shade: 0.7 },
    { c: [0, 4, 6, 2], key: 'left', shade: 0.7 },
    { c: [2, 6, 7, 3], key: 'top', shade: 1.0 },
    { c: [0, 1, 5, 4], key: 'bottom', shade: 0.5 },
    { c: [4, 5, 7, 6], key: 'back', shade: 0.85 },
    { c: [1, 0, 2, 3], key: 'front', shade: 0.85 },
  ];
  const TNT_BOX_FACES = [
    { c: [5, 1, 3, 7], tile: 'tnt_side' }, { c: [0, 4, 6, 2], tile: 'tnt_side' },
    { c: [2, 6, 7, 3], tile: 'tnt_top' }, { c: [0, 1, 5, 4], tile: 'tnt_bottom' },
    { c: [4, 5, 7, 6], tile: 'tnt_side' }, { c: [1, 0, 2, 3], tile: 'tnt_side' },
  ];
  let PART_CACHE = new WeakMap();
  const ENTITY_PHASE_CACHE = new WeakMap();
  const ITEM_SPRITE_CACHE = new Map();
  let shadowUV = null;
  const BOX_CORNERS = new Float32Array(8 * 3);
  const HELD_CORNERS = new Float32Array(8 * 3);
  const GEOM_WORK = {
    normal: { verts: [], inds: [], n: 0 },
    flash: { verts: [], inds: [], n: 0 },
    charge: { verts: [], inds: [], n: 0 },
    glint: { verts: [], inds: [], n: 0 },
    shadow: { verts: [], inds: [], n: 0 },
  };
  const GEOM_POOL = {};
  const PARTICLE_WORK = { verts: [], inds: [], n: 0 };

  function resetWork(out) { out.verts.length = 0; out.inds.length = 0; out.n = 0; }
  function growTyped(old, Ctor, needed) {
    if (old && old.constructor === Ctor && old.length >= needed) return old;
    let size = old && old.constructor === Ctor ? old.length : 256;
    while (size < needed) size *= 2;
    return new Ctor(size);
  }
  function finalizeWork(out, key) {
    const useUint = typeof GL === 'undefined' || GL.uintIndices !== false;
    let pool = GEOM_POOL[key];
    if (!pool) pool = GEOM_POOL[key] = {};
    if (!useUint && out.n > 65535) {
      const count = out.inds.length;
      pool.verts = growTyped(pool.verts, Float32Array, count * 7);
      for (let i = 0; i < count; i++) {
        const src = out.inds[i] * 7, dst = i * 7;
        for (let k = 0; k < 7; k++) pool.verts[dst + k] = out.verts[src + k];
      }
      return { verts: pool.verts.subarray(0, count * 7), inds: null, count, indexed: false };
    }
    const IndexArray = useUint ? Uint32Array : Uint16Array;
    pool.verts = growTyped(pool.verts, Float32Array, out.verts.length);
    pool.inds = growTyped(pool.inds, IndexArray, out.inds.length);
    pool.verts.set(out.verts, 0);
    pool.inds.set(out.inds, 0);
    return {
      verts: pool.verts.subarray(0, out.verts.length),
      inds: pool.inds.subarray(0, out.inds.length),
      count: out.inds.length,
      indexed: true,
    };
  }

  function pushTexturedFace(out, corners, face, uv, sky, blk, shade) {
    const base = out.n;
    for (let k = 0; k < 4; k++) {
      const ci = face.c[k] * 3;
      const u = k === 0 || k === 3 ? uv[0] : uv[2];
      const v = k < 2 ? uv[3] : uv[1];
      out.verts.push(corners[ci], corners[ci + 1], corners[ci + 2], u, v, sky * shade, blk * shade);
    }
    out.inds.push(base, base + 1, base + 2, base, base + 2, base + 3);
    out.n += 4;
  }

  function blockItemTiles(id) {
    const texture = Blocks.get(id).tex;
    return {
      right: texture.all || texture.side || texture.front || texture.top,
      left: texture.all || texture.side || texture.front || texture.top,
      top: texture.all || texture.top || texture.side || texture.front,
      bottom: texture.all || texture.bottom || texture.side || texture.top,
      back: texture.all || texture.side || texture.front || texture.top,
      front: texture.all || texture.front || texture.side || texture.top,
    };
  }

  function itemSpriteTemplate(tile) {
    let cached = ITEM_SPRITE_CACHE.get(tile);
    if (cached) return cached;
    const uv = Textures.uv(tile || 'stick');
    const vertices = [], indices = [];
    const thickness = 1 / 16;
    const addQuad = (points, tex, shade) => {
      const base = vertices.length / 6;
      for (let i = 0; i < 4; i++) {
        vertices.push(points[i][0], points[i][1], points[i][2], tex[i][0], tex[i][1], shade);
      }
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };
    const q = [[uv[0],uv[3]],[uv[2],uv[3]],[uv[2],uv[1]],[uv[0],uv[1]]];
    addQuad([[-1,-1,thickness],[1,-1,thickness],[1,1,thickness],[-1,1,thickness]], q, 1);
    addQuad([[-1,1,-thickness],[1,1,-thickness],[1,-1,-thickness],[-1,-1,-thickness]],
      [[uv[0],uv[1]],[uv[2],uv[1]],[uv[2],uv[3]],[uv[0],uv[3]]], 0.82);

    const rect = Textures.rect(tile || 'stick');
    const pixels = Textures.atlas.canvas.getContext('2d').getImageData(rect[0], rect[1], 16, 16).data;
    const opaque = (x, y) => x >= 0 && x < 16 && y >= 0 && y < 16 && pixels[(y * 16 + x) * 4 + 3] >= 128;
    const du = (uv[2] - uv[0]) / 16, dv = (uv[3] - uv[1]) / 16;
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      if (!opaque(x, y)) continue;
      const x0 = x / 8 - 1, x1 = (x + 1) / 8 - 1;
      const y0 = 1 - (y + 1) / 8, y1 = 1 - y / 8;
      const tc = [uv[0] + (x + 0.5) * du, uv[1] + (y + 0.5) * dv];
      const edgeUV = [tc, tc, tc, tc];
      if (!opaque(x - 1, y)) addQuad([[x0,y0,-thickness],[x0,y0,thickness],[x0,y1,thickness],[x0,y1,-thickness]], edgeUV, 0.72);
      if (!opaque(x + 1, y)) addQuad([[x1,y0,thickness],[x1,y0,-thickness],[x1,y1,-thickness],[x1,y1,thickness]], edgeUV, 0.72);
      if (!opaque(x, y - 1)) addQuad([[x0,y1,thickness],[x1,y1,thickness],[x1,y1,-thickness],[x0,y1,-thickness]], edgeUV, 0.9);
      if (!opaque(x, y + 1)) addQuad([[x0,y0,-thickness],[x1,y0,-thickness],[x1,y0,thickness],[x0,y0,thickness]], edgeUV, 0.62);
    }
    cached = { vertices, indices };
    ITEM_SPRITE_CACHE.set(tile, cached);
    return cached;
  }

  function rotateItemPoint(x, y, z, rotation) {
    const rx = Number(rotation && rotation[0]) || 0;
    const ry = Number(rotation && rotation[1]) || 0;
    const rz = Number(rotation && rotation[2]) || 0;
    if (rx) { const c = Math.cos(rx), s = Math.sin(rx), ny = y * c - z * s; z = y * s + z * c; y = ny; }
    if (ry) { const c = Math.cos(ry), s = Math.sin(ry), nx = x * c - z * s; z = x * s + z * c; x = nx; }
    if (rz) { const c = Math.cos(rz), s = Math.sin(rz), nx = x * c - y * s; y = x * s + y * c; x = nx; }
    return [x, y, z];
  }

  function pushExtrudedItem(out, tile, transform, sky, blk) {
    const template = itemSpriteTemplate(tile);
    const base = out.n;
    for (let i = 0; i < template.vertices.length; i += 6) {
      const point = transform(template.vertices[i], template.vertices[i + 1], template.vertices[i + 2]);
      const shade = template.vertices[i + 5];
      out.verts.push(point[0], point[1], point[2], template.vertices[i + 3], template.vertices[i + 4], sky * shade, blk * shade);
      out.n++;
    }
    for (const index of template.indices) out.inds.push(base + index);
  }

  function partGeometry(part) {
    let cached = PART_CACHE.get(part);
    if (cached) return cached;
    const scale = 1 / 16;
    const sw = part.s[0] * scale / 2;
    const sh = part.s[1] * scale / 2;
    const sl = part.s[2] * scale / 2;
    const corners = [];
    for (let i = 0; i < 8; i++) {
      let x = i & 1 ? sw : -sw, y = i & 2 ? sh : -sh, z = i & 4 ? sl : -sl;
      if (part.rot) {
        const rx = part.rot[0] || 0, ry = part.rot[1] || 0, rz = part.rot[2] || 0;
        if (rx) { const c = Math.cos(rx), s = Math.sin(rx), ny = y * c - z * s; z = y * s + z * c; y = ny; }
        if (ry) { const c = Math.cos(ry), s = Math.sin(ry), nx = x * c - z * s; z = x * s + z * c; x = nx; }
        if (rz) { const c = Math.cos(rz), s = Math.sin(rz), nx = x * c - y * s; y = x * s + y * c; x = nx; }
      }
      corners.push([x, y, z]);
    }
    const faces = ENTITY_BOX_FACES.map((face) => {
      const uv = textureUv(part.tex[face.key]);
      const u0 = part.mirror ? uv[2] : uv[0];
      const u1 = part.mirror ? uv[0] : uv[2];
      return {
        c: face.c,
        shade: face.shade,
        uv: [[u0, uv[3]], [u1, uv[3]], [u1, uv[1]], [u0, uv[1]]],
      };
    });
    cached = { sw, sh, sl, corners, faces };
    PART_CACHE.set(part, cached);
    return cached;
  }

  let prewarmResult = null;
  function reserveGeometryPool(key, vertexFloats, indexCount) {
    const pool = GEOM_POOL[key] || (GEOM_POOL[key] = {});
    const useUint = typeof GL === 'undefined' || GL.uintIndices !== false;
    pool.verts = growTyped(pool.verts, Float32Array, vertexFloats);
    pool.inds = growTyped(pool.inds, useUint ? Uint32Array : Uint16Array, indexCount);
  }

  function prewarmGeometry() {
    if (prewarmResult) return prewarmResult;
    const seen = new Set();
    const warmModel = model => {
      if (!model || !Array.isArray(model.parts)) return;
      for (const part of model.parts) {
        if (!part || seen.has(part)) continue;
        seen.add(part);
        partGeometry(part);
      }
    };
    for (const model of Object.values(MODELS)) warmModel(model);
    for (const model of Object.values(ORIGINAL_MODELS)) warmModel(model);
    for (const model of Object.values(VILLAGER_MODELS)) warmModel(model);
    for (const model of Object.values(ORIGINAL_VILLAGER_MODELS)) warmModel(model);
    for (const model of REMOTE_PLAYER_MODELS.values()) warmModel(model);
    for (const model of ORIGINAL_REMOTE_PLAYER_MODELS.values()) warmModel(model);
    warmModel(MINECART_MODEL);
    for (const material of ['leather', 'gold', 'iron', 'diamond']) {
      for (const modelType of ['classic', 'slim']) for (let slot = 0; slot < 4; slot++) {
        for (const part of remoteArmorParts(slot, material, modelType, true)) {
          if (seen.has(part)) continue;
          seen.add(part);
          partGeometry(part);
        }
      }
    }
    reserveGeometryPool('normal', 65536, 24576);
    reserveGeometryPool('particles', 32768, 8192);
    for (const key of ['flash', 'charge', 'glint', 'shadow']) reserveGeometryPool(key, 8192, 3072);
    prewarmResult = { parts: seen.size, normalVertexCapacity: GEOM_POOL.normal.verts.length };
    return prewarmResult;
  }

  function entityIdlePhase(e) {
    const key = String(e.id === undefined ? '' : e.id);
    const cached = ENTITY_PHASE_CACHE.get(e);
    if (cached && cached.key === key) return cached.phase;
    let hash = 2166136261;
    for (let i = 0; i < key.length; i++) {
      hash = Math.imul(hash ^ key.charCodeAt(i), 16777619);
    }
    const phase = (hash >>> 0) / 4294967296 * Math.PI * 2;
    ENTITY_PHASE_CACHE.set(e, { key, phase });
    return phase;
  }

  function remotePlayerArmSwing(e, right, phase) {
    phase = phase === undefined ? (e.animPhase || 0) : phase;
    const sidePhase = right ? 0 : Math.PI;
    const movementScale = e.sneaking ? 0.45 : e.sprinting ? 1.18 : 1;
    let swing = Math.sin(phase + sidePhase) * Math.min(0.92, (e.animSpeed || 0) * 0.42) * movementScale;
    const guard = U.clamp(e.blockBlend === undefined ? (e.blocking ? 1 : 0) : e.blockBlend, 0, 1);
    const offhandItem = e.offhand ? Items.get(e.offhand) : null;
    const guardRight = !(offhandItem && offhandItem.shield);
    swing = U.lerp(swing, right === guardRight ? 1.15 : 0.10, guard);
    const action = e.action || 'idle';
    const actionPhase = U.clamp(e.actionPhase || 0, 0, 1);
    if (action === 'eat' && right) swing = U.lerp(swing, 1.48 + Math.sin(actionPhase * Math.PI * 8) * 0.12, 0.92);
    else if ((action === 'use' || action === 'fish') && right) swing = U.lerp(swing, 1.12, 0.82);
    else if (action === 'bow') swing = U.lerp(swing, right ? 1.22 : 1.42, 0.94);
    if (!e.onGround && action === 'idle') swing += right ? -0.16 : 0.16;
    if (right && e.attackAnim > 0) {
      const attackT = 1 - e.attackAnim / 0.42;
      swing += vanillaAttackSwing(attackT) * U.lerp(1.05, 0.62, guard);
    }
    return swing;
  }

  function vanillaAttackSwing(progress) {
    const t = U.clamp(progress || 0, 0, 1);
    return Math.sin(t * Math.PI) * 1.2 + Math.sin(Math.sqrt(t) * Math.PI * 2) * 0.2;
  }

  function pushBox(out, e, part, world, lod, light) {
    const geom = partGeometry(part);
    const speed = e.animSpeed || 0;
    const poseAge = e.age;
    const animPhase = e.animPhase;
    const isLeg = part.anim === 'leg0' || part.anim === 'leg1';
    const isArm = part.anim === 'armF0' || part.anim === 'armF1';
    const isPlayerArm = part.anim === 'arm0' || part.anim === 'arm1';
    const isGolemArm = part.anim === 'golemArm0' || part.anim === 'golemArm1';
    const isSpiderLeg = part.anim === 'spiderLeg' && part.spiderLeg;
    const isWing = part.anim === 'wing0' || part.anim === 'wing1';
    const isTentacle = typeof part.anim === 'string' && part.anim.indexOf('tentacle') === 0;
    const isPlayer = e.kind === 'player';
    let swing = 0;
    const gait = { pig: 0.46, cow: 0.34, sheep: 0.42, zombie: 0.42, creeper: 0.5 }[e.kind] || 0.4;
    if (part.anim === 'leg0') swing = Math.sin(animPhase) * Math.min(isPlayer && e.sprinting ? 1.0 : 0.78, speed * gait * (isPlayer && e.sprinting ? 1.22 : 1));
    else if (part.anim === 'leg1') swing = -Math.sin(animPhase) * Math.min(isPlayer && e.sprinting ? 1.0 : 0.78, speed * gait * (isPlayer && e.sprinting ? 1.22 : 1));
    else if (isArm) {
      const phase = part.anim === 'armF1' ? Math.PI : 0;
      const idle = Math.sin(poseAge * 1.8 + phase) * 0.035;
      const walk = Math.sin(animPhase + phase) * Math.min(0.22, speed * 0.12);
      const attackT = e.attackAnim > 0 ? 1 - e.attackAnim / 0.42 : 0;
      const strike = e.attackAnim > 0 ? vanillaAttackSwing(attackT) * 0.28 : 0;
      // Positive X rotation brings the lower arm toward the local -Z front face.
      swing = 1.28 + idle + walk + strike;
    } else if (isPlayerArm) {
      swing = remotePlayerArmSwing(e, part.anim === 'arm1', animPhase);
    } else if (isGolemArm) {
      const phase = part.anim === 'golemArm1' ? Math.PI : 0;
      swing = Math.sin(animPhase + phase) * Math.min(0.62, speed * 0.28);
      if (e.attackAnim > 0) {
        const attackT = 1 - e.attackAnim / 0.42;
        swing += vanillaAttackSwing(attackT) * 1.45;
      }
    } else if (isTentacle) {
      const index = Number(part.anim.slice(8)) || 0;
      swing = Math.sin(poseAge * 3.4 + index * 0.83) * 0.16;
    }
    if (isPlayer && isLeg) {
      if (e.sneaking) swing = U.lerp(swing, part.anim === 'leg0' ? 0.34 : -0.22, 0.72);
      else if (!e.onGround) swing = part.anim === 'leg0' ? 0.28 : -0.28;
    }
    if (isLeg && e.kind === 'creeper' && e.fuseProgress > 0) {
      const sidePhase = part.anim === 'leg0' ? 0 : Math.PI;
      swing += Math.sin(poseAge * 18 + sidePhase) * 0.12 * e.fuseProgress;
    }

    let cx = part.c[0] / 16, cy = part.c[1] / 16, cz = part.c[2] / 16;
    if (part.orbit) {
      const angle = poseAge * part.orbit.s + part.orbit.p;
      cx = (Math.cos(angle) * part.orbit.r + (part.orbit.xOffset || 0)) / 16;
      cz = (Math.sin(angle) * part.orbit.r + (part.orbit.zOffset || 0)) / 16;
      if (Number.isFinite(part.orbit.ySpeed)) {
        cy = (part.orbit.y + Math.cos(poseAge * part.orbit.ySpeed + (part.orbit.yPhase || 0)) *
          (part.orbit.yAmp || 0)) / 16;
      } else {
        cy = (part.orbit.y + Math.sin(angle * 1.7) * 1.4) / 16;
      }
    }
    const bobScale = e.kind === 'cow' ? 0.012 : e.kind === 'pig' ? 0.022 : 0.018;
    const bob = e.onGround ? Math.abs(Math.sin(animPhase)) * Math.min(0.035, speed * bobScale) : 0;
    const breathe = part.anim === 'body' && speed < 0.25 ? 1 + Math.sin(poseAge * 1.7) * 0.012 : 1;
    const idlePhase = entityIdlePhase(e);
    const earSign = part.wiggle === 'ear0' ? -1 : 1;
    const earSwing = part.wiggle ? Math.sin(poseAge * 1.7 + idlePhase) * 0.05 * earSign : 0;
    const tailSwing = part.anim === 'tail' ? Math.sin(poseAge * 1.5 + idlePhase * 1.37) * (0.1 + Math.min(0.08, speed * 0.04)) : 0;
    const fuse = e.kind === 'creeper' ? (e.fuseProgress || 0) : 0;
    const fuseX = 1 + fuse * fuse * 0.24;
    const fuseY = 1 + fuse * fuse * 0.15;
    const hurtT = e.hurtAnim > 0 ? 1 - e.hurtAnim / 0.35 : 0;
    const hurtLean = e.hurtAnim > 0 ? Math.sin(hurtT * Math.PI) * 0.11 : 0;
    const modelLean = fuse * fuse * 0.12 + hurtLean;
    const cyaw = Math.cos(e.yaw), syaw = Math.sin(e.yaw);
    const corners = BOX_CORNERS;
    for (let i = 0; i < 8; i++) {
      let lx = geom.corners[i][0];
      let ly = geom.corners[i][1];
      let lz = geom.corners[i][2];
      let positionApplied = false;
      if (isSpiderLeg) {
        const leg = part.spiderLeg;
        const pivotX = leg.pivot[0] / 16, pivotY = leg.pivot[1] / 16, pivotZ = leg.pivot[2] / 16;
        let px = lx + cx - pivotX, py = ly + cy - pivotY, pz = lz + cz - pivotZ;
        const pairPhase = [0, Math.PI, Math.PI / 2, Math.PI * 1.5][leg.pair] || 0;
        const amount = Math.min(1, speed * 0.35);
        const yawDelta = -Math.cos(animPhase * 2 + pairPhase) * 0.4 * amount;
        const rollDelta = Math.abs(Math.sin(animPhase + pairPhase) * 0.4) * amount;
        const yaw = leg.yaw + yawDelta * (leg.side < 0 ? 1 : -1);
        const roll = -(leg.roll + rollDelta * (leg.side < 0 ? 1 : -1));
        let c = Math.cos(yaw), s = Math.sin(yaw);
        const nextX = px * c - pz * s;
        pz = px * s + pz * c;
        px = nextX;
        c = Math.cos(roll); s = Math.sin(roll);
        const rolledX = px * c - py * s;
        py = px * s + py * c;
        px = rolledX;
        lx = px + pivotX;
        ly = py + pivotY;
        lz = pz + pivotZ;
        positionApplied = true;
      }
      if (isLeg || isArm || isPlayerArm || isGolemArm || isTentacle) {
        const joint = part.joint || [0, part.s[1] / 2, 0];
        const pivotX = joint[0] / 16, pivotY = joint[1] / 16, pivotZ = joint[2] / 16;
        const px = lx - pivotX, py = ly - pivotY, pz = lz - pivotZ;
        const c = Math.cos(swing), s = Math.sin(swing);
        lx = px + pivotX;
        ly = py * c - pz * s + pivotY;
        lz = py * s + pz * c + pivotZ;
      }
      if (isWing) {
        const side = part.anim === 'wing0' ? -1 : 1;
        const flap = side * (0.12 + Math.sin(poseAge * (e.kind === 'ender_dragon' ? 2.4 : 8.5)) * (e.kind === 'ender_dragon' ? 0.32 : 0.62));
        const joint = part.joint;
        const pivotX = joint ? joint[0] / 16 : (part.anim === 'wing0' ? geom.sw : -geom.sw);
        const pivotY = joint ? joint[1] / 16 : 0;
        const px = lx - pivotX, py = ly - pivotY;
        const c = Math.cos(flap), s = Math.sin(flap);
        const nextX = px * c - py * s;
        ly = px * s + py * c + pivotY;
        lx = nextX + pivotX;
      }
      if (part.anim === 'body') ly *= breathe;
      if (part.wiggle) {
        const joint = part.joint || [0, -part.s[1] / 2, 0];
        const pivotX = joint[0] / 16, pivotY = joint[1] / 16;
        const px = lx - pivotX, py = ly - pivotY;
        const c = Math.cos(earSwing), s = Math.sin(earSwing);
        const nx = px * c - py * s;
        ly = px * s + py * c + pivotY;
        lx = nx + pivotX;
      }
      if (!positionApplied) {
        lx += cx;
        ly += cy;
        lz += cz;
      }
      if (part.anim === 'head') {
        const pivot = e.model.headPivot || part.c;
        const px = pivot[0] / 16, py = pivot[1] / 16, pz = pivot[2] / 16;
        lx -= px; ly -= py; lz -= pz;
        const cp = Math.cos(e.headPitch || 0), sp = Math.sin(e.headPitch || 0);
        const hpY = ly * cp - lz * sp;
        lz = ly * sp + lz * cp;
        ly = hpY;
        const ch = Math.cos(e.headYaw || 0), sh = Math.sin(e.headYaw || 0);
        const hpX = lx * ch - lz * sh;
        lz = lx * sh + lz * ch;
        lx = hpX;
        lx += px; ly += py; lz += pz;
      }
      if (part.anim === 'tail') {
        const pivot = part.pivot || part.c;
        const px = pivot[0] / 16, pz = pivot[2] / 16;
        const tx = lx - px, tz = lz - pz;
        const c = Math.cos(tailSwing), s = Math.sin(tailSwing);
        lx = tx * c - tz * s + px;
        lz = tx * s + tz * c + pz;
      }
      if (isPlayer) {
        const upperBody = part.anim === 'body' || part.anim === 'head' || isPlayerArm || (part.armor && !isLeg);
        const poseLean = e.sneaking ? -0.42 : e.sprinting ? -0.18 : 0;
        if (upperBody && poseLean) {
          const pivotY = 0.75;
          const py = ly - pivotY;
          const c = Math.cos(poseLean), s = Math.sin(poseLean);
          const nextY = py * c - lz * s;
          lz = py * s + lz * c;
          ly = nextY + pivotY;
        }
        if (upperBody && e.sneaking) { ly -= 0.12; lz -= 0.08; }
      }
      if (e.babyTime > 0) {
        const baseScale = 0.55;
        if (part.anim === 'head' && e.kind !== 'slime') {
          const pivot = e.model.headPivot || part.c;
          const px = pivot[0] / 16, py = pivot[1] / 16, pz = pivot[2] / 16;
          const headScale = 0.72;
          lx = (lx - px) * headScale + px * baseScale;
          ly = (ly - py) * headScale + py * 0.58;
          lz = (lz - pz) * headScale + pz * baseScale;
        } else {
          lx *= baseScale; ly *= baseScale; lz *= baseScale;
        }
      }
      if (fuse > 0) {
        lx *= fuseX;
        ly *= fuseY;
        lz *= fuseX;
      }
      if (modelLean !== 0) {
        const c = Math.cos(modelLean), s = Math.sin(modelLean);
        const ny = ly * c - lz * s;
        lz = ly * s + lz * c;
        ly = ny;
      }
      const wx = lx * cyaw - lz * syaw;
      const wz = lx * syaw + lz * cyaw;
      const ci = i * 3;
      corners[ci] = e.x + wx;
      corners[ci + 1] = e.y + ly + bob;
      corners[ci + 2] = e.z + wz;
    }

    const sky = light ? light[0] : world.getSky(Math.floor(e.x), Math.floor(e.y + e.h / 2), Math.floor(e.z)) / 15;
    const blk = light ? light[1] : world.getBlkLight(Math.floor(e.x), Math.floor(e.y + e.h / 2), Math.floor(e.z)) / 15;
    for (const face of geom.faces) {
      const base = out.n;
      const s = sky * face.shade, b = blk * face.shade;
      for (let k = 0; k < 4; k++) {
        const ci = face.c[k] * 3;
        out.verts.push(corners[ci], corners[ci + 1], corners[ci + 2], face.uv[k][0], face.uv[k][1], s, b);
      }
      out.inds.push(base, base + 1, base + 2, base, base + 2, base + 3);
      out.n += 4;
    }
  }

  function pushMinecart(out, rider, world, light) {
    const cart = {
      id: String(rider.id === undefined ? '' : rider.id) + ':minecart',
      kind: 'minecart', model: MINECART_MODEL,
      x: rider.x, y: rider.y, z: rider.z,
      yaw: (rider.yaw || 0) + Math.PI / 2,
      w: MINECART_MODEL.w, h: MINECART_MODEL.h,
      age: rider.age || 0, animPhase: 0, animSpeed: 0, onGround: false,
    };
    for (const part of MINECART_MODEL.parts) pushBox(out, cart, part, world, 0, light);
  }

  function pushShadow(out, e, world) {
    let groundY = null;
    const minY = Math.max(0, Math.floor(e.y) - 4);
    for (let y = Math.floor(e.y); y >= minY; y--) {
      if (Blocks.isSolid(world.getBlock(Math.floor(e.x), y, Math.floor(e.z)))) {
        groundY = y + 1;
        break;
      }
    }
    if (groundY === null) return;
    const gap = Math.max(0, e.y - groundY);
    if (gap > 3) return;
    const radius = Math.max(0.12, e.w * (0.72 - Math.min(gap, 1.5) * 0.22));
    if (!shadowUV) {
      const uv = Textures.uv('entity_shadow');
      shadowUV = [[uv[0], uv[3]], [uv[2], uv[3]], [uv[2], uv[1]], [uv[0], uv[1]]];
    }
    const y = groundY + 0.006;
    const light = 1 - Math.min(gap / 3, 0.7);
    const depth = radius * 0.72;
    const base = out.n;
    out.verts.push(e.x - radius, y, e.z + depth, shadowUV[0][0], shadowUV[0][1], light, 0);
    out.verts.push(e.x + radius, y, e.z + depth, shadowUV[1][0], shadowUV[1][1], light, 0);
    out.verts.push(e.x + radius, y, e.z - depth, shadowUV[2][0], shadowUV[2][1], light, 0);
    out.verts.push(e.x - radius, y, e.z - depth, shadowUV[3][0], shadowUV[3][1], light, 0);
    out.inds.push(base, base + 1, base + 2, base, base + 2, base + 3);
    out.n += 4;
  }

  function pushEmbeddedArrows(out, e, light) {
    const count = U.clamp(e.embeddedArrows | 0, 0, 4);
    if (!count) return;
    const uv = Textures.uv('arrow');
    const sky = light ? light[0] : 1, blk = light ? light[1] : 0;
    const seed = String(e.id === undefined ? e.kind : e.id);
    let hash = 2166136261;
    for (let i = 0; i < seed.length; i++) hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619);
    for (let index = 0; index < count; index++) {
      const phase = ((hash >>> (index * 5)) & 31) / 31 * Math.PI * 2 + index * 1.7;
      const height = e.y + e.h * (0.32 + (((hash >>> (index * 3 + 2)) & 7) / 7) * 0.45);
      const outward = Math.max(0.08, e.w * 0.42);
      const cx = e.x + Math.cos(phase) * outward, cz = e.z + Math.sin(phase) * outward;
      const alongX = Math.cos(phase) * 0.28, alongZ = Math.sin(phase) * 0.28;
      const sideX = -Math.sin(phase) * 0.055, sideZ = Math.cos(phase) * 0.055;
      const low = height - 0.13, high = height + 0.13;
      const points = [
        [cx - alongX - sideX, low, cz - alongZ - sideZ], [cx + alongX - sideX, low, cz + alongZ - sideZ],
        [cx + alongX + sideX, high, cz + alongZ + sideZ], [cx - alongX + sideX, high, cz - alongZ + sideZ],
      ];
      let base = out.n;
      const q = [[uv[0],uv[3]],[uv[2],uv[3]],[uv[2],uv[1]],[uv[0],uv[1]]];
      for (let k = 0; k < 4; k++) out.verts.push(points[k][0], points[k][1], points[k][2], q[k][0], q[k][1], sky, blk);
      out.inds.push(base, base + 1, base + 2, base, base + 2, base + 3); out.n += 4;
      base = out.n;
      for (let k = 3; k >= 0; k--) out.verts.push(points[k][0], points[k][1], points[k][2], q[3 - k][0], q[3 - k][1], sky * 0.82, blk * 0.82);
      out.inds.push(base, base + 1, base + 2, base, base + 2, base + 3); out.n += 4;
    }
  }

  function pushItemSprite(out, e, world) {
    const bob = Math.sin(e.age * 2.5) * 0.08 + 0.15;
    const yaw = e.age * 1.2;
    let sky = world.getSky(Math.floor(e.x), Math.floor(e.y + 0.3), Math.floor(e.z)) / 15;
    let blk = world.getBlkLight(Math.floor(e.x), Math.floor(e.y + 0.3), Math.floor(e.z)) / 15;
    const it = Items.get(e.itemId);
    if (!it) return;
    const groundScale = it.display && it.display.ground ? (it.display.ground.scale || 1) : 1;
    if (it.block) {
      const def = Blocks.get(e.itemId);
      const s = 0.14 * groundScale;
      const cyaw = Math.cos(yaw), syaw = Math.sin(yaw);
      const corners = BOX_CORNERS;
      for (let i = 0; i < 8; i++) {
        let lx = (i & 1 ? s : -s), ly = (i & 2 ? s * 2 : 0), lz = (i & 4 ? s : -s);
        const wx2 = lx * cyaw - lz * syaw, wz2 = lx * syaw + lz * cyaw;
        const ci = i * 3;
        corners[ci] = e.x + wx2;
        corners[ci + 1] = e.y + bob + ly;
        corners[ci + 2] = e.z + wz2;
      }
      const tiles = blockItemTiles(e.itemId);
      for (const face of ITEM_BOX_FACES) {
        pushTexturedFace(out, corners, face, Textures.uv(tiles[face.key]), sky, blk, face.shade);
      }
    } else {
      const s = 0.22 * groundScale;
      const cyaw = Math.cos(yaw), syaw = Math.sin(yaw);
      pushExtrudedItem(out, it.tex || 'stick', (x, y, z) => {
        x *= s; y *= s; z *= s;
        return [e.x + x * cyaw - z * syaw, e.y + bob + s + y, e.z + x * syaw + z * cyaw];
      }, sky, blk);
    }
  }

  function pushExperienceOrb(out, e, camX, camZ) {
    const size = 0.15;
    const centerY = e.y + 0.23 + Math.sin(e.age * 3) * 0.04;
    const dx = camX - e.x, dz = camZ - e.z;
    const length = Math.hypot(dx, dz) || 1;
    const rx = dz / length * size, rz = -dx / length * size;
    const uv = Textures.uv('xp_orb');
    const q = [[uv[0],uv[3]],[uv[2],uv[3]],[uv[2],uv[1]],[uv[0],uv[1]]];
    const points = [
      [e.x - rx, centerY - size, e.z - rz], [e.x + rx, centerY - size, e.z + rz],
      [e.x + rx, centerY + size, e.z + rz], [e.x - rx, centerY + size, e.z - rz],
    ];
    let base = out.n;
    for (let i = 0; i < 4; i++) out.verts.push(points[i][0], points[i][1], points[i][2], q[i][0], q[i][1], 1, 1);
    out.inds.push(base, base + 1, base + 2, base, base + 2, base + 3); out.n += 4;
    base = out.n;
    for (let i = 3; i >= 0; i--) out.verts.push(points[i][0], points[i][1], points[i][2], q[3 - i][0], q[3 - i][1], 1, 1);
    out.inds.push(base, base + 1, base + 2, base, base + 2, base + 3); out.n += 4;
  }

  function pushRemoteHeldItem(out, e, world, light, offhand) {
    const id = offhand ? e.offhand : e.held;
    const item = Items.get(id);
    if (!item) return;
    const tile = item.tex || (item.block && (() => {
      const tex = Blocks.get(id).tex;
      return tex.icon || tex.all || tex.front || tex.side || tex.top;
    })()) || 'stick';
    const heldKind = item.tool ? (item.tool.type === 'sword' ? 'sword' : 'tool')
      : id === Items.IT.BOW ? 'bow'
      : item.shield ? 'shield'
      : item.food ? 'food'
      : id === Blocks.ID.TORCH ? 'torch'
      : item.block ? 'block' : 'item';
    const display = item.display && item.display.thirdPerson ? item.display.thirdPerson : null;
    const offhandItem = e.offhand ? Items.get(e.offhand) : null;
    const shieldUsesOffhand = !!(offhandItem && offhandItem.shield);
    const guard = item.shield && (!!offhand === shieldUsesOffhand)
      ? U.clamp(e.blockBlend === undefined ? (e.blocking ? 1 : 0) : e.blockBlend, 0, 1) : 0;
    const right = !offhand;
    const side = right ? 1 : -1;
    const swing = remotePlayerArmSwing(e, right);
    const handX = side * U.lerp(0.375, 0.10, guard);
    const handY = 1.5 - Math.cos(swing) * 0.72;
    const handZ = -Math.sin(swing) * 0.72;
    const offset = display && display.offset ? display.offset : [0, 0.19, -0.025];
    const rotation = display && display.rotation ? display.rotation : [0, 0, 0];
    let centerX = handX + offset[0] * side + side * U.lerp(0, -0.05, guard);
    let centerY = handY + U.lerp(offset[1], Math.min(offset[1], 0.13), guard);
    let centerZ = handZ + offset[2];
    let half = display && Number.isFinite(display.scale) ? display.scale
      : { sword:0.38, tool:0.36, bow:0.38, shield:0.43, food:0.24, torch:0.31, item:0.25, block:0.20 }[heldKind];
    let angle = Number.isFinite(rotation[2]) ? rotation[2]
      : { sword:-0.58, tool:-0.48, bow:0.08, shield:-0.12, food:-0.18, torch:-0.10, item:0.02, block:0.10 }[heldKind];
    angle *= side;
    if (heldKind === 'shield' && guard > 0) { centerX += side * -0.17; centerY += 0.18; centerZ -= 0.20; angle = side * -0.04; }
    if (!offhand && heldKind === 'bow' && e.action === 'bow') { centerX -= 0.16; centerY += 0.18; centerZ -= 0.28; angle = -0.05; }
    if (!offhand && heldKind === 'food' && e.action === 'eat') { centerX -= 0.13; centerY += 0.28; centerZ -= 0.22; half *= 0.9; }
    angle = U.lerp(angle, side * -0.34, guard);
    const armFollow = heldKind === 'food' ? 0.72 : heldKind === 'bow' ? 0.82 : 1;
    const itemRotation = [(Number(rotation[0]) || 0) + swing * armFollow,
      (Number(rotation[1]) || 0) * side, angle];
    const grip = display && display.grip ? display.grip : null;
    if (grip) {
      const gripPoint = rotateItemPoint(grip[0] * half * side, grip[1] * half, grip[2] * half, itemRotation);
      centerX -= gripPoint[0]; centerY -= gripPoint[1]; centerZ -= gripPoint[2];
    }
    const cyaw = Math.cos(e.yaw), syaw = Math.sin(e.yaw);
    const sky = light ? light[0] : world.getSky(Math.floor(e.x), Math.floor(e.y + 1), Math.floor(e.z)) / 15;
    const blk = light ? light[1] : world.getBlkLight(Math.floor(e.x), Math.floor(e.y + 1), Math.floor(e.z)) / 15;
    if ((display && display.model === 'block') || heldKind === 'block') {
      const corners = HELD_CORNERS;
      const radius = half * 0.9;
      for (let i = 0; i < 8; i++) {
        const point = rotateItemPoint(i & 1 ? radius : -radius, i & 2 ? radius : -radius,
          i & 4 ? radius : -radius, itemRotation);
        const lx = centerX + point[0], ly = centerY + point[1], lz = centerZ + point[2];
        corners[i * 3] = e.x + lx * cyaw - lz * syaw;
        corners[i * 3 + 1] = e.y + ly;
        corners[i * 3 + 2] = e.z + lx * syaw + lz * cyaw;
      }
      const tiles = blockItemTiles(id);
      for (const face of ITEM_BOX_FACES) {
        pushTexturedFace(out, corners, face, Textures.uv(tiles[face.key]), sky, blk, face.shade);
      }
      return;
    }
    pushExtrudedItem(out, tile, (x, y, z) => {
      const point = rotateItemPoint(x * half, y * half, z * half, itemRotation);
      const lx = centerX + point[0], ly = centerY + point[1], lz = centerZ + point[2];
      return [e.x + lx * cyaw - lz * syaw, e.y + ly, e.z + lx * syaw + lz * cyaw];
    }, sky, blk);
  }

  function pushTNTBox(out, e, world) {
    const s = 0.49;
    const corners = BOX_CORNERS;
    for (let i = 0; i < 8; i++) {
      const ci = i * 3;
      corners[ci] = e.x + (i & 1 ? s : -s);
      corners[ci + 1] = e.y + (i & 2 ? s * 2 : 0);
      corners[ci + 2] = e.z + (i & 4 ? s : -s);
    }
    let sky = 1.0, blk = 1.0;
    if (Math.floor(e.age * 6) % 2 === 0) { sky = 2.5; blk = 2.5; }
    for (const face of TNT_BOX_FACES) {
      pushTexturedFace(out, corners, face, Textures.uv(face.tile), sky, blk, 1);
    }
  }

  function buildGeometry(world, camX, camY, camZ) {
    const normal = GEOM_WORK.normal, flash = GEOM_WORK.flash;
    const charge = GEOM_WORK.charge, glint = GEOM_WORK.glint, shadow = GEOM_WORK.shadow;
    resetWork(normal); resetWork(flash); resetWork(charge); resetWork(glint); resetWork(shadow);
    const drawEntity = (e) => {
      if (e.dead) return;
      const dist2 = U.dist2(e.x, e.y, e.z, camX, camY, camZ);
      if (dist2 > 80 * 80) return;
      if (e.type === 'mob') {
        e.model = entityModel(e) || e.model;
        if (dist2 > 72 * 72 || !e.model) return;
        if (dist2 < 48 * 48) pushShadow(shadow, e, world);
        const fuseFlash = e.kind === 'creeper' && e.fuseProgress > 0 &&
          (Math.floor(e.age * (4 + e.fuseProgress * 14)) & 1) === 0;
        const target = e.flash > 0 ? flash : fuseFlash ? charge : normal;
        const light = e._renderLight || (e._renderLight = [0, 0]);
        light[0] = world.getSky(Math.floor(e.x), Math.floor(e.y + e.h / 2), Math.floor(e.z)) / 15;
        light[1] = world.getBlkLight(Math.floor(e.x), Math.floor(e.y + e.h / 2), Math.floor(e.z)) / 15;
        for (const part of e.model.parts) {
          if (part.when === 'wool' && e.sheared) continue;
          if (part.when === 'sheared' && !e.sheared) continue;
          if (part.when === 'tamed' && !e.tamed) continue;
          if (part.when === 'fusing' && !(e.fuseProgress > 0)) continue;
          pushBox(target, e, part, world, 0, light);
        }
        pushEmbeddedArrows(normal, e, light);
        if (e.kind === 'skeleton') {
          e.held = Items.IT.BOW; e.action = 'bow'; e.actionPhase = 1;
          pushRemoteHeldItem(target, e, world, light);
        }
      } else if (e.type === 'xp') {
        pushExperienceOrb(normal, e, camX, camZ);
      } else if (e.type === 'item' || e.type === 'arrow' || e.type === 'egg' || e.type === 'ender_pearl') {
        pushItemSprite(normal, e, world);
      } else if (e.type === 'tnt') {
        pushTNTBox(normal, e, world);
      }
    };
    for (const e of list) {
      if (e.dead) continue;
      drawEntity(e);
    }
    const syncedEntities = networkEntityProvider ? networkEntityProvider() : null;
    if (syncedEntities) for (const e of syncedEntities) {
      if (!e || e.dead) continue;
      if (e.type === 'mob') {
        e.model = entityModel(e);
        if (e.model) {
          const scale = e.babyTime > 0 ? 0.55 : 1;
          e.w = e.model.w * scale; e.h = e.model.h * scale;
        }
      } else if ((e.type === 'arrow' || e.type === 'egg' || e.type === 'ender_pearl') && !e.itemId) {
        e.itemId = e.type === 'egg' ? Items.IT.EGG : e.type === 'ender_pearl' ? Items.IT.ENDER_PEARL : Items.IT.ARROW;
      }
      drawEntity(e);
    }
    const remotePlayers = remoteProvider ? remoteProvider() : null;
    if (remotePlayers) for (const e of remotePlayers) {
      if (!e || e.dead) continue;
      const dist2 = U.dist2(e.x, e.y, e.z, camX, camY, camZ);
      if (dist2 > 80 * 80) continue;
      e.model = remotePlayerModel(e);
      e.kind = 'player'; e.w = e.model.w; e.h = e.model.h;
      if (dist2 < 48 * 48) pushShadow(shadow, e, world);
      const light = e._renderLight || (e._renderLight = [0, 0]);
      light[0] = world.getSky(Math.floor(e.x), Math.floor(e.y + e.h / 2), Math.floor(e.z)) / 15;
      light[1] = world.getBlkLight(Math.floor(e.x), Math.floor(e.y + e.h / 2), Math.floor(e.z)) / 15;
      const ridingMinecart = e.riding === 'minecart';
      if (ridingMinecart) pushMinecart(normal, e, world, light);
      const renderPlayer = ridingMinecart ? Object.assign({}, e, {
        y: e.y + MINECART_RIDER_Y_OFFSET,
        animSpeed: 0,
      }) : e;
      for (const part of e.model.parts) pushBox(normal, renderPlayer, part, world, 0, light);
      pushRemoteArmor(normal, glint, renderPlayer, world, light);
      pushEmbeddedArrows(normal, renderPlayer, light);
      if (e.held) pushRemoteHeldItem(normal, renderPlayer, world, light, false);
      if (e.offhand) pushRemoteHeldItem(normal, renderPlayer, world, light, true);
    }
    return {
      normal: finalizeWork(normal, 'normal'),
      flash: finalizeWork(flash, 'flash'),
      charge: finalizeWork(charge, 'charge'),
      glint: finalizeWork(glint, 'glint'),
      shadow: finalizeWork(shadow, 'shadow'),
    };
  }

  function buildParticleGeometry(camYaw, camPitch) {
    // camera-facing quads
    const out = PARTICLE_WORK;
    resetWork(out);
    const cy = Math.cos(camYaw), sy = Math.sin(camYaw);
    const cp = Math.cos(camPitch || 0), sp = Math.sin(camPitch || 0);
    for (const p of particles) {
      if (p.life <= 0) continue;
      const s = p.size;
      const rx = cy * s, rz = sy * s;
      const ux = sy * sp * s, uy = cp * s, uz = -cy * sp * s;
      let uv;
      if (p.tile) {
        const base = Textures.uv(p.tile);
        const du = (base[2] - base[0]);
        const u0 = base[0] + du * (p.u0 || 0), v0 = base[1] + (base[3] - base[1]) * (p.v0 || 0);
        uv = [u0, v0, u0 + du * 0.25, v0 + (base[3] - base[1]) * 0.25];
      } else {
        uv = Textures.uv('__white');
      }
      const l = p.col ? p.col[0] : 1;
      const base2 = out.n;
      out.verts.push(p.x - rx - ux, p.y - uy, p.z - rz - uz, uv[0], uv[3], l, l);
      out.verts.push(p.x + rx - ux, p.y - uy, p.z + rz - uz, uv[2], uv[3], l, l);
      out.verts.push(p.x + rx + ux, p.y + uy, p.z + rz + uz, uv[2], uv[1], l, l);
      out.verts.push(p.x - rx + ux, p.y + uy, p.z - rz + uz, uv[0], uv[1], l, l);
      out.inds.push(base2, base2 + 1, base2 + 2, base2, base2 + 2, base2 + 3);
      out.n += 4;
    }
    return finalizeWork(out, 'particles');
  }

  function blockBreakParticles(x, y, z, tile) {
    for (let i = 0; i < particleCount(14); i++) {
      particles.push({
        x: x + R(), y: y + R(), z: z + R(),
        vx: (R() - 0.5) * 3, vy: R() * 3.5, vz: (R() - 0.5) * 3,
        life: 0.4 + R() * 0.4, tile, u0: R() * 0.75, v0: R() * 0.75,
        size: 0.07 + R() * 0.05, gravity: 1.5,
      });
    }
    particleVersion++;
  }

  function blockHitParticles(x, y, z, tile, face) {
    face = face || [0, 1, 0];
    for (let i = 0; i < particleCount(3); i++) {
      const inset = 0.035;
      const px = face[0] ? x + (face[0] > 0 ? 1 + inset : -inset) : x + 0.15 + R() * 0.7;
      const py = face[1] ? y + (face[1] > 0 ? 1 + inset : -inset) : y + 0.15 + R() * 0.7;
      const pz = face[2] ? z + (face[2] > 0 ? 1 + inset : -inset) : z + 0.15 + R() * 0.7;
      particles.push({
        x: px, y: py, z: pz,
        vx: face[0] * 0.7 + (R() - 0.5) * 0.7,
        vy: Math.max(0.2, face[1] * 0.7) + R() * 0.6,
        vz: face[2] * 0.7 + (R() - 0.5) * 0.7,
        life: 0.22 + R() * 0.16, tile, u0: R() * 0.75, v0: R() * 0.75,
        size: 0.045 + R() * 0.035, gravity: 1.2,
      });
    }
    particleVersion++;
  }

  function entityHitParticles(e, critical) {
    if (!e) return;
    const count = particleCount(critical ? 12 : 4);
    for (let i = 0; i < count; i++) {
      const a = R() * Math.PI * 2;
      const speed = (critical ? 1.5 : 0.8) + R() * 1.2;
      particles.push({
        x: e.x + (R() - 0.5) * e.w * 0.7,
        y: e.y + e.h * (0.28 + R() * 0.62),
        z: e.z + (R() - 0.5) * e.w * 0.7,
        vx: Math.cos(a) * speed,
        vy: 0.45 + R() * (critical ? 1.8 : 0.8),
        vz: Math.sin(a) * speed,
        life: 0.22 + R() * (critical ? 0.30 : 0.16),
        tile: critical ? 'glowstone' : '__white',
        u0: R() * 0.75, v0: R() * 0.75,
        size: critical ? 0.075 + R() * 0.05 : 0.045 + R() * 0.035,
        gravity: critical ? 0.55 : 0.9,
      });
    }
    particleVersion++;
  }

  function blockGuardParticles(player) {
    if (!player) return;
    const fx = Math.sin(player.yaw || 0), fz = -Math.cos(player.yaw || 0);
    const count = particleCount(7);
    for (let i = 0; i < count; i++) {
      particles.push({
        x: player.x + fx * 0.46 + (R() - 0.5) * 0.38,
        y: player.y + 0.72 + R() * 0.82,
        z: player.z + fz * 0.46 + (R() - 0.5) * 0.38,
        vx: fx * (0.35 + R()) + (R() - 0.5) * 0.8,
        vy: 0.35 + R() * 0.9,
        vz: fz * (0.35 + R()) + (R() - 0.5) * 0.8,
        life: 0.16 + R() * 0.18, tile: '__white', u0: R() * 0.75, v0: R() * 0.75,
        size: 0.04 + R() * 0.035, gravity: 1.1,
      });
    }
    particleVersion++;
  }

  function splashParticles(x, y, z, intensity) {
    intensity = U.clamp(intensity || 0, 0, 1);
    const count = particleCount(5 + Math.round(intensity * 9));
    for (let i = 0; i < count; i++) {
      const a = R() * Math.PI * 2;
      const speed = 0.45 + R() * (0.8 + intensity);
      particles.push({
        x: x + (R() - 0.5) * 0.8, y: y + R() * 0.18, z: z + (R() - 0.5) * 0.8,
        vx: Math.cos(a) * speed, vy: 0.35 + R() * (0.8 + intensity), vz: Math.sin(a) * speed,
        life: 0.20 + R() * 0.24, tile: 'water', u0: R() * 0.75, v0: R() * 0.75,
        size: 0.045 + R() * 0.045, gravity: 0.7,
      });
    }
    particleVersion++;
  }

  function weatherParticles(world, player, dt) {
    const rain = world.rainStrength || 0;
    if (rain < 0.08 || world.biomeAt(Math.floor(player.x), Math.floor(player.z)) === 'snow') return;
    const weatherRate = particleLevel === 2 ? 2 : particleLevel === 1 ? 6 : 11;
    weatherParticleCarry = Math.min(4, weatherParticleCarry + dt * rain * weatherRate);
    while (weatherParticleCarry >= 1) {
      weatherParticleCarry--;
      const angle = R() * Math.PI * 2;
      const radius = Math.sqrt(R()) * 7;
      const x = Math.floor(player.x + Math.cos(angle) * radius);
      const z = Math.floor(player.z + Math.sin(angle) * radius);
      let y = Math.min(World.CH_H - 2, Math.floor(player.y + 10));
      const minY = Math.max(1, Math.floor(player.y - 8));
      let id = world.getBlock(x, y, z);
      while (y > minY && !Blocks.get(id).solid && !Blocks.get(id).liquid) {
        id = world.getBlock(x, --y, z);
      }
      const ground = Blocks.get(id);
      if (y <= minY || (!ground.solid && !ground.liquid) || world.getSky(x, y + 1, z) < 14) continue;
      const top = ground.collision ? ground.collision.y + ground.collision.h : 1;
      particles.push({
        x: x + 0.15 + R() * 0.7, y: y + top + 0.025, z: z + 0.15 + R() * 0.7,
        vx: (R() - 0.5) * 0.22, vy: 0.18 + R() * 0.22, vz: (R() - 0.5) * 0.22,
        life: 0.16 + R() * 0.16, tile: 'water', u0: R() * 0.75, v0: R() * 0.75,
        size: 0.035 + R() * 0.03, gravity: 0.45,
      });
    }
  }

  function ambientBlockParticles(world, player) {
    const width = 17, height = 13, total = width * width * height;
    const budget = particleLevel === 2 ? 32 : particleLevel === 1 ? 48 : 64;
    const baseX = Math.floor(player.x), baseY = Math.floor(player.y), baseZ = Math.floor(player.z);
    if (!ambientScanCenter || Math.abs(baseX - ambientScanCenter.x) > 4 || Math.abs(baseY - ambientScanCenter.y) > 3 || Math.abs(baseZ - ambientScanCenter.z) > 4) {
      ambientScanCenter = { x: baseX, y: baseY, z: baseZ };
      ambientScanCursor = 0;
      ambientTorches.clear();
    }
    let changed = false;
    for (let sample = 0; sample < budget; sample++) {
      const cursor = ambientScanCursor++ % total;
      const dx = cursor % width - 8;
      const dz = Math.floor(cursor / width) % width - 8;
      const dy = AMBIENT_Y_ORDER[Math.floor(cursor / (width * width))];
      const x = baseX + dx, y = baseY + dy, z = baseZ + dz;
      const key = x + ',' + y + ',' + z;
      if (world.getBlock(x, y, z) === Blocks.ID.TORCH) {
        const existing = ambientTorches.get(key);
        if (existing) existing.state = world.getState(x, y, z) | 0;
        else ambientTorches.set(key, { x, y, z, state: world.getState(x, y, z) | 0, nextAt: world.time });
      } else {
        ambientTorches.delete(key);
      }
    }
    const now = Number(world.time) || 0;
    const interval = particleLevel === 2 ? 1.35 : particleLevel === 1 ? 0.75 : 0.42;
    for (const [key, torch] of ambientTorches) {
      if (Math.abs(torch.x - baseX) > 9 || Math.abs(torch.y - baseY) > 7 || Math.abs(torch.z - baseZ) > 9 ||
          world.getBlock(torch.x, torch.y, torch.z) !== Blocks.ID.TORCH) {
        ambientTorches.delete(key);
        continue;
      }
      if (now < torch.nextAt) continue;
      torch.nextAt = now + interval * (0.8 + R() * 0.4);
      const x = torch.x, y = torch.y, z = torch.z;
      const state = torch.state;
      const tip = Blocks.torchPose(state).top;
      particles.push({
        x: x + tip[0], y: y + tip[1] + 0.025, z: z + tip[2],
        vx: (R() - 0.5) * 0.08, vy: 0.18 + R() * 0.12, vz: (R() - 0.5) * 0.08,
        life: 0.38 + R() * 0.24, tile: 'fire', u0: R() * 0.75, v0: R() * 0.75,
        size: 0.035 + R() * 0.025, gravity: -0.08,
      });
      changed = true;
    }
    if (changed) particleVersion++;
  }

  function raycastEntity(ox, oy, oz, dx, dy, dz, maxDist, filter) {
    let best = null, bestT = maxDist;
    const ex = ox + dx * maxDist, ez = oz + dz * maxDist;
    const candidates = queryBox(Math.min(ox, ex) - 1.5, Math.min(oz, ez) - 1.5,
      Math.max(ox, ex) + 1.5, Math.max(oz, ez) + 1.5, RAY_QUERY_WORK);
    for (const e of candidates) {
      if (e.dead || e.type === 'item' || e.type === 'xp') continue;
      if (filter && !filter(e)) continue;
      const b = U.entityBox(e.x, e.y, e.z, e.w, e.h);
      const t = rayAABB(ox, oy, oz, dx, dy, dz, b);
      if (t !== null && t < bestT) { bestT = t; best = e; }
    }
    return best ? { entity: best, dist: bestT } : null;
  }
  function rayAABB(ox, oy, oz, dx, dy, dz, b) {
    let tmin = 0, tmax = Infinity;
    const p = [ox, oy, oz], d = [dx, dy, dz];
    const mn = [b.x, b.y, b.z], mx = [b.x + b.w, b.y + b.h, b.z + b.d];
    for (let i = 0; i < 3; i++) {
      if (Math.abs(d[i]) < 1e-9) {
        if (p[i] < mn[i] || p[i] > mx[i]) return null;
      } else {
        let t1 = (mn[i] - p[i]) / d[i], t2 = (mx[i] - p[i]) / d[i];
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
        tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
        if (tmin > tmax) return null;
      }
    }
    return tmin;
  }

  window.Entities = {
    list, particles,
    spawnItem, spawnXP, spawnArrow, spawnEgg, spawnEnderPearl, spawnTNT, spawnMob, explode, hurtMob, shearSheep, feedAnimal, showLove: loveParticles, dropBE,
    update, buildGeometry, buildParticleGeometry, blockBreakParticles, blockHitParticles, entityHitParticles, blockGuardParticles, splashParticles,
    raycastEntity, queryBox,
    onPickup: null,      // (itemId, count, durability, enchantments, customName) => leftover
    onMobAttack: null,   // (mob, dmg)
    onMobKilled: null,   // (mob)
    onXP: null,          // (points)
    onExplosion: null,   // (x,y,z,power) — player damage
    setSeed(seed, state) { rng = new U.RNG(seed >>> 0); if (state !== undefined) rng.setState(state); },
    setRngState(state) { if (state !== undefined) rng.setState(state); },
    getRngState() { return rng.getState(); },
    setParticleLevel(level) { particleLevel = U.clamp(level | 0, 0, 2); },
    particleLevel() { return particleLevel; },
    setRemoteProvider(provider) { remoteProvider = typeof provider === 'function' ? provider : null; geometryVersion++; },
    setNetworkEntityProvider(provider) { networkEntityProvider = typeof provider === 'function' ? provider : null; geometryVersion++; },
    setMobSpawning(enabled) { mobSpawningEnabled = !!enabled; },
    setModelProfile,
    modelProfile() { return activeModelProfile; },
    modelStats(kind) {
      const model = kind === 'player' ? remotePlayerModel({ skin:'steve', modelType:'classic' }) : modelForKind(kind);
      return model ? {
        profile:activeModelProfile, kind, w:model.w, h:model.h, parts:model.parts.length,
        sizes:model.parts.map(part => part.s.slice()),
        centers:model.parts.map(part => part.c.slice()),
        textures:model.parts.map(part => Object.assign({}, part.tex)),
        headPivot:model.headPivot ? model.headPivot.slice() : null,
      } : null;
    },
    renderVersion() { return geometryVersion; },
    particleRenderVersion() { return particleVersion; },
    refreshTextureAtlas() {
      const pack = Textures.currentPack ? Textures.currentPack() : 'default';
      const modelChanged = setModelProfile(pack === 'original_1_12' ? 'original' : 'default');
      PART_CACHE = new WeakMap();
      prewarmResult = null;
      ITEM_SPRITE_CACHE.clear();
      if (!modelChanged) geometryVersion++;
      particleVersion++;
    },
    prewarmGeometry,
    clear() {
      list.length = 0; particles.length = 0; spatial.clear(); nextId = 1; weatherParticleCarry = 0;
      villageLifeClock = 0; villageRaidClock = 0; ambientScanCursor = 0; ambientScanCenter = null; ambientTorches.clear(); geometryVersion++; particleVersion++;
    },
    serialize() {
      return list.filter(e => !e.dead && (e.type === 'mob' || e.type === 'item' || e.type === 'arrow' || e.type === 'egg' || e.type === 'ender_pearl' || e.type === 'tnt')).map(e => ({
        t: e.type, k: e.kind, x: +e.x.toFixed(2), y: +e.y.toFixed(2), z: +e.z.toFixed(2),
        vx: e.vx ? +e.vx.toFixed(2) : 0, vy: e.vy ? +e.vy.toFixed(2) : 0, vz: e.vz ? +e.vz.toFixed(2) : 0,
        id: e.itemId, n: e.count, hp: e.hp, dur: e.dur, ench: e.ench, nm: e.customName,
        dmg: e.damage, fuse: e.fuse,
        arrows: e.embeddedArrows || 0,
        sh: e.sheared ? 1 : 0, wr: e.woolRegrow ? +e.woolRegrow.toFixed(1) : 0,
        bt: e.babyTime ? +e.babyTime.toFixed(1) : 0, bc: e.breedCooldown ? +e.breedCooldown.toFixed(1) : 0,
        egg: e.eggTimer ? +e.eggTimer.toFixed(1) : 0,
        village: e.villageId, profession: e.profession, home: e.home, job: e.jobSite, meeting: e.meeting,
        tradeLevel: e.tradeLevel, tradeUses: e.tradeUses, restockAt: e.restockAt,
      }));
    },
    deserialize(arr) {
      this.clear();
      if (!arr) return;
      for (const d of arr) {
        if (d.t === 'mob' && MODELS[d.k]) {
          const m = spawnMob(d.k, d.x, d.y, d.z);
          if (m && d.hp) m.hp = d.hp;
          if (m) {
            m.vx = d.vx || 0; m.vy = d.vy || 0; m.vz = d.vz || 0;
            if (d.fuse !== undefined) {
              m.fuse = d.fuse;
              if (m.kind === 'creeper' && m.fuse >= 0) m.fuseProgress = U.clamp(1 - m.fuse / 1.5, 0, 1);
            }
            m.sheared = !!d.sh;
            m.woolRegrow = d.wr || 0;
            m.babyTime = d.bt || 0;
            m.breedCooldown = d.bc || 0;
            m.embeddedArrows = U.clamp(d.arrows | 0, 0, 4);
            if (m.babyTime > 0) { m.w = m.model.w * 0.55; m.h = m.model.h * 0.55; }
            if (m.kind === 'chicken' && d.egg) m.eggTimer = d.egg;
            if (m.kind === 'villager' || m.kind === 'cat' || m.kind === 'iron_golem') {
              m.villageId = d.village || null; m.profession = d.profession || 'unemployed';
              m.home = d.home || null; m.jobSite = d.job || null; m.meeting = d.meeting || null;
              m.tradeLevel = d.tradeLevel || 1; m.tradeUses = d.tradeUses || 0; m.restockAt = d.restockAt || 0;
              m.model = entityModel(m) || m.model;
            }
          }
        } else if (d.t === 'item' && Items.get(d.id)) {
          spawnItem(d.x, d.y, d.z, d.id, d.n || 1, d.vx || 0, d.vy || 0, d.vz || 0,
            { dur: d.dur, ench: d.ench, name: d.nm });
        } else if (d.t === 'arrow') {
          spawnArrow(d.x, d.y, d.z, d.vx || 0, d.vy || 0, d.vz || 0, d.dmg || 2);
        } else if (d.t === 'egg') {
          spawnEgg(d.x, d.y, d.z, d.vx || 0, d.vy || 0, d.vz || 0);
        } else if (d.t === 'ender_pearl') {
          spawnEnderPearl(d.x, d.y, d.z, d.vx || 0, d.vy || 0, d.vz || 0);
        } else if (d.t === 'tnt') {
          const e = spawnTNT(null, d.x - 0.5, d.y, d.z - 0.5, d.fuse !== undefined ? d.fuse : 4);
          e.vx = d.vx || 0; e.vy = d.vy || 0; e.vz = d.vz || 0;
        }
      }
    },
    configureVillageMob, tradeOffer, recordVillagerTrade,
  };
})();
