/* world.js — chunks, terrain generation, lighting (sky+block BFS), raycast, ticks */
'use strict';
(function () {
  const CH_W = 16, CH_H = 256, SEC_H = 16, SEC_N = CH_H / SEC_H, SEA = 63;
  const NETHER_OFFSET = 200000, END_OFFSET = -200000, DIMENSION_RADIUS = 40000;
  const AIR = 0;
  const DIR_X = new Int8Array([1, -1, 0, 0, 0, 0]);
  const DIR_Y = new Int8Array([0, 0, 1, -1, 0, 0]);
  const DIR_Z = new Int8Array([0, 0, 0, 0, 1, -1]);
  const VILLAGE_REGION = 128;
  const VILLAGE_RADIUS = 48;
  const STRUCTURE_SALT = Object.freeze({
    village: 10387312,
    temple: 14357617,
    fortress: 30084232,
    stronghold: 0x5F3759DF,
  });
  const TREE_CHANCE = Object.freeze({
    forest: 1 / 28,
    plains: 1 / 768,
    swamp: 1 / 128,
    snow: 1 / 34,
  });
  const VILLAGE_TEMPLATES = Object.freeze({
    house_small: { w: 7, d: 7, beds: [[2, 2]], door: [3, 6] },
    house_large: { w: 9, d: 7, beds: [[2, 2], [6, 2]], door: [4, 6] },
    farm: { w: 9, d: 9, beds: [], door: [4, 8], job: { profession: 'farmer', block: 'CRAFTING', at: [7, 4] } },
    library: { w: 9, d: 7, beds: [[2, 2]], door: [4, 6], job: { profession: 'librarian', block: 'BOOKSHELF', at: [6, 2] } },
    smithy: { w: 9, d: 7, beds: [[2, 2]], door: [4, 6], job: { profession: 'toolsmith', block: 'ANVIL', at: [6, 2] } },
    butcher: { w: 7, d: 7, beds: [[2, 2]], door: [3, 6], job: { profession: 'butcher', block: 'FURNACE', at: [4, 2] } },
    church: { w: 7, d: 9, beds: [[2, 2]], door: [3, 8], job: { profession: 'cleric', block: 'BREWING_STAND', at: [4, 3] } },
  });

  function idxOf(x, y, z) { return x | (z << 4) | (y << 8); }

  function rayBoxHit(ox, oy, oz, dx, dy, dz, x, y, z, shape, fallbackFace) {
    const mins = [x + shape.x, y + shape.y, z + shape.z];
    const maxs = [mins[0] + shape.w, mins[1] + shape.h, mins[2] + shape.d];
    const origins = [ox, oy, oz], dirs = [dx, dy, dz];
    let near = 0, far = Infinity, face = fallbackFace;
    for (let axis = 0; axis < 3; axis++) {
      const dir = dirs[axis];
      if (Math.abs(dir) < 1e-9) {
        if (origins[axis] < mins[axis] || origins[axis] > maxs[axis]) return null;
        continue;
      }
      let t1 = (mins[axis] - origins[axis]) / dir;
      let t2 = (maxs[axis] - origins[axis]) / dir;
      let sign = -1;
      if (t1 > t2) { const swap = t1; t1 = t2; t2 = swap; sign = 1; }
      if (t1 > near) {
        near = t1;
        face = [0, 0, 0];
        face[axis] = sign;
      }
      far = Math.min(far, t2);
      if (near > far) return null;
    }
    return far >= 0 ? { dist: Math.max(0, near), face } : null;
  }

  class LightQueue {
    constructor(capacity) {
      this.data = new Int32Array((capacity || 16384) * 4);
      this.head = 0;
      this.tail = 0;
    }
    reset() { this.head = 0; this.tail = 0; }
    push(x, y, z, value) {
      if (this.tail + 4 > this.data.length) {
        const grown = new Int32Array(this.data.length * 2);
        grown.set(this.data);
        this.data = grown;
      }
      const i = this.tail;
      this.data[i] = x; this.data[i + 1] = y; this.data[i + 2] = z; this.data[i + 3] = value || 0;
      this.tail += 4;
    }
  }

  class TickHeap {
    constructor() { this.a = []; }
    get length() { return this.a.length; }
    peek() { return this.a.length ? this.a[0] : null; }
    push(t) {
      const a = this.a;
      let i = a.length;
      a.push(t);
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (a[p].at <= t.at) break;
        a[i] = a[p]; i = p;
      }
      a[i] = t;
    }
    pop() {
      const a = this.a;
      if (!a.length) return null;
      const root = a[0];
      const last = a.pop();
      if (a.length) {
        let i = 0;
        while (true) {
          let c = i * 2 + 1;
          if (c >= a.length) break;
          if (c + 1 < a.length && a[c + 1].at < a[c].at) c++;
          if (a[c].at >= last.at) break;
          a[i] = a[c]; i = c;
        }
        a[i] = last;
      }
      return root;
    }
    clear() { this.a.length = 0; }
    load(items) { this.clear(); for (const t of items) this.push(t); }
    toArray() { return this.a.slice().sort((a, b) => a.at - b.at); }
  }

  class Chunk {
    constructor(cx, cz) {
      this.cx = cx; this.cz = cz;
      this.key = cx + ',' + cz;
      this.meshKeys = Array.from({ length: SEC_N }, (_, section) => this.key + ',' + section);
      this.blocks = new Uint8Array(CH_W * CH_W * CH_H);
      this.light = new Uint8Array(CH_W * CH_W * CH_H); // high nibble sky, low block
      this.dirtySections = new Set();
      this.modified = false;   // needs saving
      this.editVersion = 0;
      this.generated = false;
      this.maxSection = 0;
    }
    get(lx, y, lz) {
      if (y < 0) return Blocks.ID.BEDROCK;
      if (y >= CH_H) return AIR;
      return this.blocks[idxOf(lx, y, lz)];
    }
    set(lx, y, lz, id) {
      if (y < 0 || y >= CH_H) return;
      this.blocks[idxOf(lx, y, lz)] = id;
    }
    getSky(i) { return this.light[i] >> 4; }
    getBlk(i) { return this.light[i] & 15; }
    setSky(i, v) { this.light[i] = (this.light[i] & 0x0F) | (v << 4); }
    setBlk(i, v) { this.light[i] = (this.light[i] & 0xF0) | v; }
  }

  class World {
    constructor(seed) {
      this.seed = seed >>> 0;
      this.chunks = new Map();       // "cx,cz" -> Chunk
      this._chunkColumns = new Map();// cx -> Map<cz, Chunk>, used by hot coordinate lookups
      this.be = new Map();           // "x,y,z" -> block entity
      this.blockEntityVersion = 0;
      this.activeFurnaces = new Set();// block-entity keys that currently need ticking
      this.states = new Map();       // sparse horizontal facing metadata (0..3)
      this.ticks = new TickHeap();    // min-heap of {at, x, y, z, type}
      this.time = 0;                 // seconds of game time (world clock)
      this.dayLen = 1200;            // 20-minute Java Edition day
      this.timeOfDay = 0.30;         // 0..1, 0.30 ~ morning
      this.weather = 'clear';
      this.weatherTimer = 180;
      this.rainStrength = 0;
      this.dragonDefeated = false;
      this.spawnedVillages = new Set();
      this._villagePlans = new Map();
      this._villagePlansById = new Map();
      this._pendingVillagePopulations = [];
      this._queuedVillagePopulations = new Set();
      this.savedChunks = {};         // "cx,cz" -> Uint8Array (from save)
      this.savedChunkRecords = {};   // compressed records decoded on first chunk load
      this.loadSavedChunk = null;
      this.savedChunkVersions = {};
      this.dirtyChunkKeys = new Set();
      this.persistedChunkKeys = new Set();
      this.meshDirty = new Map();     // "cx,cz,section" -> {key,ch,section}
      this.urgentMeshKeys = new Set(); // runtime edits that must be shown before background meshing
      this.meshDirtyVersion = 0;
      this.runtimeEditVersion = 0;
      this._batchDepth = 0;
      this._batchChanges = new Map();
      this._lightQueue = new LightQueue(16384);
      this._redstoneUpdating = false;
      this._redstonePending = null;
      this._redstoneOpened = new Set();
      this._pressurePlateUntil = new Map();
      this.rng = new U.RNG(this.seed ^ 0x51A7E123);
      const S = this.seed;
      this.nCont = Noise.fbm2(Noise.make2D(S ^ 0x1000), 5);
      this.nMtn = Noise.fbm2(Noise.make2D(S ^ 0x2000), 4);
      this.nDet = Noise.fbm2(Noise.make2D(S ^ 0x3000), 3);
      this.nTemp = Noise.fbm2(Noise.make2D(S ^ 0x4000), 3);
      this.nForest = Noise.fbm2(Noise.make2D(S ^ 0x5000), 3);
      this.nWet = Noise.fbm2(Noise.make2D(S ^ 0x5500), 3);
      this.nCaveA = Noise.make3D(S ^ 0x6000);
      this.nCaveB = Noise.make3D(S ^ 0x7000);
      this.nRiver = Noise.fbm2(Noise.make2D(S ^ 0x8000), 2);
      this.nRavine = Noise.fbm2(Noise.make2D(S ^ 0x9000), 2);
      this.nRavineY = Noise.fbm2(Noise.make2D(S ^ 0xA000), 2);
      this._hcache = new Map();
      this._strongholdChunks = null;
      this.onChunkLight = null;      // cb(chunk) when light touched (mark remesh)
    }

    key(cx, cz) { return cx + ',' + cz; }
    chunkAt(cx, cz) {
      const column = this._chunkColumns.get(cx);
      return column ? (column.get(cz) || null) : null;
    }
    chunkOf(x, z) { return this.chunkAt(x >> 4, z >> 4); }
    _storeChunk(ch) {
      let column = this._chunkColumns.get(ch.cx);
      if (!column) { column = new Map(); this._chunkColumns.set(ch.cx, column); }
      column.set(ch.cz, ch);
      this.chunks.set(ch.key, ch);
    }
    removeChunk(ch) {
      if (!ch) return false;
      const column = this._chunkColumns.get(ch.cx);
      if (column) {
        column.delete(ch.cz);
        if (column.size === 0) this._chunkColumns.delete(ch.cx);
      }
      return this.chunks.delete(ch.key);
    }
    random() { return this.rng.next(); }
    getRngState() { return this.rng.getState(); }
    setRngState(state) { if (state !== undefined) this.rng.setState(state); }

    _regionRandom(rx, rz, salt) {
      return Noise.javaRandom(Noise.javaStructureSeed(this.seed, rx, rz, salt));
    }
    _structureCandidate(cx, cz, spacing, separation, salt, triangular) {
      const rx = Math.floor(cx / spacing), rz = Math.floor(cz / spacing);
      const random = this._regionRandom(rx, rz, salt);
      const spread = Math.max(1, spacing - separation);
      const offset = () => triangular
        ? ((random.nextInt(spread) + random.nextInt(spread)) >> 1)
        : random.nextInt(spread);
      return cx === rx * spacing + offset() && cz === rz * spacing + offset();
    }

    markSectionDirty(ch, section) {
      if (!ch || section < 0 || section >= SEC_N) return;
      const meshKey = ch.meshKeys[section];
      if (ch.dirtySections.has(section) && this.meshDirty.has(meshKey)) return;
      ch.dirtySections.add(section);
      this.meshDirty.set(meshKey, { meshKey, key: ch.key, ch, section });
      this.meshDirtyVersion++;
    }
    markSectionUrgent(ch, section) {
      if (!ch || section < 0 || section >= SEC_N) return;
      this.markSectionDirty(ch, section);
      const meshKey = ch.meshKeys[section];
      if (!this.meshDirty.has(meshKey) || this.urgentMeshKeys.has(meshKey)) return;
      this.urgentMeshKeys.add(meshKey);
      this.meshDirtyVersion++;
    }
    markAllSectionsDirty(ch) {
      const maxSection = Math.min(SEC_N - 1, ch.maxSection === undefined ? SEC_N - 1 : ch.maxSection);
      for (let section = 0; section <= maxSection; section++) this.markSectionDirty(ch, section);
    }
    clearSectionDirty(ch, section) {
      if (!ch) return;
      ch.dirtySections.delete(section);
      this.meshDirty.delete(ch.meshKeys[section]);
      this.urgentMeshKeys.delete(ch.meshKeys[section]);
    }
    forgetChunkMeshes(ch) {
      if (!ch) return;
      for (let section = 0; section < SEC_N; section++) {
        this.meshDirty.delete(ch.meshKeys[section]);
        this.urgentMeshKeys.delete(ch.meshKeys[section]);
      }
      this.meshDirtyVersion++;
    }

    // ---------- terrain shape ----------
    dimensionAt(x, z) {
      if (Math.abs(x - NETHER_OFFSET) < DIMENSION_RADIUS) return 'nether';
      if (Math.abs(x - END_OFFSET) < DIMENSION_RADIUS) return 'end';
      return 'overworld';
    }
    dimensionLocalX(x) {
      const dimension = this.dimensionAt(x, 0);
      return dimension === 'nether' ? x - NETHER_OFFSET : dimension === 'end' ? x - END_OFFSET : x;
    }
    genHeight(x, z) {
      const dimension = this.dimensionAt(x, z);
      if (dimension === 'nether') return 31 + Math.round(this.nDet((x - NETHER_OFFSET) / 43, z / 43) * 5);
      if (dimension === 'end') {
        const lx = x - END_OFFSET;
        const radius = Math.hypot(lx, z);
        if (radius > 110 && U.posRand(this.seed ^ 0xE0D, x >> 3, 0, z >> 3) > 0.24) return 0;
        return U.clamp(Math.round(60 + this.nDet(lx / 48, z / 48) * 7 - Math.max(0, radius - 60) * 0.035), 44, 72);
      }
      const k = x + ',' + z;
      const c = this._hcache.get(k);
      if (c !== undefined) return c;
      const e = this.nCont(x / 280, z / 280);
      let h = 68 + e * 34;
      const m = this.nMtn(x / 190 + 7.3, z / 190 - 2.1);
      if (m > 0.25) h += (m - 0.25) * 105;
      h += this.nDet(x / 41, z / 41) * 4.5;
      const river = this.riverFactor(x, z);
      h = U.lerp(h, SEA - 2.5, river * 0.90);
      const H = U.clamp(Math.round(h), 5, CH_H - 12);
      if (this._hcache.size > 20000) this._hcache.clear();
      this._hcache.set(k, H);
      return H;
    }
    mtnFactor(x, z) { return this.nMtn(x / 190 + 7.3, z / 190 - 2.1); }
    riverFactor(x, z) {
      const d = Math.abs(this.nRiver(x / 180 + 11.7, z / 180 - 4.3));
      return 1 - U.clamp((d - 0.012) / 0.052, 0, 1);
    }
    tempAt(x, z) {
      return this.nTemp(x / 340, z / 340) - Math.max(0, this.genHeight(x, z) - 70) * 0.008;
    }
    biomeAt(x, z) {
      const dimension = this.dimensionAt(x, z);
      if (dimension !== 'overworld') return dimension;
      const H = this.genHeight(x, z);
      if (this.riverFactor(x, z) > 0.58 && H <= SEA + 1) return 'river';
      if (H < SEA - 1) return 'ocean';
      if (H <= SEA + 1) return 'beach';
      const t = this.tempAt(x, z);
      if (this.mtnFactor(x, z) > 0.5 && H > 90) return 'mountain';
      if (t > 0.42) return 'desert';
      if (t < -0.38) return 'snow';
      if (H <= SEA + 7 && t > -0.18 && this.nWet(x / 150 - 4.2, z / 150 + 6.8) > 0.24) return 'swamp';
      if (this.nForest(x / 130 + 3.7, z / 130 - 9.2) > 0.13) return 'forest';
      return 'plains';
    }
    ravineProfile(x, z) {
      const path = Math.abs(this.nRavine(x / 115 - 6.1, z / 115 + 13.4));
      if (path > 0.052) return null;
      return {
        path,
        center: 38 + this.nRavineY(x / 170 + 2.7, z / 170 - 8.2) * 13,
        half: 12 + U.posRand(this.seed ^ 0xA71E, x, 0, z) * 7,
      };
    }
    isCave(x, y, z, ravine) {
      if (y < 4) return false;
      const a = this.nCaveA(x / 27, y / 20, z / 27);
      const b = this.nCaveB(x / 27, y / 20, z / 27);
      if (a * a + b * b < 0.016) return true;
      ravine = ravine === undefined ? this.ravineProfile(x, z) : ravine;
      if (!ravine) return false;
      const vertical = Math.abs(y - ravine.center) / ravine.half;
      return vertical < 1 && ravine.path < 0.038 * (1 - vertical * vertical);
    }
    treeAt(x, z) {
      const b = this.biomeAt(x, z);
      const chance = TREE_CHANCE[b] || 0;
      if (!chance) return null;
      const r = U.posRand(this.seed ^ 0xABCD, x, 0, z);
      if (r >= chance) return null;

      // Keep the lowest deterministic candidate when neighboring trunks would touch.
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        if (dx === 0 && dz === 0) continue;
        const neighborBiome = this.biomeAt(x + dx, z + dz);
        const neighborChance = TREE_CHANCE[neighborBiome] || 0;
        if (!neighborChance) continue;
        const neighbor = U.posRand(this.seed ^ 0xABCD, x + dx, 0, z + dz);
        if (neighbor < neighborChance && neighbor < r) return null;
      }

      if (b === 'forest') {
        return U.posRand(this.seed ^ 0xA8CD, x, 0, z) < 0.2 ? 'spruce' : 'oak';
      }
      return b === 'snow' ? 'spruce' : 'oak';
    }

    _villagePalette(biome) {
      const ID = Blocks.ID;
      if (biome === 'desert') return {
        wall: ID.SANDSTONE, pillar: ID.SANDSTONE, floor: ID.SANDSTONE,
        roof: ID.STONE_SLAB, foundation: ID.SANDSTONE, path: ID.SANDSTONE,
      };
      if (biome === 'snow') return {
        wall: ID.PLANKS, pillar: ID.SPRUCE_LOG, floor: ID.PLANKS,
        roof: ID.PLANKS, foundation: ID.COBBLE, path: ID.GRAVEL,
      };
      return {
        wall: ID.PLANKS, pillar: ID.LOG, floor: ID.PLANKS,
        roof: ID.PLANKS, foundation: ID.COBBLE, path: ID.GRAVEL,
      };
    }

    villagePlanForRegion(rx, rz) {
      const key = rx + ',' + rz;
      if (this._villagePlans.has(key)) return this._villagePlans.get(key);
      const javaRandom = this._regionRandom(rx, rz, STRUCTURE_SALT.village);
      if (javaRandom.nextInt(5) !== 0) { this._villagePlans.set(key, null); return null; }
      const random = () => javaRandom.nextDouble();
      const margin = 32;
      const centerX = rx * VILLAGE_REGION + margin + Math.floor(random() * (VILLAGE_REGION - margin * 2));
      const centerZ = rz * VILLAGE_REGION + margin + Math.floor(random() * (VILLAGE_REGION - margin * 2));
      const biome = this.biomeAt(centerX, centerZ);
      if (!['plains', 'desert', 'snow'].includes(biome)) { this._villagePlans.set(key, null); return null; }
      const heights = [];
      for (const [dx, dz] of [[0,0],[-12,-12],[12,-12],[-12,12],[12,12],[-24,0],[24,0],[0,-24],[0,24]]) {
        heights.push(this.genHeight(centerX + dx, centerZ + dz));
      }
      const minHeight = Math.min(...heights), maxHeight = Math.max(...heights);
      if (minHeight <= SEA || maxHeight - minHeight > 8) { this._villagePlans.set(key, null); return null; }
      const plan = this._buildVillagePlan(rx, rz, centerX, centerZ, biome, random);
      this._villagePlans.set(key, plan);
      this._villagePlansById.set(plan.id, plan);
      return plan;
    }

    _villageTransform(building, u, v) {
      const info = VILLAGE_TEMPLATES[building.type];
      let dx = u - Math.floor(info.w / 2), dz = v - Math.floor(info.d / 2);
      const rotation = building.rotation & 3;
      if (rotation === 1) { const next = dx; dx = -dz; dz = next; }
      else if (rotation === 2) { dx = -dx; dz = -dz; }
      else if (rotation === 3) { const next = dx; dx = dz; dz = -next; }
      return { x: building.x + dx, z: building.z + dz };
    }

    _buildVillagePlan(rx, rz, centerX, centerZ, biome, random) {
      const palette = this._villagePalette(biome);
      const slots = [
        ['house_small', -13, -16, 3], ['farm', 13, -17, 1],
        ['library', -14, 14, 3], ['smithy', 14, 14, 1],
        ['house_large', -14, 31, 3], ['butcher', 14, 31, 1],
        ['church', -31, 14, 3],
      ];
      const buildings = [];
      for (let index = 0; index < slots.length; index++) {
        if (index >= 5 && random() < 0.28) continue;
        const slot = slots[index];
        const building = {
          id: 'b' + index, type: slot[0], x: centerX + slot[1], z: centerZ + slot[2], rotation: slot[3],
        };
        const info = VILLAGE_TEMPLATES[building.type];
        const samples = [];
        for (const [u, v] of [[0,0],[info.w-1,0],[0,info.d-1],[info.w-1,info.d-1],[(info.w-1)>>1,(info.d-1)>>1]]) {
          const point = this._villageTransform(building, u, v);
          samples.push(this.genHeight(point.x, point.z));
        }
        if (Math.max(...samples) - Math.min(...samples) > 6) continue;
        building.baseY = Math.max(...samples);
        buildings.push(building);
      }
      const centerY = Math.max(...[-2, 0, 2].flatMap(dx => [-2, 0, 2].map(dz => this.genHeight(centerX + dx, centerZ + dz))));
      const roads = [
        { x0: centerX - 38, x1: centerX + 38, z0: centerZ - 1, z1: centerZ + 1 },
        { x0: centerX - 1, x1: centerX + 1, z0: centerZ - 38, z1: centerZ + 38 },
      ];
      for (const building of buildings) {
        const info = VILLAGE_TEMPLATES[building.type];
        const door = this._villageTransform(building, info.door[0], info.door[1]);
        building.door = { x: door.x, y: building.baseY + 1, z: door.z };
        if (Math.abs(door.x - centerX) <= Math.abs(door.z - centerZ)) {
          roads.push({ x0: Math.min(door.x, centerX), x1: Math.max(door.x, centerX), z0: door.z, z1: door.z });
        } else {
          roads.push({ x0: door.x, x1: door.x, z0: Math.min(door.z, centerZ), z1: Math.max(door.z, centerZ) });
        }
      }
      const meeting = { x: centerX + 3, y: centerY + 1, z: centerZ, type: 'meeting', block: Blocks.ID.TORCH };
      const pois = [meeting];
      const beds = [], jobs = [];
      for (const building of buildings) {
        const info = VILLAGE_TEMPLATES[building.type];
        for (const at of info.beds) {
          const point = this._villageTransform(building, at[0], at[1]);
          const poi = { x: point.x, y: building.baseY + 1, z: point.z, type: 'home', building: building.id };
          beds.push(poi); pois.push(poi);
        }
        if (info.job) {
          const point = this._villageTransform(building, info.job.at[0], info.job.at[1]);
          const poi = {
            x: point.x, y: building.baseY + 1, z: point.z, type: 'job', profession: info.job.profession,
            block: Blocks.ID[info.job.block], building: building.id,
          };
          jobs.push(poi); pois.push(poi);
        }
      }
      const residents = beds.slice(0, 7).map((home, index) => {
        const job = jobs[index] || null;
        const building = buildings.find(candidate => candidate.id === home.building);
        const info = building ? VILLAGE_TEMPLATES[building.type] : null;
        const outside = building && info ? this._villageTransform(building, info.door[0], info.door[1] + 1) : null;
        return {
          x: outside ? outside.x + 0.5 : centerX + 0.5,
          y: building ? building.baseY + 1 : centerY + 1,
          z: outside ? outside.z + 0.5 : centerZ + 0.5,
          home, job, profession: job ? job.profession : 'unemployed',
        };
      });
      return {
        id: 'village:' + rx + ':' + rz, rx, rz, x: centerX, y: centerY, z: centerZ,
        biome, palette, radius: VILLAGE_RADIUS, buildings, roads, pois, beds, jobs, residents, meeting,
      };
    }

    villagePlansNearChunk(cx, cz) {
      const minX = cx * 16 - VILLAGE_RADIUS, maxX = cx * 16 + 15 + VILLAGE_RADIUS;
      const minZ = cz * 16 - VILLAGE_RADIUS, maxZ = cz * 16 + 15 + VILLAGE_RADIUS;
      const plans = [];
      for (let rx = Math.floor(minX / VILLAGE_REGION); rx <= Math.floor(maxX / VILLAGE_REGION); rx++) {
        for (let rz = Math.floor(minZ / VILLAGE_REGION); rz <= Math.floor(maxZ / VILLAGE_REGION); rz++) {
          const plan = this.villagePlanForRegion(rx, rz);
          if (plan && plan.x + plan.radius >= cx * 16 && plan.x - plan.radius <= cx * 16 + 15 &&
              plan.z + plan.radius >= cz * 16 && plan.z - plan.radius <= cz * 16 + 15) plans.push(plan);
        }
      }
      return plans;
    }

    villageById(id) {
      const key = String(id || '');
      const cached = this._villagePlansById.get(key);
      if (cached) return cached;
      const match = /^village:(-?\d+):(-?\d+)$/.exec(key);
      return match ? this.villagePlanForRegion(Number(match[1]), Number(match[2])) : null;
    }
    nearestVillage(x, z, radius) {
      radius = Math.max(1, Number(radius) || 64);
      let nearest = null, best = radius * radius;
      const rx0 = Math.floor((x - radius) / VILLAGE_REGION), rx1 = Math.floor((x + radius) / VILLAGE_REGION);
      const rz0 = Math.floor((z - radius) / VILLAGE_REGION), rz1 = Math.floor((z + radius) / VILLAGE_REGION);
      for (let rx = rx0; rx <= rx1; rx++) for (let rz = rz0; rz <= rz1; rz++) {
        const plan = this.villagePlanForRegion(rx, rz);
        if (!plan) continue;
        const distance = (plan.x - x) ** 2 + (plan.z - z) ** 2;
        if (distance < best) { best = distance; nearest = plan; }
      }
      return nearest;
    }

    takeVillagePopulations() {
      const pending = this._pendingVillagePopulations.splice(0);
      const out = [];
      for (const plan of pending) {
        this._queuedVillagePopulations.delete(plan.id);
        if (this.spawnedVillages.has(plan.id)) continue;
        this.spawnedVillages.add(plan.id);
        out.push(plan);
      }
      return out;
    }

    _villagePut(ch, x, y, z, id, state, blockEntity) {
      if (y < 1 || y >= CH_H || (x >> 4) !== ch.cx || (z >> 4) !== ch.cz) return;
      ch.blocks[idxOf(x & 15, y, z & 15)] = id;
      const key = this.beKey(x, y, z);
      if (state === undefined || state === null) this.states.delete(key);
      else this.states.set(key, state);
      if (blockEntity && !this.be.has(key)) this.setBE(x, y, z, blockEntity);
    }

    _villageFoundation(ch, plan, building, clearHeight) {
      const info = VILLAGE_TEMPLATES[building.type];
      for (let u = 0; u < info.w; u++) for (let v = 0; v < info.d; v++) {
        const point = this._villageTransform(building, u, v);
        const surface = this.genHeight(point.x, point.z);
        for (let y = Math.min(surface, building.baseY); y <= building.baseY; y++) {
          this._villagePut(ch, point.x, y, point.z, plan.palette.foundation);
        }
        for (let y = building.baseY + 1; y <= Math.max(building.baseY + clearHeight, surface + 2); y++) {
          this._villagePut(ch, point.x, y, point.z, AIR);
        }
      }
    }

    _villageLocalPut(ch, building, u, y, v, id, state, blockEntity) {
      const point = this._villageTransform(building, u, v);
      this._villagePut(ch, point.x, building.baseY + y, point.z, id, state, blockEntity);
    }

    _stampVillageRoads(ch, plan) {
      const chunkX0 = ch.cx * 16, chunkZ0 = ch.cz * 16;
      for (const road of plan.roads) {
        const x0 = Math.max(chunkX0, road.x0), x1 = Math.min(chunkX0 + 15, road.x1);
        const z0 = Math.max(chunkZ0, road.z0), z1 = Math.min(chunkZ0 + 15, road.z1);
        if (x0 > x1 || z0 > z1) continue;
        for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
          const surface = this.genHeight(x, z);
          const bridge = surface < SEA || this.biomeAt(x, z) === 'river';
          const y = bridge ? SEA + 1 : surface;
          this._villagePut(ch, x, y, z, bridge ? Blocks.ID.PLANKS : plan.palette.path);
          this._villagePut(ch, x, y + 1, z, AIR);
          this._villagePut(ch, x, y + 2, z, AIR);
          if (bridge && ((x + z) & 3) === 0) {
            for (let sy = Math.max(surface + 1, SEA - 4); sy < y; sy++) this._villagePut(ch, x, sy, z, plan.palette.pillar);
          }
        }
      }
    }

    _stampVillageMeeting(ch, plan) {
      const ID = Blocks.ID, y = plan.y;
      for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) {
        const x = plan.x + dx, z = plan.z + dz, surface = this.genHeight(x, z);
        for (let fy = Math.min(surface, y); fy <= y; fy++) this._villagePut(ch, x, fy, z, plan.palette.foundation);
        this._villagePut(ch, x, y, z, Math.abs(dx) <= 2 && Math.abs(dz) <= 2 ? ID.COBBLE : plan.palette.path);
        for (let clear = 1; clear <= 4; clear++) this._villagePut(ch, x, y + clear, z, AIR);
      }
      for (let dx = -1; dx <= 0; dx++) for (let dz = -1; dz <= 0; dz++) this._villagePut(ch, plan.x + dx, y + 1, plan.z + dz, ID.WATER);
      for (let dx = -2; dx <= 1; dx++) for (let dz = -2; dz <= 1; dz++) {
        const ring = dx === -2 || dx === 1 || dz === -2 || dz === 1;
        if (ring) this._villagePut(ch, plan.x + dx, y + 1, plan.z + dz, ID.COBBLE);
      }
      for (const [dx, dz] of [[-2,-2],[1,-2],[-2,1],[1,1]]) {
        for (let dy = 2; dy <= 4; dy++) this._villagePut(ch, plan.x + dx, y + dy, plan.z + dz, plan.palette.pillar);
      }
      for (let dx = -3; dx <= 2; dx++) for (let dz = -3; dz <= 2; dz++) this._villagePut(ch, plan.x + dx, y + 5, plan.z + dz, plan.palette.roof);
      this._villagePut(ch, plan.meeting.x, plan.meeting.y, plan.meeting.z, ID.TORCH);
    }

    _villageLoot(plan, building, kind) {
      const random = U.rng(U.hash32(this.seed + ':' + plan.id + ':' + building.id + ':' + kind));
      const slots = Array(27).fill(null);
      if (kind === 'smithy') {
        slots[0] = { id: Items.IT.IRON_INGOT, n: 2 + Math.floor(random() * 5) };
        slots[4] = { id: Items.IT.COAL, n: 2 + Math.floor(random() * 6) };
        if (random() < 0.35) slots[8] = { id: Items.IT.PICK_IRON, n: 1, dur: Items.durabilityOf(Items.IT.PICK_IRON) };
      } else if (kind === 'library') {
        slots[0] = { id: Items.IT.BOOK, n: 2 + Math.floor(random() * 4) };
        slots[3] = { id: Items.IT.PAPER, n: 3 + Math.floor(random() * 6) };
      } else {
        slots[0] = { id: Items.IT.BREAD, n: 1 + Math.floor(random() * 4) };
        slots[3] = { id: Items.IT.APPLE, n: 1 + Math.floor(random() * 3) };
      }
      return { type: 'chest', slots };
    }

    _stampVillageHouse(ch, plan, building) {
      const ID = Blocks.ID, info = VILLAGE_TEMPLATES[building.type];
      const height = building.type === 'church' ? 6 : 4;
      this._villageFoundation(ch, plan, building, height + 2);
      for (let u = 0; u < info.w; u++) for (let v = 0; v < info.d; v++) {
        this._villageLocalPut(ch, building, u, 0, v, plan.palette.floor);
        const boundary = u === 0 || v === 0 || u === info.w - 1 || v === info.d - 1;
        if (!boundary) continue;
        const corner = (u === 0 || u === info.w - 1) && (v === 0 || v === info.d - 1);
        for (let y = 1; y <= height - 1; y++) {
          const door = u === info.door[0] && v === info.door[1] && y <= 2;
          const window = y === 2 && !corner && ((u + v) % 3 === 0);
          this._villageLocalPut(ch, building, u, y, v, door ? AIR : window ? ID.GLASS : corner ? plan.palette.pillar : plan.palette.wall);
        }
      }
      this._villageLocalPut(ch, building, info.door[0], 1, info.door[1], ID.OAK_DOOR, building.rotation & 3);
      this._villageLocalPut(ch, building, info.door[0], 2, info.door[1], ID.OAK_DOOR_TOP, building.rotation & 3);
      for (let u = -1; u <= info.w; u++) for (let v = -1; v <= info.d; v++) {
        this._villageLocalPut(ch, building, u, height, v, plan.palette.roof);
      }
      for (const bed of info.beds) this._villageLocalPut(ch, building, bed[0], 1, bed[1], ID.BED, building.rotation & 3);
      this._villageLocalPut(ch, building, 1, 3, 1, ID.TORCH);
      if (info.job) this._villageLocalPut(ch, building, info.job.at[0], 1, info.job.at[1], ID[info.job.block], building.rotation & 3);
      if (building.type === 'library') {
        for (let u = 1; u < info.w - 1; u += 2) this._villageLocalPut(ch, building, u, 1, 1, ID.BOOKSHELF);
        this._villageLocalPut(ch, building, info.w - 2, 1, info.d - 2, ID.CHEST, null, this._villageLoot(plan, building, 'library'));
      } else if (building.type === 'smithy') {
        this._villageLocalPut(ch, building, 1, 1, info.d - 2, ID.FURNACE, 0, { type: 'furnace', slots: Array(3).fill(null), burn: 0, burnMax: 0, cook: 0 });
        this._villageLocalPut(ch, building, info.w - 2, 1, info.d - 2, ID.CHEST, null, this._villageLoot(plan, building, 'smithy'));
      } else if (building.type === 'church') {
        this._villageLocalPut(ch, building, 1, 1, 4, ID.BOOKSHELF);
      } else if (building.type === 'house_large') {
        this._villageLocalPut(ch, building, info.w - 2, 1, 1, ID.CHEST, null, this._villageLoot(plan, building, 'house'));
      }
      const outside = this._villageTransform(building, info.door[0], info.door[1] + 1);
      this._villagePut(ch, outside.x, building.baseY, outside.z, ID.OAK_STAIRS, building.rotation & 3);
    }

    _stampVillageFarm(ch, plan, building) {
      const ID = Blocks.ID, info = VILLAGE_TEMPLATES.farm;
      this._villageFoundation(ch, plan, building, 3);
      for (let u = 0; u < info.w; u++) for (let v = 0; v < info.d; v++) {
        const edge = u === 0 || v === 0 || u === info.w - 1 || v === info.d - 1;
        if (edge) {
          const gate = u === info.door[0] && v === info.door[1];
          this._villageLocalPut(ch, building, u, 1, v, gate ? ID.OAK_FENCE_GATE : ID.OAK_FENCE, building.rotation & 3);
          continue;
        }
        const water = u === 4;
        this._villageLocalPut(ch, building, u, 0, v, water ? ID.WATER : ID.FARMLAND, water ? null : 7);
        if (!water) {
          const stage = 3 + ((u * 7 + v * 3 + this.seed) & 4);
          this._villageLocalPut(ch, building, u, 1, v, ID.WHEAT_CROP, stage);
        }
      }
      this._villageLocalPut(ch, building, 7, 1, 4, ID.CRAFTING);
    }

    stampVillage(ch) {
      const plans = this.villagePlansNearChunk(ch.cx, ch.cz);
      for (const plan of plans) {
        this._stampVillageRoads(ch, plan);
        this._stampVillageMeeting(ch, plan);
        for (const building of plan.buildings) {
          if (building.type === 'farm') this._stampVillageFarm(ch, plan, building);
          else this._stampVillageHouse(ch, plan, building);
        }
        if ((plan.x >> 4) === ch.cx && (plan.z >> 4) === ch.cz &&
            !this.spawnedVillages.has(plan.id) && !this._queuedVillagePopulations.has(plan.id)) {
          this._queuedVillagePopulations.add(plan.id);
          this._pendingVillagePopulations.push(plan);
        }
      }
    }

    _generateNetherChunk(ch) {
      const ID = Blocks.ID;
      for (let lx = 0; lx < 16; lx++) for (let lz = 0; lz < 16; lz++) {
        const wx = ch.cx * 16 + lx, wz = ch.cz * 16 + lz;
        const localX = wx - NETHER_OFFSET;
        const floor = 29 + Math.round(this.nDet(localX / 43, wz / 43) * 6);
        const ceiling = 111 + Math.round(this.nMtn(localX / 57, wz / 57) * 9);
        for (let y = 0; y <= 127; y++) {
          let id = AIR;
          if (y === 0 || y === 127) id = ID.BEDROCK;
          else if (y <= floor || y >= ceiling) id = ID.NETHERRACK;
          else if (y <= 31) id = ID.LAVA;
          if (id === ID.NETHERRACK && y === floor && U.posRand(this.seed ^ 0x5015, wx, y, wz) < 0.12) id = ID.SOUL_SAND;
          if (id !== AIR) ch.blocks[idxOf(lx, y, lz)] = id;
        }
        if (U.posRand(this.seed ^ 0x6107, wx, 0, wz) < 0.012) {
          const gy = Math.max(floor + 8, ceiling - 2);
          for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
            if (lx + dx < 0 || lx + dx > 15 || lz + dz < 0 || lz + dz > 15) continue;
            if (Math.abs(dx) + Math.abs(dz) <= 1) ch.blocks[idxOf(lx + dx, gy, lz + dz)] = ID.GLOWSTONE;
          }
        }
      }
      this.stampNetherFortress(ch);
    }

    _generateEndChunk(ch) {
      const ID = Blocks.ID;
      for (let lx = 0; lx < 16; lx++) for (let lz = 0; lz < 16; lz++) {
        const wx = ch.cx * 16 + lx, wz = ch.cz * 16 + lz;
        const top = this.genHeight(wx, wz);
        if (!top) continue;
        const localX = wx - END_OFFSET;
        const radius = Math.hypot(localX, wz);
        const thickness = U.clamp(Math.round(8 + (100 - Math.min(100, radius)) * 0.08), 6, 17);
        for (let y = Math.max(1, top - thickness); y <= top; y++) ch.blocks[idxOf(lx, y, lz)] = ID.END_STONE;
      }
      const localChunkX = ch.cx - (END_OFFSET >> 4);
      if (localChunkX === 0 && ch.cz === 0) {
        for (let lx = 5; lx <= 10; lx++) for (let lz = 5; lz <= 10; lz++) ch.blocks[idxOf(lx, 62, lz)] = ID.OBSIDIAN;
      }
    }

    stampNetherFortress(ch) {
      const localCX = ch.cx - (NETHER_OFFSET >> 4);
      if (!this._structureCandidate(localCX, ch.cz, 16, 4, STRUCTURE_SALT.fortress, true)) return;
      const javaRandom = this._regionRandom(localCX, ch.cz, STRUCTURE_SALT.fortress + 1);
      const random = () => javaRandom.nextDouble();
      const ID = Blocks.ID;
      const y = 48 + Math.floor(random() * 28);
      for (let lx = 1; lx < 15; lx++) for (let lz = 5; lz <= 10; lz++) {
        ch.blocks[idxOf(lx, y, lz)] = ID.NETHER_BRICKS;
        if (lz === 5 || lz === 10) for (let dy = 1; dy <= 3; dy++) ch.blocks[idxOf(lx, y + dy, lz)] = ID.NETHER_BRICKS;
      }
      for (let lx = 1; lx < 15; lx++) for (let lz = 6; lz < 10; lz++) for (let dy = 1; dy <= 3; dy++) {
        ch.blocks[idxOf(lx, y + dy, lz)] = AIR;
      }
    }

    // ---------- chunk generation ----------
    ensureChunk(cx, cz) {
      let ch = this.chunkAt(cx, cz);
      if (ch && ch.generated) return ch;
      ch = new Chunk(cx, cz);
      this._storeChunk(ch);
      const ID = Blocks.ID;
      let saved = this.savedChunks[ch.key];
      if (!saved && this.loadSavedChunk) saved = this.loadSavedChunk(ch.key);
      if (saved) {
        ch.blocks.set(saved);
        ch.modified = false;
      } else {
        const dimension = this.dimensionAt(cx * 16 + 8, cz * 16 + 8);
        if (dimension === 'nether') {
          this._generateNetherChunk(ch);
        } else if (dimension === 'end') {
          this._generateEndChunk(ch);
        } else {
        // terrain
        for (let lx = 0; lx < 16; lx++) for (let lz = 0; lz < 16; lz++) {
          const wx = cx * 16 + lx, wz = cz * 16 + lz;
          const H = this.genHeight(wx, wz);
          const biome = this.biomeAt(wx, wz);
          const ravine = this.ravineProfile(wx, wz);
          for (let y = 0; y <= Math.max(H, SEA); y++) {
            let id = AIR;
            if (y === 0) id = ID.BEDROCK;
            else if (y <= H) {
              if (y > H - 1) { // top block
                if (biome === 'ocean') id = ID.SAND;
                else if (biome === 'river') {
                  const riverBlock = U.posRand(this.seed ^ 0xB17E, wx, y, wz);
                  id = riverBlock < 0.22 ? ID.CLAY : (riverBlock < 0.50 ? ID.GRAVEL : ID.SAND);
                }
                else if (biome === 'beach') id = ID.SAND;
                else if (biome === 'desert') id = ID.SAND;
                else if (biome === 'snow') id = ID.GRASS_SNOW;
                else if (biome === 'mountain') id = H > 120 ? ID.GRASS_SNOW : ID.STONE;
                else id = ID.GRASS;
              } else if (y > H - 4) {
                id = (biome === 'desert' || biome === 'beach' || biome === 'ocean' || biome === 'river') ? ID.SAND
                  : (biome === 'mountain' ? ID.STONE : ID.DIRT);
                if (biome === 'river' && U.posRand(this.seed ^ 0xC1A7, wx, y, wz) < 0.18) id = ID.CLAY;
                if (biome === 'desert' && y <= H - 2) id = ID.SANDSTONE;
              } else {
                id = ID.STONE;
                const r = U.posRand(this.seed ^ 0x0111, wx, y, wz);
                if (r > 0.994 && y < 64) id = ID.GRAVEL;
              }
              // caves
              if (id !== ID.BEDROCK && !(H < SEA && y > H - 8)) {
                if (this.isCave(wx, y, wz, ravine)) id = y <= 9 ? ID.LAVA : AIR;
              }
            } else if (y <= SEA && H < SEA) {
              id = ID.WATER;
            }
            if (id !== AIR) ch.blocks[idxOf(lx, y, lz)] = id;
          }
        }
        this.stampUndergroundLake(ch);
        this.stampOreVeins(ch);
        this.stampUndergroundDungeon(ch);
        // decorations (margin approach: deterministic per world column)
        for (let dx = -3; dx < 19; dx++) for (let dz = -3; dz < 19; dz++) {
          const wx = cx * 16 + dx, wz = cz * 16 + dz;
          const tree = this.treeAt(wx, wz);
          if (tree) this.stampTree(ch, wx, wz, tree);
          if (dx >= 0 && dx < 16 && dz >= 0 && dz < 16) {
            this.stampSmallDecor(ch, wx, wz, dx, dz);
          }
        }
        this.stampSurfaceStructure(ch);
        this.stampVillage(ch);
        this.stampMineshaft(ch);
        this.stampDesertTemple(ch);
        this.stampStronghold(ch);
        }
      }
      if (this.onChunkGenerated) this.onChunkGenerated(ch);
      for (let y = CH_H - 1; y >= 0; y--) {
        let found = false;
        for (let i = y << 8; i < (y + 1) << 8; i++) {
          if (ch.blocks[i] !== AIR) { found = true; break; }
        }
        if (found) { ch.maxSection = y >> 4; break; }
      }
      ch.generated = true;
      this.initSkylight(ch);
      this.initBlocklight(ch);
      // border light exchange with existing neighbors
      for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nb = this.chunkAt(cx + nx, cz + nz);
        if (nb && nb.generated) {
          this.exchangeBorderLight(ch, nb);
          this.markAllSectionsDirty(nb);
        }
      }
      this.markAllSectionsDirty(ch);
      return ch;
    }

    stampUndergroundLake(ch) {
      const roll = U.posRand(this.seed ^ 0x1A4E, ch.cx, 0, ch.cz);
      if (roll > 0.16) return false;
      const random = U.rng(U.hash32(this.seed + ':lake:' + ch.cx + ':' + ch.cz));
      const liquid = roll < 0.025 ? Blocks.ID.LAVA : Blocks.ID.WATER;
      for (let attempt = 0; attempt < 4; attempt++) {
        const cx = 5 + Math.floor(random() * 6);
        const cz = 5 + Math.floor(random() * 6);
        const wx = ch.cx * 16 + cx, wz = ch.cz * 16 + cz;
        const surface = this.genHeight(wx, wz);
        const cy = 12 + Math.floor(random() * Math.max(1, Math.min(34, surface - 22)));
        const rx = 3 + Math.floor(random() * 2), ry = 2 + Math.floor(random() * 2), rz = 3 + Math.floor(random() * 2);
        if (cy + ry + 5 >= surface) continue;
        let boundarySolid = 0, boundaryCount = 0;
        for (let x = cx - rx - 1; x <= cx + rx + 1; x++) for (let z = cz - rz - 1; z <= cz + rz + 1; z++) {
          const dx = (x - cx) / (rx + 0.65), dz = (z - cz) / (rz + 0.65);
          if (dx * dx + dz * dz > 1.15) continue;
          boundaryCount++;
          if (ch.blocks[idxOf(x, cy + ry + 1, z)] !== AIR) boundarySolid++;
        }
        if (!boundaryCount || boundarySolid / boundaryCount < 0.72) continue;
        for (let x = cx - rx; x <= cx + rx; x++) for (let z = cz - rz; z <= cz + rz; z++) {
          for (let y = cy - ry; y <= cy + ry; y++) {
            const dx = (x - cx) / (rx + 0.35), dy = (y - cy) / (ry + 0.35), dz = (z - cz) / (rz + 0.35);
            const wobble = (U.posRand(this.seed ^ 0x1A6E, wx + x, y, wz + z) - 0.5) * 0.16;
            if (dx * dx + dy * dy + dz * dz > 1 + wobble) continue;
            ch.blocks[idxOf(x, y, z)] = y <= cy - 1 ? liquid : AIR;
          }
        }
        return true;
      }
      return false;
    }

    stampOreVeins(ch) {
      const ID = Blocks.ID;
      const configs = [
        { id: ID.COAL_ORE, maxY: 128, count: 8, size: 17, radius: 1.55, salt: 0xC041 },
        { id: ID.IRON_ORE, maxY: 64, count: 8, size: 9, radius: 1.30, salt: 0x1A0F },
        { id: ID.GOLD_ORE, maxY: 32, count: 2, size: 8, radius: 1.15, salt: 0x601D },
        { id: ID.LAPIS_ORE, maxY: 32, count: 1, size: 7, radius: 1.05, salt: 0x1A915 },
        { id: ID.DIAMOND_ORE, maxY: 16, count: 1, size: 7, radius: 1.05, salt: 0xD1A0 },
      ];
      const minX = ch.cx * 16, minZ = ch.cz * 16;
      const maxX = minX + 15, maxZ = minZ + 15;
      const stamp = (cx, cy, cz, rx, ry, id) => {
        const x0 = Math.max(minX, Math.floor(cx - rx));
        const x1 = Math.min(maxX, Math.ceil(cx + rx));
        const z0 = Math.max(minZ, Math.floor(cz - rx));
        const z1 = Math.min(maxZ, Math.ceil(cz + rx));
        const y0 = Math.max(1, Math.floor(cy - ry));
        const y1 = Math.min(CH_H - 1, Math.ceil(cy + ry));
        const invX = 1 / Math.max(0.01, rx * rx), invY = 1 / Math.max(0.01, ry * ry);
        for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) {
          const dx = x + 0.5 - cx, dy = y + 0.5 - cy, dz = z + 0.5 - cz;
          if ((dx * dx + dz * dz) * invX + dy * dy * invY > 1) continue;
          const i = idxOf(x & 15, y, z & 15);
          if (ch.blocks[i] === ID.STONE) ch.blocks[i] = id;
        }
      };
      for (let featureX = ch.cx - 1; featureX <= ch.cx + 1; featureX++) {
        for (let featureZ = ch.cz - 1; featureZ <= ch.cz + 1; featureZ++) {
          for (const cfg of configs) {
            const seed = U.hash32(this.seed + ':ore:' + cfg.salt + ':' + featureX + ':' + featureZ);
            const random = U.rng(seed);
            for (let vein = 0; vein < cfg.count; vein++) {
              const centerX = featureX * 16 + random() * 16;
              const centerY = 2 + random() * Math.max(2, cfg.maxY - 4);
              const centerZ = featureZ * 16 + random() * 16;
              const angle = random() * Math.PI * 2;
              const pitch = (random() - 0.5) * 0.34;
              const length = cfg.size * 0.56;
              for (let step = 0; step < cfg.size; step++) {
                const t = cfg.size === 1 ? 0.5 : step / (cfg.size - 1);
                const along = (t - 0.5) * length;
                const x = centerX + Math.cos(angle) * along;
                const y = centerY + Math.sin(pitch) * along;
                const z = centerZ + Math.sin(angle) * along;
                const bulge = 0.35 + Math.sin(t * Math.PI) * cfg.radius;
                const radius = bulge * (0.82 + random() * 0.34);
                stamp(x, y, z, radius, radius * 0.72, cfg.id);
              }
            }
          }
        }
      }
    }

    stampSmallDecor(ch, wx, wz, lx, lz) {
      const ID = Blocks.ID;
      const H = this.genHeight(wx, wz);
      if (H + 1 >= CH_H) return;
      const ground = ch.blocks[idxOf(lx, H, lz)];
      const above = ch.blocks[idxOf(lx, H + 1, lz)];
      if (above !== AIR) return;
      const biome = this.biomeAt(wx, wz);
      const r = U.posRand(this.seed ^ 0xD00D, wx, 1, wz);
      if (biome === 'desert' && ground === ID.SAND) {
        if (r < 0.008) {
          const h = 1 + Math.floor(r * 1000 % 3);
          for (let i = 1; i <= h && H + i < CH_H; i++) ch.blocks[idxOf(lx, H + i, lz)] = ID.CACTUS;
        } else if (r < 0.012) {
          ch.blocks[idxOf(lx, H + 1, lz)] = ID.TALLGRASS; // dead bush stand-in
        }
        return;
      }
      const nearWater = this.genHeight(wx + 1, wz) < SEA || this.genHeight(wx - 1, wz) < SEA ||
        this.genHeight(wx, wz + 1) < SEA || this.genHeight(wx, wz - 1) < SEA;
      if ((ground === ID.GRASS || ground === ID.DIRT || ground === ID.SAND) && nearWater && r < 0.018) {
        const caneHeight = 1 + Math.floor(U.posRand(this.seed ^ 0xCA9E, wx, 2, wz) * 3);
        for (let i = 1; i <= caneHeight && H + i < CH_H; i++) ch.blocks[idxOf(lx, H + i, lz)] = ID.SUGAR_CANE;
        return;
      }
      if (ground !== ID.GRASS && ground !== ID.GRASS_SNOW) return;
      if (biome === 'snow') return;
      if (r < (biome === 'swamp' ? 0.12 : 0.055)) ch.blocks[idxOf(lx, H + 1, lz)] = ID.TALLGRASS;
      else if (r < 0.062) ch.blocks[idxOf(lx, H + 1, lz)] = r * 1e3 % 1 < 0.5 ? ID.FLOWER_RED : ID.FLOWER_YELLOW;
    }

    stampSurfaceStructure(ch) {
      const random = U.rng(U.hash32(this.seed + ':structure:' + ch.cx + ':' + ch.cz));
      if (random() > 0.035) return;
      const lx = 5 + Math.floor(random() * 6), lz = 5 + Math.floor(random() * 6);
      const wx = ch.cx * 16 + lx, wz = ch.cz * 16 + lz;
      if (this.biomeAt(wx, wz) !== 'desert') return;
      const y = this.genHeight(wx, wz);
      for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
        if (Math.abs(this.genHeight(wx + dx, wz + dz) - y) > 1) return;
      }
      const put = (x, py, z, id) => {
        if (py < 1 || py >= CH_H) return;
        ch.blocks[idxOf(x, py, z)] = id;
      };
      const ID = Blocks.ID;
      for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) put(lx + dx, y, lz + dz, ID.SANDSTONE);
      for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) put(lx + dx, y + 1, lz + dz, ID.WATER);
      for (const [dx, dz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) {
        for (let dy = 1; dy <= 3; dy++) put(lx + dx, y + dy, lz + dz, ID.SANDSTONE);
      }
      for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
        if (Math.abs(dx) === 2 || Math.abs(dz) === 2 || (Math.abs(dx) <= 1 && Math.abs(dz) <= 1)) {
          put(lx + dx, y + 4, lz + dz, ID.SANDSTONE);
        }
      }
    }

    stampUndergroundDungeon(ch) {
      const random = U.rng(U.hash32(this.seed + ':dungeon:' + ch.cx + ':' + ch.cz));
      if (random() > 0.055) return;
      const cx = 5 + Math.floor(random() * 6), cz = 5 + Math.floor(random() * 6);
      const cy = 14 + Math.floor(random() * 34);
      let stone = 0, checked = 0;
      for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) for (let dy = 0; dy <= 4; dy++) {
        checked++;
        if (ch.blocks[idxOf(cx + dx, cy + dy, cz + dz)] === Blocks.ID.STONE) stone++;
      }
      if (stone < checked * 0.72) return;
      const ID = Blocks.ID;
      for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) for (let dy = 0; dy <= 4; dy++) {
        const boundary = Math.abs(dx) === 3 || Math.abs(dz) === 3 || dy === 0 || dy === 4;
        const index = idxOf(cx + dx, cy + dy, cz + dz);
        if (!boundary) ch.blocks[index] = AIR;
        else ch.blocks[index] = dy === 0 && random() < 0.35 ? ID.MOSSY : ID.COBBLE;
      }
      ch.blocks[idxOf(cx - 2, cy + 1, cz)] = ID.CHEST;
      const wx = ch.cx * 16 + cx - 2, wz = ch.cz * 16 + cz;
      const slots = Array(27).fill(null);
      slots[0] = { id: Items.IT.REDSTONE, n: 2 + Math.floor(random() * 5) };
      slots[4] = { id: Items.IT.BREAD, n: 1 + Math.floor(random() * 2) };
      if (random() < 0.55) slots[8] = { id: Items.IT.IRON_INGOT, n: 1 + Math.floor(random() * 3) };
      this.setBE(wx, cy + 1, wz, { type: 'chest', slots });
    }

    stampMineshaft(ch) {
      const random = U.rng(U.hash32(this.seed + ':mineshaft:' + ch.cx + ':' + ch.cz));
      if (random() > 0.038) return;
      const ID = Blocks.ID;
      const y = 18 + Math.floor(random() * 30);
      const center = 5 + Math.floor(random() * 6);
      for (let lx = 0; lx < 16; lx++) for (let dz = -1; dz <= 1; dz++) for (let dy = 0; dy <= 2; dy++) {
        const lz = center + dz;
        if (lz < 0 || lz > 15) continue;
        ch.blocks[idxOf(lx, y + dy, lz)] = AIR;
      }
      for (let lx = 1; lx < 16; lx += 4) {
        for (let dz = -1; dz <= 1; dz++) ch.blocks[idxOf(lx, y, center + dz)] = ID.PLANKS;
        ch.blocks[idxOf(lx, y + 1, center - 1)] = ID.OAK_FENCE;
        ch.blocks[idxOf(lx, y + 1, center + 1)] = ID.OAK_FENCE;
        for (let dz = -1; dz <= 1; dz++) ch.blocks[idxOf(lx, y + 3, center + dz)] = ID.PLANKS;
      }
      if (random() < 0.7) ch.blocks[idxOf(8, y + 1, center)] = ID.COBWEB;
      if (random() < 0.45) {
        ch.blocks[idxOf(12, y + 1, center)] = ID.CHEST;
        const slots = Array(27).fill(null);
        slots[0] = { id: Items.IT.IRON_INGOT, n: 1 + Math.floor(random() * 4) };
        slots[5] = { id: Items.IT.BREAD, n: 1 + Math.floor(random() * 3) };
        this.setBE(ch.cx * 16 + 12, y + 1, ch.cz * 16 + center, { type: 'chest', slots });
      }
    }

    stampDesertTemple(ch) {
      if (!this._structureCandidate(ch.cx, ch.cz, 32, 8, STRUCTURE_SALT.temple, false)) return;
      const javaRandom = this._regionRandom(ch.cx, ch.cz, STRUCTURE_SALT.temple + 1);
      const random = () => javaRandom.nextDouble();
      const wx = ch.cx * 16 + 8, wz = ch.cz * 16 + 8;
      if (this.biomeAt(wx, wz) !== 'desert') return;
      const ID = Blocks.ID, y = this.genHeight(wx, wz);
      for (let lx = 3; lx <= 12; lx++) for (let lz = 3; lz <= 12; lz++) {
        ch.blocks[idxOf(lx, y, lz)] = ID.SANDSTONE;
        const wall = lx === 3 || lx === 12 || lz === 3 || lz === 12;
        for (let dy = 1; dy <= 5; dy++) ch.blocks[idxOf(lx, y + dy, lz)] = wall ? ID.SANDSTONE : AIR;
      }
      for (let lx = 2; lx <= 13; lx++) for (let lz = 2; lz <= 13; lz++) ch.blocks[idxOf(lx, y + 6, lz)] = ID.SANDSTONE;
      for (let dy = 1; dy <= 6; dy++) ch.blocks[idxOf(8, y - dy, 8)] = AIR;
      ch.blocks[idxOf(8, y - 7, 8)] = ID.TNT;
      ch.blocks[idxOf(8, y - 6, 7)] = ID.CHEST;
      const slots = Array(27).fill(null);
      slots[0] = { id: Items.IT.GOLD_INGOT, n: 2 + Math.floor(random() * 5) };
      if (random() < 0.35) slots[4] = { id: Items.IT.DIAMOND, n: 1 };
      this.setBE(wx, y - 6, wz - 1, { type: 'chest', slots });
    }

    _strongholdCandidateChunks() {
      if (this._strongholdChunks) return this._strongholdChunks;
      const random = Noise.javaRandom(Noise.javaStructureSeed(this.seed, 0, 0, STRUCTURE_SALT.stronghold));
      const chunks = new Set();
      let angle = random.nextDouble() * Math.PI * 2;
      let ring = 0, inRing = 0, spread = 3;
      for (let index = 0; index < 24; index++) {
        const distance = 96 + ring * 64 + (random.nextDouble() - 0.5) * 32;
        const cx = Math.round(Math.cos(angle) * distance);
        const cz = Math.round(Math.sin(angle) * distance);
        chunks.add(cx + ',' + cz);
        angle += Math.PI * 2 / spread;
        inRing++;
        if (inRing === spread) {
          ring++;
          inRing = 0;
          spread += 2 + Math.floor(spread / (ring + 1));
          angle += random.nextDouble() * Math.PI * 2;
        }
      }
      this._strongholdChunks = chunks;
      return chunks;
    }

    stampStronghold(ch) {
      if (!this._strongholdCandidateChunks().has(ch.key)) return;
      const javaRandom = this._regionRandom(ch.cx, ch.cz, STRUCTURE_SALT.stronghold + 1);
      const random = () => javaRandom.nextDouble();
      const ID = Blocks.ID, y = 25 + Math.floor(random() * 12), cx = 8, cz = 8;
      for (let dx = -6; dx <= 6; dx++) for (let dz = -6; dz <= 6; dz++) for (let dy = 0; dy <= 5; dy++) {
        const boundary = Math.abs(dx) === 6 || Math.abs(dz) === 6 || dy === 0 || dy === 5;
        ch.blocks[idxOf(cx + dx, y + dy, cz + dz)] = boundary ? (random() < 0.18 ? ID.MOSSY : ID.STONE_BRICKS) : AIR;
      }
      const frame = [];
      for (let d = -1; d <= 1; d++) {
        frame.push([d, -2, 2], [d, 2, 0], [-2, d, 1], [2, d, 3]);
      }
      for (const [dx, dz, facing] of frame) {
        ch.blocks[idxOf(cx + dx, y + 1, cz + dz)] = ID.END_PORTAL_FRAME;
        const eye = random() < 0.10 ? 4 : 0;
        this.states.set(this.beKey(ch.cx * 16 + cx + dx, y + 1, ch.cz * 16 + cz + dz), facing | eye);
      }
      ch.blocks[idxOf(cx + 5, y + 1, cz)] = ID.CHEST;
      const slots = Array(27).fill(null);
      slots[0] = { id: Items.IT.ENDER_PEARL, n: 1 + Math.floor(random() * 2) };
      slots[3] = { id: Items.IT.BOOK, n: 1 + Math.floor(random() * 3) };
      this.setBE(ch.cx * 16 + cx + 5, y + 1, ch.cz * 16 + cz, { type: 'chest', slots });
    }

    // stamp tree rooted at (wx,wz) — write only cells inside chunk ch
    stampTree(ch, wx, wz, type) {
      const ID = Blocks.ID;
      const H = this.genHeight(wx, wz);
      const biome = this.biomeAt(wx, wz);
      if (biome === 'ocean' || biome === 'beach' || biome === 'desert') return;
      if (this.isCave(wx, H, wz)) return;
      const r = U.posRand(this.seed ^ 0x7EE5, wx, 7, wz);
      const put = (x, y, z, id, soft) => {
        const lx = x - ch.cx * 16, lz = z - ch.cz * 16;
        if (lx < 0 || lx > 15 || lz < 0 || lz > 15 || y < 0 || y >= CH_H) return;
        const i = idxOf(lx, y, lz);
        if (soft && ch.blocks[i] !== AIR) return;
        ch.blocks[i] = id;
      };
      if (type === 'oak') {
        const h = 4 + Math.floor(r * 3);
        for (let i = 1; i <= h; i++) put(wx, H + i, wz, ID.LOG);
        for (let dy = h - 2; dy <= h + 1; dy++) {
          const rad = dy >= h ? 1 : 2;
          for (let dx = -rad; dx <= rad; dx++) for (let dz = -rad; dz <= rad; dz++) {
            if (dx === 0 && dz === 0 && dy <= h) continue;
            if (Math.abs(dx) === rad && Math.abs(dz) === rad) {
              if (U.posRand(this.seed, wx + dx, H + dy, wz + dz) < 0.4) continue;
            }
            put(wx + dx, H + dy, wz + dz, ID.LEAVES, true);
          }
        }
        put(wx, H + h + 1, wz, ID.LEAVES, true);
      } else { // spruce
        const h = 6 + Math.floor(r * 3);
        for (let i = 1; i <= h; i++) put(wx, H + i, wz, ID.SPRUCE_LOG);
        for (let dy = 2; dy <= h + 1; dy++) {
          const rad = dy > h ? 0 : (dy % 2 === 0 ? Math.max(1, Math.min(2, Math.floor((h - dy) / 2))) : 1);
          if (dy > h) { put(wx, H + dy, wz, ID.LEAVES_SPRUCE, true); continue; }
          if (dy < h - 4) continue;
          for (let dx = -rad; dx <= rad; dx++) for (let dz = -rad; dz <= rad; dz++) {
            if (dx === 0 && dz === 0) continue;
            if (Math.abs(dx) === rad && Math.abs(dz) === rad && rad > 1) continue;
            put(wx + dx, H + dy, wz + dz, ID.LEAVES_SPRUCE, true);
          }
        }
        put(wx, H + h + 1, wz, ID.LEAVES_SPRUCE, true);
      }
    }

    // ---------- block access ----------
    getBlock(x, y, z) {
      if (y < 0) return Blocks.ID.BEDROCK;
      if (y >= CH_H) return AIR;
      const ch = this.chunkOf(x, z);
      if (!ch || !ch.generated) return AIR;
      return ch.blocks[idxOf(x & 15, y, z & 15)];
    }
    getSky(x, y, z) {
      if (y >= CH_H) return 15;
      if (y < 0) return 0;
      const ch = this.chunkOf(x, z);
      if (!ch) return 15;
      return ch.getSky(idxOf(x & 15, y, z & 15));
    }
    getBlkLight(x, y, z) {
      if (y >= CH_H || y < 0) return 0;
      const ch = this.chunkOf(x, z);
      if (!ch) return 0;
      return ch.getBlk(idxOf(x & 15, y, z & 15));
    }
    setSky(x, y, z, v) {
      if (y < 0 || y >= CH_H) return;
      const ch = this.chunkOf(x, z);
      if (!ch) return;
      const i = idxOf(x & 15, y, z & 15);
      if (ch.getSky(i) === v) return;
      ch.setSky(i, v);
      this._markLightDirty(ch, y, x, z);
    }
    setBlkLight(x, y, z, v) {
      if (y < 0 || y >= CH_H) return;
      const ch = this.chunkOf(x, z);
      if (!ch) return;
      const i = idxOf(x & 15, y, z & 15);
      if (ch.getBlk(i) === v) return;
      ch.setBlk(i, v);
      this._markLightDirty(ch, y, x, z);
    }
    lightLevel(x, y, z, dayFactor) {
      const s = this.getSky(x, y, z) * dayFactor;
      const b = this.getBlkLight(x, y, z);
      return Math.max(s, b) / 15;
    }

    doorInfo(x, y, z) {
      const ID = Blocks.ID;
      const id = this.getBlock(x, y, z);
      let lowerY = y, lowerId = id, upperId;
      if (id === ID.OAK_DOOR_TOP || id === ID.IRON_DOOR_TOP) {
        lowerY = y - 1;
        lowerId = id === ID.IRON_DOOR_TOP ? ID.IRON_DOOR : ID.OAK_DOOR;
        upperId = id;
      } else if (id === ID.OAK_DOOR || id === ID.IRON_DOOR) {
        upperId = id === ID.IRON_DOOR ? ID.IRON_DOOR_TOP : ID.OAK_DOOR_TOP;
      } else {
        return null;
      }
      if (this.getBlock(x, lowerY, z) !== lowerId || this.getBlock(x, lowerY + 1, z) !== upperId) return null;
      return { x, z, lowerY, lowerId, upperId };
    }

    setDoorState(x, y, z, state) {
      const door = this.doorInfo(x, y, z);
      if (!door) return false;
      const next = (state | 0) & 15;
      const syncing = this._doorStateSync;
      this._doorStateSync = true;
      let changed = false;
      try {
        changed = this.setState(x, door.lowerY, z, next) || changed;
        changed = this.setState(x, door.lowerY + 1, z, next) || changed;
      } finally {
        this._doorStateSync = syncing;
      }
      if (changed && !syncing && !this._redstoneUpdating) this.updateRedstoneAround(x, door.lowerY, z);
      return changed;
    }

    // runtime block set with lighting + notifications
    setBlock(x, y, z, id) {
      if (y < 0 || y >= CH_H) return false;
      const ch = this.chunkOf(x, z);
      if (!ch || !ch.generated) return false;
      const i = idxOf(x & 15, y, z & 15);
      const old = ch.blocks[i];
      if (old === id) return false;
      this.runtimeEditVersion++;
      const oldFamily = Blocks.get(old).stateFamily || old;
      const newFamily = Blocks.get(id).stateFamily || id;
      if (oldFamily !== newFamily) this.states.delete(this.beKey(x, y, z));
      ch.blocks[i] = id;
      if (id !== AIR) ch.maxSection = Math.max(ch.maxSection || 0, y >> 4);
      ch.modified = true;
      ch.editVersion++;
      const chKey = this.key(ch.cx, ch.cz);
      this.dirtyChunkKeys.add(chKey);
      const section = y >> 4;
      this.markSectionUrgent(ch, section);
      if ((y & 15) === 0) this.markSectionUrgent(ch, section - 1);
      if ((y & 15) === 15) this.markSectionUrgent(ch, section + 1);
      // neighbors remesh if on border
      const lx = x & 15, lz = z & 15;
      if (lx === 0) this._urgentNb(ch.cx - 1, ch.cz, section);
      if (lx === 15) this._urgentNb(ch.cx + 1, ch.cz, section);
      if (lz === 0) this._urgentNb(ch.cx, ch.cz - 1, section);
      if (lz === 15) this._urgentNb(ch.cx, ch.cz + 1, section);
      if (this._batchDepth > 0) {
        const changeKey = x + ',' + y + ',' + z;
        const prev = this._batchChanges.get(changeKey);
        if (prev) prev.newId = id;
        else this._batchChanges.set(changeKey, { x, y, z, oldId: old, newId: id });
      } else {
        this.updateLightOnChange(x, y, z, old, id);
        this.notifyNeighbors(x, y, z);
      }
      if (this.onBlockChanged) this.onBlockChanged(x, y, z, id, old);
      const ID = Blocks.ID;
      const lowerDoor = old === ID.OAK_DOOR || old === ID.IRON_DOOR;
      const upperDoor = old === ID.OAK_DOOR_TOP || old === ID.IRON_DOOR_TOP;
      const expectedTop = old === ID.IRON_DOOR ? ID.IRON_DOOR_TOP : ID.OAK_DOOR_TOP;
      const expectedBottom = old === ID.IRON_DOOR_TOP ? ID.IRON_DOOR : ID.OAK_DOOR;
      if (lowerDoor && this.getBlock(x, y + 1, z) === expectedTop) {
        this.setBlock(x, y + 1, z, AIR);
      } else if (upperDoor && this.getBlock(x, y - 1, z) === expectedBottom) {
        const lowerState = this.getState(x, y - 1, z);
        this.setBlock(x, y - 1, z, AIR);
        if (this.onBlockPopped) this.onBlockPopped(x, y - 1, z, expectedBottom, lowerState);
      }
      if (this._isRedstoneComponent(old) || this._isRedstoneComponent(id)) this.updateRedstoneAround(x, y, z);
      return true;
    }
    _dirtyNb(cx, cz, section) {
      const c = this.chunkAt(cx, cz);
      if (c) this.markSectionDirty(c, section);
    }
    _urgentNb(cx, cz, section) {
      const c = this.chunkAt(cx, cz);
      if (c) this.markSectionUrgent(c, section);
    }

    beginBatch() { this._batchDepth++; }
    endBatch() {
      if (this._batchDepth <= 0) return;
      this._batchDepth--;
      if (this._batchDepth === 0) this._flushBatchChanges();
    }
    _flushBatchChanges() {
      if (!this._batchChanges.size) return;
      const changes = Array.from(this._batchChanges.values()).filter(c => c.oldId !== c.newId);
      this._batchChanges.clear();
      const blkSeeds = [], skySeeds = [];
      for (const c of changes) {
        const br = this._removeBFS('blk', c.x, c.y, c.z);
        const sr = this._removeBFS('sky', c.x, c.y, c.z);
        for (let i = 0; i < br.length; i++) blkSeeds.push(br[i]);
        for (let i = 0; i < sr.length; i++) skySeeds.push(sr[i]);
      }
      for (const c of changes) {
        const em = Blocks.lightOf(c.newId);
        if (em > 0) {
          this._set('blk', c.x, c.y, c.z, em);
          blkSeeds.push(c.x, c.y, c.z);
        }
        if (Blocks.opacity(c.newId) < 15) {
          for (const [dx, dy, dz] of DIRS) {
            blkSeeds.push(c.x + dx, c.y + dy, c.z + dz);
            skySeeds.push(c.x + dx, c.y + dy, c.z + dz);
          }
        }
      }
      this._addBFS('blk', blkSeeds);
      this._addBFS('sky', skySeeds);
      for (const c of changes) this.notifyNeighbors(c.x, c.y, c.z);
    }

    _caneSupported(x, y, z) {
      const ID = Blocks.ID;
      if (this.getBlock(x, y, z) !== ID.SUGAR_CANE) return true;
      let baseY = y;
      while (this.getBlock(x, baseY - 1, z) === ID.SUGAR_CANE) baseY--;
      const soil = this.getBlock(x, baseY - 1, z);
      if (soil !== ID.GRASS && soil !== ID.DIRT && soil !== ID.SAND) return false;
      return this.getBlock(x + 1, baseY - 1, z) === ID.WATER ||
        this.getBlock(x - 1, baseY - 1, z) === ID.WATER ||
        this.getBlock(x, baseY - 1, z + 1) === ID.WATER ||
        this.getBlock(x, baseY - 1, z - 1) === ID.WATER;
    }

    _popUnsupportedCane(x, y, z) {
      if (this.getBlock(x, y, z) !== Blocks.ID.SUGAR_CANE || this._caneSupported(x, y, z)) return false;
      const state = this.getState(x, y, z);
      this.setBlock(x, y, z, AIR);
      if (this.onBlockPopped) this.onBlockPopped(x, y, z, Blocks.ID.SUGAR_CANE, state);
      return true;
    }

    notifyNeighbors(x, y, z) {
      const ID = Blocks.ID;
      // support checks: things standing on removed blocks
      const above = this.getBlock(x, y + 1, z);
      const defA = Blocks.get(above);
      const support = this.getBlock(x, y, z);
      const aboveState = this.getState(x, y + 1, z) | 0;
      const cropUnsupported = defA.stateFamily === 'crop' && support !== ID.FARMLAND;
      const caneUnsupported = above === ID.SUGAR_CANE && !this._caneSupported(x, y + 1, z);
      const unsupportedGround = above === ID.SUGAR_CANE
        ? caneUnsupported
        : (!Blocks.isSolid(support) || cropUnsupported);
      const standingOffset = Blocks.supportOffset(above, aboveState);
      const standingUnsupported = standingOffset && standingOffset[1] < 0 && !Blocks.isSolid(support);
      if ((defA.needsGround && unsupportedGround) || standingUnsupported) {
        // pop it (no drop handling here — drops via callback)
        const state = this.getState(x, y + 1, z);
        if (above === ID.OAK_SIGN) this.removeBE(x, y + 1, z);
        this.setBlock(x, y + 1, z, AIR);
        if (this.onBlockPopped) this.onBlockPopped(x, y + 1, z, above, state);
      }
      if (defA.gravity && !Blocks.isSolid(this.getBlock(x, y, z)) && !Blocks.get(this.getBlock(x, y, z)).liquid) {
        this.schedule(x, y + 1, z, 0.12, 'fall');
      }
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        this._popUnsupportedCane(x + dx, y + 1, z + dz);
      }
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, nz = z + dz;
        const attached = this.getBlock(nx, y, nz);
        const rawState = this.getState(nx, y, nz) | 0;
        const supportDir = Blocks.supportOffset(attached, rawState);
        if (!supportDir || supportDir[1] !== 0) continue;
        if (Blocks.isSolid(this.getBlock(nx + supportDir[0], y, nz + supportDir[2]))) continue;
        if (Blocks.get(attached).stateFamily === 'sign') this.removeBE(nx, y, nz);
        this.setBlock(nx, y, nz, AIR);
        if (this.onBlockPopped) this.onBlockPopped(nx, y, nz, attached, rawState);
      }
      const here = this.getBlock(x, y, z);
      if (Blocks.get(here).liquid) this.schedule(x, y, z, this._flowDelay(here), 'fluid');
      for (const [dx, dy, dz] of DIRS) {
        const nx = x + dx, ny = y + dy, nz = z + dz;
        const neighbor = this.getBlock(nx, ny, nz);
        if (Blocks.get(neighbor).liquid) this.schedule(nx, ny, nz, this._flowDelay(neighbor), 'fluid');
      }
    }

    schedule(x, y, z, delay, type) {
      this.ticks.push({ at: this.time + delay, x, y, z, type });
    }

    _flowDelay(id) { return id === Blocks.ID.LAVA ? 0.48 : 0.12; }

    placeFluidSource(x, y, z, id) {
      if (!Blocks.get(id).liquid || y < 1 || y >= CH_H) return false;
      const current = this.getBlock(x, y, z);
      if (Blocks.get(current).liquid && current !== id) return this._setFlowBlock(x, y, z, id, 0);
      if (current !== AIR && !Blocks.get(current).replaceable) return false;
      this.setBlock(x, y, z, id);
      this.removeState(x, y, z);
      this.schedule(x, y, z, this._flowDelay(id), 'fluid');
      return true;
    }

    _fluidLevel(x, y, z) {
      const state = this.getState(x, y, z);
      return Number.isInteger(state) && state > 0 ? Math.min(7, state) : 0;
    }

    _setFlowBlock(x, y, z, id, level) {
      if (y < 1 || y >= CH_H) return false;
      const current = this.getBlock(x, y, z);
      if (current === id) {
        const oldLevel = this._fluidLevel(x, y, z);
        if (oldLevel === 0 || oldLevel <= level) return false;
        this.setState(x, y, z, level);
        this.schedule(x, y, z, this._flowDelay(id), 'fluid');
        return true;
      }
      const currentDef = Blocks.get(current);
      if (currentDef.liquid && current !== id) {
        const currentLevel = this._fluidLevel(x, y, z);
        const makesObsidian = (current === Blocks.ID.LAVA && currentLevel === 0 && id === Blocks.ID.WATER) ||
          (id === Blocks.ID.LAVA && level === 0 && current === Blocks.ID.WATER);
        this.setBlock(x, y, z, makesObsidian ? Blocks.ID.OBSIDIAN : Blocks.ID.COBBLE);
        this.removeState(x, y, z);
        if (this.onFluidSolidify) this.onFluidSolidify(x, y, z);
        return true;
      }
      if (current !== AIR && !currentDef.replaceable) return false;
      this.setBlock(x, y, z, id);
      this.setState(x, y, z, U.clamp(level, 1, 7));
      if (current !== AIR && this.onBlockPopped) this.onBlockPopped(x, y, z, current);
      this.schedule(x, y, z, this._flowDelay(id), 'fluid');
      return true;
    }

    _flowTick(x, y, z, id) {
      const ID = Blocks.ID;
      if (!Blocks.get(id).liquid) return;
      const level = this._fluidLevel(x, y, z);
      if (level > 0) {
        let fed = this.getBlock(x, y + 1, z) === id;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (this.getBlock(x + dx, y, z + dz) === id && this._fluidLevel(x + dx, y, z + dz) < level) {
            fed = true;
            break;
          }
        }
        if (!fed) {
          this.setBlock(x, y, z, AIR);
          return;
        }
      }

      const below = this.getBlock(x, y - 1, z);
      const belowDef = Blocks.get(below);
      if (below === AIR || belowDef.replaceable || (belowDef.liquid && below !== id)) {
        this._setFlowBlock(x, y - 1, z, id, Math.max(1, level));
        return;
      }
      if (level > 0 && below === id) {
        const below2 = this.getBlock(x, y - 2, z);
        const below2Def = Blocks.get(below2);
        if (below2 === AIR || below2Def.replaceable || (below2Def.liquid && below2 !== id)) return;
      }

      const step = id === ID.LAVA ? 2 : 1;
      const nextLevel = level + step;
      if (nextLevel > 7) return;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        this._setFlowBlock(x + dx, y, z + dz, id, nextLevel);
      }
    }

    loadTicks(items) {
      this.ticks.load((items || []).filter(t => t && typeof t.type === 'string')
        .map(t => ({ at: +t.at || this.time, x: t.x | 0, y: t.y | 0, z: t.z | 0, type: t.type })));
    }

    update(dt) {
      this.time += dt;
      this.timeOfDay = (this.timeOfDay + dt / this.dayLen) % 1;
      this.weatherTimer -= dt;
      if (this.weatherTimer <= 0) {
        if (this.weather === 'clear' && this.random() < 0.38) {
          this.weather = 'rain';
          this.weatherTimer = 90 + this.random() * 180;
        } else {
          this.weather = 'clear';
          this.weatherTimer = 180 + this.random() * 420;
        }
      }
      const rainTarget = this.weather === 'rain' ? 1 : 0;
      this.rainStrength += (rainTarget - this.rainStrength) * Math.min(1, dt * 0.45);
      if (this.ticks.length === 0) return;
      const ID = Blocks.ID;
      let processed = 0;
      while (this.ticks.length && this.ticks.peek().at <= this.time && processed++ < 4096) {
        const t = this.ticks.pop();
        const id = this.getBlock(t.x, t.y, t.z);
        if (t.type === 'fall' && Blocks.get(id).gravity) {
          const below = this.getBlock(t.x, t.y - 1, t.z);
          const bd = Blocks.get(below);
          if (!Blocks.isSolid(below) && !bd.needsGround || bd.liquid || below === AIR || bd.replaceable) {
            if (below === AIR || bd.liquid || bd.replaceable) {
              this.beginBatch();
              this.setBlock(t.x, t.y, t.z, AIR);
              this.setBlock(t.x, t.y - 1, t.z, id);
              this.endBatch();
              this.schedule(t.x, t.y - 1, t.z, 0.12, 'fall');
            }
          }
        } else if (t.type === 'fluid' && Blocks.get(id).liquid) {
          this._flowTick(t.x, t.y, t.z, id);
        } else if (t.type === 'grow' && id === ID.SAPLING) {
          const sky = this.getSky(t.x, t.y, t.z), bl = this.getBlkLight(t.x, t.y, t.z);
          if (Math.max(sky, bl) >= 8) {
            this.growTree(t.x, t.y, t.z);
          } else {
            this.schedule(t.x, t.y, t.z, 30, 'grow');
          }
        } else if (t.type === 'crop' && Blocks.get(id).stateFamily === 'crop') {
          const below = this.getBlock(t.x, t.y - 1, t.z);
          if (below !== ID.FARMLAND) {
            const state = this.getState(t.x, t.y, t.z);
            this.setBlock(t.x, t.y, t.z, AIR);
            if (this.onBlockPopped) this.onBlockPopped(t.x, t.y, t.z, id, state);
            continue;
          }
          const stage = U.clamp(this.getState(t.x, t.y, t.z) | 0, 0, 7);
          const light = Math.max(this.getSky(t.x, t.y, t.z), this.getBlkLight(t.x, t.y, t.z));
          if (stage < 7 && light >= 9 && this.random() < 0.78) this.setState(t.x, t.y, t.z, stage + 1);
          if ((this.getState(t.x, t.y, t.z) | 0) < 7) this.schedule(t.x, t.y, t.z, 8 + this.random() * 10, 'crop');
        } else if (t.type === 'farmland' && id === ID.FARMLAND) {
          let wet = false;
          for (let dx = -4; dx <= 4 && !wet; dx++) for (let dz = -4; dz <= 4 && !wet; dz++) {
            const at = this.getBlock(t.x + dx, t.y, t.z + dz);
            const above = this.getBlock(t.x + dx, t.y + 1, t.z + dz);
            wet = at === ID.WATER || above === ID.WATER;
          }
          const moisture = U.clamp(this.getState(t.x, t.y, t.z) | 0, 0, 7);
          if (wet || this.weather === 'rain') this.setState(t.x, t.y, t.z, 7);
          else if (moisture > 0) this.setState(t.x, t.y, t.z, moisture - 1);
          else if (Blocks.get(this.getBlock(t.x, t.y + 1, t.z)).stateFamily !== 'crop' && this.random() < 0.2) {
            this.setBlock(t.x, t.y, t.z, ID.DIRT);
            continue;
          }
          this.schedule(t.x, t.y, t.z, 5, 'farmland');
        } else if (t.type === 'fire' && id === ID.FIRE) {
          this.setBlock(t.x, t.y, t.z, AIR);
        } else if (t.type === 'button' && id === ID.STONE_BUTTON) {
          if ((this.getState(t.x, t.y, t.z) | 0) !== 0) this.setState(t.x, t.y, t.z, 0);
        } else if (t.type === 'pressure_plate' && id === ID.STONE_PRESSURE_PLATE) {
          const key = this.beKey(t.x, t.y, t.z);
          const until = this._pressurePlateUntil.get(key) || 0;
          if (this.time + 1e-6 < until) this.schedule(t.x, t.y, t.z, until - this.time, 'pressure_plate');
          else {
            this._pressurePlateUntil.delete(key);
            if ((this.getState(t.x, t.y, t.z) | 0) !== 0) this.setState(t.x, t.y, t.z, 0);
          }
        } else if (t.type === 'cane' && id === ID.SUGAR_CANE) {
          if (!this._caneSupported(t.x, t.y, t.z)) {
            this._popUnsupportedCane(t.x, t.y, t.z);
            continue;
          }
          if (this.getBlock(t.x, t.y + 1, t.z) === AIR) {
            let height = 1;
            while (height < 4 && this.getBlock(t.x, t.y - height, t.z) === ID.SUGAR_CANE) height++;
            if (height < 3 && Math.max(this.getSky(t.x, t.y + 1, t.z), this.getBlkLight(t.x, t.y + 1, t.z)) >= 9) {
              this.setBlock(t.x, t.y + 1, t.z, ID.SUGAR_CANE);
              this.schedule(t.x, t.y + 1, t.z, 20 + this.random() * 20, 'cane');
            }
          }
          this.schedule(t.x, t.y, t.z, 20 + this.random() * 20, 'cane');
        }
      }
    }

    pressPressurePlate(x, y, z, duration) {
      if (this.getBlock(x, y, z) !== Blocks.ID.STONE_PRESSURE_PLATE) return false;
      const key = this.beKey(x, y, z);
      const until = this.time + (duration === undefined ? 0.5 : duration);
      this._pressurePlateUntil.set(key, Math.max(this._pressurePlateUntil.get(key) || 0, until));
      if ((this.getState(x, y, z) | 0) === 0) this.setState(x, y, z, 1);
      this.schedule(x, y, z, Math.max(0.05, until - this.time), 'pressure_plate');
      return true;
    }

    growTree(x, y, z) {
      const ID = Blocks.ID;
      // room check
      for (let dy = 1; dy < 5; dy++) {
        if (Blocks.isSolid(this.getBlock(x, y + dy, z))) { this.schedule(x, y, z, 30, 'grow'); return; }
      }
      this.beginBatch();
      this.setBlock(x, y, z, AIR);
      const h = 4 + Math.floor(U.posRand(this.seed, x, y, z) * 3);
      for (let i = 0; i < h; i++) this.setBlock(x, y + i, z, ID.LOG);
      for (let dy = h - 3; dy <= h; dy++) {
        const rad = dy >= h - 1 ? 1 : 2;
        for (let dx = -rad; dx <= rad; dx++) for (let dz = -rad; dz <= rad; dz++) {
          if (dx === 0 && dz === 0 && dy < h) continue;
          if (Math.abs(dx) === rad && Math.abs(dz) === rad && U.posRand(this.seed, x + dx, y + dy, z + dz) < 0.4) continue;
          if (this.getBlock(x + dx, y + dy, z + dz) === AIR) this.setBlock(x + dx, y + dy, z + dz, ID.LEAVES);
        }
      }
      this.setBlock(x, y + h, z, ID.LEAVES);
      this.endBatch();
    }

    // ---------- lighting ----------
    initSkylight(ch) {
      // vertical beams
      const beam = new Uint16Array(256); // bottom of full-light beam per column
      for (let lx = 0; lx < 16; lx++) for (let lz = 0; lz < 16; lz++) {
        let y = CH_H - 1;
        for (; y >= 0; y--) {
          const id = ch.blocks[idxOf(lx, y, lz)];
          if (Blocks.opacity(id) !== 0) break;
          ch.setSky(idxOf(lx, y, lz), 15);
        }
        beam[lx | (lz << 4)] = y + 1;
      }
      // seed BFS from beam walls (cells lit 15 with a horizontal neighbor whose beam is lower)
      const seeds = [];
      for (let lx = 0; lx < 16; lx++) for (let lz = 0; lz < 16; lz++) {
        const b = beam[lx | (lz << 4)];
        for (let d = 0; d < 4; d++) {
          const dx = DIR_X[d], dz = DIR_Z[d];
          const nx = lx + dx, nz = lz + dz;
          if (nx < 0 || nx > 15 || nz < 0 || nz > 15) continue;
          const nb = beam[nx | (nz << 4)];
          for (let y = b; y < nb; y++) {
            // neighbor column is dark at heights where this column is lit
            seeds.push(ch.cx * 16 + nx, y, ch.cz * 16 + nz);
          }
        }
      }
      this._spreadFromNeighbors('sky', seeds);
    }

    initBlocklight(ch) {
      const seeds = [];
      const yEnd = Math.min(CH_H, (ch.maxSection + 1) * SEC_H);
      for (let y = 0; y < yEnd; y++) for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
        const id = ch.blocks[idxOf(lx, y, lz)];
        const em = Blocks.lightOf(id);
        if (em > 0) {
          ch.setBlk(idxOf(lx, y, lz), em);
          seeds.push(ch.cx * 16 + lx, y, ch.cz * 16 + lz);
        }
      }
      if (seeds.length) this._addBFS('blk', seeds);
    }

    exchangeBorderLight(a, b) {
      // seed add-BFS from every border cell of both chunks
      const seeds = [];
      const yEnd = Math.min(CH_H, (Math.max(a.maxSection, b.maxSection) + 2) * SEC_H);
      const pushCol = (x, z) => { for (let y = 0; y < yEnd; y++) seeds.push(x, y, z); };
      if (a.cx !== b.cx) {
        const xa = a.cx < b.cx ? a.cx * 16 + 15 : a.cx * 16;
        const xb = a.cx < b.cx ? b.cx * 16 : b.cx * 16 + 15;
        for (let z = 0; z < 16; z++) { pushCol(xa, a.cz * 16 + z); pushCol(xb, b.cz * 16 + z); }
      } else {
        const za = a.cz < b.cz ? a.cz * 16 + 15 : a.cz * 16;
        const zb = a.cz < b.cz ? b.cz * 16 : b.cz * 16 + 15;
        for (let x = 0; x < 16; x++) { pushCol(a.cx * 16 + x, za); pushCol(b.cx * 16 + x, zb); }
      }
      this._addBFS('sky', seeds);
      this._addBFS('blk', seeds);
    }

    _spreadFromNeighbors(chan, cells) {
      // seed from adjacent lit cells: the BFS from every listed cell's neighbors
      const nbSeeds = [];
      for (let i = 0; i < cells.length; i += 3) {
        const x = cells[i], y = cells[i + 1], z = cells[i + 2];
        for (let d = 0; d < 6; d++) nbSeeds.push(x + DIR_X[d], y + DIR_Y[d], z + DIR_Z[d]);
      }
      this._addBFS(chan, nbSeeds);
    }

    _get(chan, x, y, z) { return chan === 'sky' ? this.getSky(x, y, z) : this.getBlkLight(x, y, z); }
    _set(chan, x, y, z, v) { if (chan === 'sky') this.setSky(x, y, z, v); else this.setBlkLight(x, y, z, v); }

    _addBFS(chan, seeds) {
      // seeds: flat [x,y,z,...] — spread from current values at those cells
      const q = this._lightQueue;
      q.reset();
      for (let i = 0; i < seeds.length; i += 3) q.push(seeds[i], seeds[i + 1], seeds[i + 2], 0);
      const isSky = chan === 'sky';
      let guard = 0;
      while (q.head < q.tail && guard++ < 500000) {
        const qi = q.head;
        const x = q.data[qi], y = q.data[qi + 1], z = q.data[qi + 2];
        q.head += 4;
        if (y < 0 || y >= CH_H) continue;
        const ch = this.chunkOf(x, z);
        if (!ch || !ch.generated) continue;
        const i = idxOf(x & 15, y, z & 15);
        const v = isSky ? ch.light[i] >> 4 : ch.light[i] & 15;
        if (v <= 0) continue;
        for (let d = 0; d < 6; d++) {
          const dx = DIR_X[d], dy = DIR_Y[d], dz = DIR_Z[d];
          const nx = x + dx, ny = y + dy, nz = z + dz;
          if (ny < 0 || ny >= CH_H) continue;
          const ncx = nx >> 4, ncz = nz >> 4;
          const nch = ncx === ch.cx && ncz === ch.cz ? ch : this.chunkAt(ncx, ncz);
          if (!nch || !nch.generated) continue;
          const ni = idxOf(nx & 15, ny, nz & 15);
          const nid = nch.blocks[ni];
          const op = Blocks.opacity(nid);
          if (op >= 15) continue;
          let cand;
          if (isSky && dy === -1 && v === 15 && op === 0) cand = 15;
          else cand = v - Math.max(1, op);
          const old = isSky ? nch.light[ni] >> 4 : nch.light[ni] & 15;
          if (cand > old) {
            if (isSky) nch.light[ni] = (nch.light[ni] & 15) | (cand << 4);
            else nch.light[ni] = (nch.light[ni] & 240) | cand;
            this._markLightDirty(nch, ny, nx, nz);
            q.push(nx, ny, nz, 0);
          }
        }
      }
    }

    _removeBFS(chan, x, y, z) {
      // remove light emanating through (x,y,z); returns reseed list
      const startVal = this._get(chan, x, y, z);
      const reseeds = [];
      if (startVal === 0) return reseeds;
      this._set(chan, x, y, z, 0);
      const q = this._lightQueue;
      q.reset();
      q.push(x, y, z, startVal);
      const isSky = chan === 'sky';
      let guard = 0;
      while (q.head < q.tail && guard++ < 500000) {
        const qi = q.head;
        const cx = q.data[qi], cy = q.data[qi + 1], cz = q.data[qi + 2], cv = q.data[qi + 3];
        q.head += 4;
        const ch = this.chunkOf(cx, cz);
        if (!ch || !ch.generated) continue;
        for (let d = 0; d < 6; d++) {
          const dx = DIR_X[d], dy = DIR_Y[d], dz = DIR_Z[d];
          const nx = cx + dx, ny = cy + dy, nz = cz + dz;
          if (ny < 0 || ny >= CH_H) continue;
          const ncx = nx >> 4, ncz = nz >> 4;
          const nch = ncx === ch.cx && ncz === ch.cz ? ch : this.chunkAt(ncx, ncz);
          if (!nch || !nch.generated) continue;
          const ni = idxOf(nx & 15, ny, nz & 15);
          const nl = isSky ? nch.light[ni] >> 4 : nch.light[ni] & 15;
          if (nl === 0) continue;
          const beamDown = isSky && dy === -1 && cv === 15 && nl === 15;
          if (nl < cv || beamDown) {
            if (isSky) nch.light[ni] &= 15;
            else nch.light[ni] &= 240;
            this._markLightDirty(nch, ny, nx, nz);
            q.push(nx, ny, nz, beamDown ? 15 : nl);
          } else {
            reseeds.push(nx, ny, nz);
          }
        }
      }
      return reseeds;
    }

    _markLightDirty(ch, y, x, z) {
      const section = y >> 4;
      this.markSectionDirty(ch, section);
      if ((y & 15) === 0) this.markSectionDirty(ch, section - 1);
      if ((y & 15) === 15) this.markSectionDirty(ch, section + 1);
      if (!Number.isInteger(x) || !Number.isInteger(z)) return;
      const lx = x & 15, lz = z & 15;
      if (lx === 0) this._dirtyNb(ch.cx - 1, ch.cz, section);
      if (lx === 15) this._dirtyNb(ch.cx + 1, ch.cz, section);
      if (lz === 0) this._dirtyNb(ch.cx, ch.cz - 1, section);
      if (lz === 15) this._dirtyNb(ch.cx, ch.cz + 1, section);
    }

    updateLightOnChange(x, y, z, oldId, newId) {
      const oldOpacity = Blocks.opacity(oldId);
      const newOpacity = Blocks.opacity(newId);
      const oldEmission = Blocks.lightOf(oldId);
      const newEmission = Blocks.lightOf(newId);
      const opacityChanged = oldOpacity !== newOpacity;

      // Block light only changes when emission or light blocking changes.
      if (opacityChanged || oldEmission !== newEmission) {
        const reseeds = this._removeBFS('blk', x, y, z);
        if (newEmission > 0) {
          this._set('blk', x, y, z, newEmission);
          reseeds.push(x, y, z);
        }
        if (newOpacity < 15) {
          for (const [dx, dy, dz] of DIRS) reseeds.push(x + dx, y + dy, z + dz);
        }
        this._addBFS('blk', reseeds);
      }

      // Sky light is independent of block emission.
      if (opacityChanged) {
        const reseeds = this._removeBFS('sky', x, y, z);
        if (newOpacity < 15) {
          for (const [dx, dy, dz] of DIRS) reseeds.push(x + dx, y + dy, z + dz);
        }
        this._addBFS('sky', reseeds);
      }
    }

    // ---------- block entities ----------
    beKey(x, y, z) { return x + ',' + y + ',' + z; }
    getState(x, y, z) { return this.states.get(this.beKey(x, y, z)); }
    setState(x, y, z, state) {
      const key = this.beKey(x, y, z);
      const old = this.states.get(key);
      const next = state === undefined || state === null ? undefined : state;
      if (old === next) return false;
      if (next === undefined) this.states.delete(key);
      else this.states.set(key, next);
      const ch = this.chunkOf(x, z);
      if (ch) {
        ch.modified = true;
        ch.editVersion++;
        this.dirtyChunkKeys.add(this.key(ch.cx, ch.cz));
        this.markSectionDirty(ch, y >> 4);
      }
      if (this.onStateChanged) this.onStateChanged(x, y, z, next, old);
      if (!this._doorStateSync && this._isRedstoneComponent(this.getBlock(x, y, z))) this.updateRedstoneAround(x, y, z);
      return true;
    }
    _isRedstoneComponent(id) {
      const ID = Blocks.ID;
      return id === ID.LEVER || id === ID.STONE_BUTTON || id === ID.STONE_PRESSURE_PLATE ||
        id === ID.REDSTONE_WIRE || id === ID.REDSTONE_TORCH || id === ID.REDSTONE_TORCH_OFF ||
        id === ID.REPEATER || id === ID.REPEATER_LIT || id === ID.REDSTONE_LAMP ||
        id === ID.REDSTONE_LAMP_LIT || id === ID.OAK_DOOR || id === ID.OAK_DOOR_TOP ||
        id === ID.OAK_TRAPDOOR || id === ID.OAK_FENCE_GATE || id === ID.IRON_DOOR ||
        id === ID.IRON_DOOR_TOP || id === ID.IRON_TRAPDOOR || id === ID.PISTON || id === ID.PISTON_HEAD;
    }
    _redstoneSourceToward(x, y, z, tx, ty, tz, wireLevels) {
      const ID = Blocks.ID;
      const id = this.getBlock(x, y, z);
      if (id === ID.LEVER || id === ID.STONE_BUTTON || id === ID.STONE_PRESSURE_PLATE) {
        return (this.getState(x, y, z) | 0) > 0 ? 15 : 0;
      }
      if (id === ID.REDSTONE_TORCH) return 15;
      if (id === ID.REDSTONE_WIRE) {
        const key = this.beKey(x, y, z);
        return wireLevels && wireLevels.has(key) ? wireLevels.get(key) : U.clamp(this.getState(x, y, z) | 0, 0, 15);
      }
      if (id === ID.REPEATER_LIT) {
        const facing = this.getState(x, y, z) & 3;
        const dir = [[0,0,-1],[1,0,0],[0,0,1],[-1,0,0]][facing];
        return x + dir[0] === tx && y === ty && z + dir[2] === tz ? 15 : 0;
      }
      return 0;
    }
    redstonePowerAt(x, y, z, excludeKey, wireLevels, ignoreWires) {
      let power = 0;
      for (const [dx, dy, dz] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]) {
        const sx = x + dx, sy = y + dy, sz = z + dz;
        if (excludeKey && this.beKey(sx, sy, sz) === excludeKey) continue;
        if (ignoreWires && this.getBlock(sx, sy, sz) === Blocks.ID.REDSTONE_WIRE) continue;
        power = Math.max(power, this._redstoneSourceToward(sx, sy, sz, x, y, z, wireLevels));
      }
      return power;
    }
    _setPoweredOpen(x, y, z, powered) {
      const door = this.doorInfo(x, y, z);
      if (door) {
        const key = this.beKey(x, door.lowerY, z);
        const state = this.getState(x, door.lowerY, z) | 0;
        powered = powered || this.redstonePowerAt(x, door.lowerY, z) > 0 ||
          this.redstonePowerAt(x, door.lowerY + 1, z) > 0;
        let next = state;
        if (powered && !(state & 4)) {
          this._redstoneOpened.add(key);
          next = state | 4;
        } else if (!powered && this._redstoneOpened.has(key)) {
          this._redstoneOpened.delete(key);
          next = state & ~4;
        }
        this.setDoorState(x, door.lowerY, z, next);
        return;
      }
      const key = this.beKey(x, y, z);
      const state = this.getState(x, y, z) | 0;
      if (powered && !(state & 4)) {
        this._redstoneOpened.add(key);
        this.setState(x, y, z, state | 4);
      } else if (!powered && this._redstoneOpened.has(key)) {
        this._redstoneOpened.delete(key);
        this.setState(x, y, z, state & ~4);
      }
    }
    _updatePiston(x, y, z, powered) {
      const ID = Blocks.ID;
      const state = this.getState(x, y, z) | 0;
      const facing = state & 3;
      const dir = [[0,0,-1],[1,0,0],[0,0,1],[-1,0,0]][facing];
      const hx = x + dir[0], hz = z + dir[2];
      if (powered && !(state & 4)) {
        const target = this.getBlock(hx, y, hz);
        if (target !== AIR) {
          const bx = hx + dir[0], bz = hz + dir[2];
          const targetDef = Blocks.get(target);
          if (this.getBlock(bx, y, bz) !== AIR || targetDef.hardness < 0 || this.getBE(hx, y, hz)) return;
          const targetState = this.getState(hx, y, hz);
          this.setBlock(bx, y, bz, target);
          if (targetState === undefined) this.removeState(bx, y, bz); else this.setState(bx, y, bz, targetState);
        }
        this.setBlock(hx, y, hz, ID.PISTON_HEAD);
        this.setState(hx, y, hz, facing);
        this.setState(x, y, z, facing | 4);
      } else if (!powered && (state & 4)) {
        if (this.getBlock(hx, y, hz) === ID.PISTON_HEAD) this.setBlock(hx, y, hz, AIR);
        this.setState(x, y, z, facing);
      }
    }
    updateRedstoneAround(x, y, z) {
      if (this._redstoneUpdating) { this._redstonePending = [x, y, z]; return; }
      this._redstoneUpdating = true;
      try {
        const ID = Blocks.ID;
        const wires = [];
        const levels = new Map();
        const minY = Math.max(0, y - 5), maxY = Math.min(CH_H - 1, y + 5);
        for (let wx = x - 16; wx <= x + 16; wx++) for (let wz = z - 16; wz <= z + 16; wz++) {
          for (let wy = minY; wy <= maxY; wy++) {
            if (this.getBlock(wx, wy, wz) !== ID.REDSTONE_WIRE) continue;
            const key = this.beKey(wx, wy, wz);
            wires.push({ x: wx, y: wy, z: wz, key });
            levels.set(key, 0);
          }
        }
        for (let pass = 0; pass < 16; pass++) {
          let changed = false;
          for (const wire of wires) {
            let next = this.redstonePowerAt(wire.x, wire.y, wire.z, null, levels, true);
            for (const [dx, dy, dz] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]) {
              const other = levels.get(this.beKey(wire.x + dx, wire.y + dy, wire.z + dz));
              if (other !== undefined) next = Math.max(next, other - 1);
            }
            next = U.clamp(next | 0, 0, 15);
            if (levels.get(wire.key) !== next) { levels.set(wire.key, next); changed = true; }
          }
          if (!changed) break;
        }
        for (const wire of wires) this.setState(wire.x, wire.y, wire.z, levels.get(wire.key));

        for (let wx = x - 16; wx <= x + 16; wx++) for (let wz = z - 16; wz <= z + 16; wz++) {
          for (let wy = minY; wy <= maxY; wy++) {
            let id = this.getBlock(wx, wy, wz);
            if (id === ID.REPEATER || id === ID.REPEATER_LIT) {
              const facing = this.getState(wx, wy, wz) & 3;
              const dir = [[0,0,-1],[1,0,0],[0,0,1],[-1,0,0]][facing];
              const input = this._redstoneSourceToward(wx - dir[0], wy, wz - dir[2], wx, wy, wz, levels) > 0;
              const wanted = input ? ID.REPEATER_LIT : ID.REPEATER;
              if (id !== wanted) { this.setBlock(wx, wy, wz, wanted); this.setState(wx, wy, wz, facing); id = wanted; }
            } else if (id === ID.REDSTONE_TORCH || id === ID.REDSTONE_TORCH_OFF) {
              const supportPowered = this.redstonePowerAt(wx, wy - 1, wz, this.beKey(wx, wy, wz), levels) > 0;
              const wanted = supportPowered ? ID.REDSTONE_TORCH_OFF : ID.REDSTONE_TORCH;
              if (id !== wanted) this.setBlock(wx, wy, wz, wanted);
            }
            const power = this.redstonePowerAt(wx, wy, wz, null, levels);
            if (id === ID.REDSTONE_LAMP || id === ID.REDSTONE_LAMP_LIT) {
              const wanted = power > 0 ? ID.REDSTONE_LAMP_LIT : ID.REDSTONE_LAMP;
              if (id !== wanted) this.setBlock(wx, wy, wz, wanted);
            } else if (id === ID.OAK_DOOR || id === ID.OAK_DOOR_TOP || id === ID.OAK_TRAPDOOR || id === ID.OAK_FENCE_GATE ||
                       id === ID.IRON_DOOR || id === ID.IRON_DOOR_TOP || id === ID.IRON_TRAPDOOR) {
              this._setPoweredOpen(wx, wy, wz, power > 0);
            } else if (id === ID.PISTON) {
              this._updatePiston(wx, wy, wz, power > 0);
            }
          }
        }
      } finally {
        this._redstoneUpdating = false;
        const pending = this._redstonePending;
        this._redstonePending = null;
        if (pending) this.updateRedstoneAround(pending[0], pending[1], pending[2]);
      }
    }
    removeState(x, y, z) { return this.setState(x, y, z, null); }
    getBE(x, y, z) { return this.be.get(this.beKey(x, y, z)) || null; }
    setBE(x, y, z, obj) {
      const key = this.beKey(x, y, z);
      obj.x = x; obj.y = y; obj.z = z; obj.key = key;
      this.be.set(key, obj);
      this.blockEntityVersion++;
      if (obj.type === 'furnace') this.activeFurnaces.add(key);
      else this.activeFurnaces.delete(key);
    }
    activateFurnace(be) {
      if (be && be.type === 'furnace' && be.key) this.activeFurnaces.add(be.key);
    }
    removeBE(x, y, z) {
      const k = this.beKey(x, y, z);
      const v = this.be.get(k) || null;
      this.be.delete(k);
      if (v) this.blockEntityVersion++;
      this.activeFurnaces.delete(k);
      return v;
    }

    // ---------- raycast (DDA) ----------
    raycast(ox, oy, oz, dx, dy, dz, maxDist, includeLiquids) {
      let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
      const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
      const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
      const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
      const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;
      let tMaxX = dx !== 0 ? (dx > 0 ? (x + 1 - ox) : (ox - x)) * tDeltaX : Infinity;
      let tMaxY = dy !== 0 ? (dy > 0 ? (y + 1 - oy) : (oy - y)) * tDeltaY : Infinity;
      let tMaxZ = dz !== 0 ? (dz > 0 ? (z + 1 - oz) : (oz - z)) * tDeltaZ : Infinity;
      let face = [0, 0, 0];
      let t = 0;
      for (let i = 0; i < 256; i++) {
        const id = this.getBlock(x, y, z);
        const def = Blocks.get(id);
        if (id !== AIR && (includeLiquids || !def.liquid) && t <= maxDist) {
          const source = def.modelBoxes || def.collisionBoxes;
          if (source) {
            const state = this.getState(x, y, z);
            const boxes = typeof source === 'function' ? source(this, x, y, z, Number.isInteger(state) ? state : 0) : source;
            let best = null;
            for (const shape of boxes || []) {
              const shapeHit = rayBoxHit(ox, oy, oz, dx, dy, dz, x, y, z, shape, face);
              if (shapeHit && shapeHit.dist <= maxDist && (!best || shapeHit.dist < best.dist)) best = shapeHit;
            }
            if (best) return { x, y, z, id, face: best.face, dist: best.dist };
          } else if (def.collision) {
            const shapeHit = rayBoxHit(ox, oy, oz, dx, dy, dz, x, y, z, def.collision, face);
            if (shapeHit && shapeHit.dist <= maxDist) return { x, y, z, id, face: shapeHit.face, dist: shapeHit.dist };
          } else {
            return { x, y, z, id, face, dist: t };
          }
        }
        if (tMaxX < tMaxY && tMaxX < tMaxZ) {
          x += stepX; t = tMaxX; tMaxX += tDeltaX; face = [-stepX, 0, 0];
        } else if (tMaxY < tMaxZ) {
          y += stepY; t = tMaxY; tMaxY += tDeltaY; face = [0, -stepY, 0];
        } else {
          z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; face = [0, 0, -stepZ];
        }
        if (t > maxDist) return null;
      }
      return null;
    }

    findSpawn() {
      for (let r = 0; r < 64; r++) {
        for (let a = 0; a < 8; a++) {
          const x = Math.round(Math.cos(a / 8 * Math.PI * 2) * r * 8);
          const z = Math.round(Math.sin(a / 8 * Math.PI * 2) * r * 8);
          const b = this.biomeAt(x, z);
          if (b !== 'ocean' && b !== 'river') {
            return { x: x + 0.5, y: this.genHeight(x, z) + 2, z: z + 0.5 };
          }
        }
      }
      return { x: 0.5, y: this.genHeight(0, 0) + 2, z: 0.5 };
    }

    tryCreateNetherPortal(x, y, z) {
      const ID = Blocks.ID;
      for (const axis of [[1, 0], [0, 1]]) {
        for (let cellX = 0; cellX < 2; cellX++) for (let cellY = 0; cellY < 3; cellY++) {
          const bx = x - axis[0] * cellX, by = y - cellY, bz = z - axis[1] * cellX;
          let valid = true;
          for (let ix = -1; ix <= 2 && valid; ix++) for (let iy = -1; iy <= 3; iy++) {
            const px = bx + axis[0] * ix, py = by + iy, pz = bz + axis[1] * ix;
            const frame = ix === -1 || ix === 2 || iy === -1 || iy === 3;
            const id = this.getBlock(px, py, pz);
            if (frame ? id !== ID.OBSIDIAN : !(id === AIR || id === ID.FIRE || id === ID.NETHER_PORTAL)) {
              valid = false; break;
            }
          }
          if (!valid) continue;
          this.beginBatch();
          for (let ix = 0; ix < 2; ix++) for (let iy = 0; iy < 3; iy++) {
            const px = bx + axis[0] * ix, py = by + iy, pz = bz + axis[1] * ix;
            this.setBlock(px, py, pz, ID.NETHER_PORTAL);
            this.setState(px, py, pz, axis[0] ? 0 : 1);
          }
          this.endBatch();
          return true;
        }
      }
      return false;
    }

    activateEndPortal(x, y, z) {
      const ID = Blocks.ID;
      for (let cx = x - 2; cx <= x + 2; cx++) for (let cz = z - 2; cz <= z + 2; cz++) {
        const frame = [];
        for (let d = -1; d <= 1; d++) frame.push([d,-2], [d,2], [-2,d], [2,d]);
        if (!frame.every(([dx, dz]) => this.getBlock(cx + dx, y, cz + dz) === ID.END_PORTAL_FRAME && (this.getState(cx + dx, y, cz + dz) & 4))) continue;
        this.beginBatch();
        for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) this.setBlock(cx + dx, y, cz + dz, ID.END_PORTAL);
        this.endBatch();
        return true;
      }
      return false;
    }

    _buildDestinationPortal(x, y, z) {
      const ID = Blocks.ID;
      for (let px = x - 2; px <= x + 2; px++) this.ensureChunk(px >> 4, z >> 4);
      this.beginBatch();
      for (let dx = -1; dx <= 2; dx++) for (let dy = 0; dy <= 4; dy++) {
        const frame = dx === -1 || dx === 2 || dy === 0 || dy === 4;
        this.setBlock(x + dx, y + dy, z, frame ? ID.OBSIDIAN : ID.NETHER_PORTAL);
        if (!frame) this.setState(x + dx, y + dy, z, 0);
      }
      for (let dx = -2; dx <= 3; dx++) for (let dz = -2; dz <= 2; dz++) {
        if (this.getBlock(x + dx, y - 1, z + dz) === AIR) this.setBlock(x + dx, y - 1, z + dz, ID.NETHERRACK);
      }
      this.endBatch();
    }

    portalDestination(x, y, z, portalId) {
      const ID = Blocks.ID;
      const dimension = this.dimensionAt(x, z);
      if (portalId === ID.END_PORTAL) {
        if (dimension === 'end') {
          const sy = this.genHeight(0, 0) + 2;
          this.ensureChunk(0, 0);
          return { x: 0.5, y: sy, z: 0.5, dimension: 'overworld' };
        }
        const tx = END_OFFSET + 8, tz = 8;
        this.ensureChunk(tx >> 4, tz >> 4);
        return { x: tx + 0.5, y: 64, z: tz + 0.5, dimension: 'end' };
      }
      let tx, tz;
      if (dimension === 'nether') {
        tx = Math.round((x - NETHER_OFFSET) * 8);
        tz = Math.round(z * 8);
      } else {
        tx = NETHER_OFFSET + Math.round(x / 8);
        tz = Math.round(z / 8);
      }
      this.ensureChunk(tx >> 4, tz >> 4);
      const ty = Math.max(35, this.genHeight(tx, tz) + 2);
      this._buildDestinationPortal(tx, ty - 1, tz);
      return { x: tx + 0.5, y: ty, z: tz + 0.5, dimension: dimension === 'nether' ? 'overworld' : 'nether' };
    }

    // day factor: 1 at noon, 0 at midnight, smooth transitions
    dayFactor() {
      const t = this.timeOfDay;
      // day: 0.25..0.75 (noon 0.5); night otherwise
      const s = Math.sin((t - 0.25) * Math.PI * 2 / 1.0 * Math.PI / Math.PI); // sin over day cycle
      const v = Math.sin((t) * Math.PI * 2 - Math.PI / 2); // -1 midnight, 1 noon
      return U.clamp(v * 0.5 + 0.55, 0.03, 1);
    }
  }

  const DIRS = [
    [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
  ];

  World.CH_W = CH_W;
  World.CH_H = CH_H;
  World.SEC_H = SEC_H;
  World.SEC_N = SEC_N;
  World.SEA = SEA;
  World.NETHER_OFFSET = NETHER_OFFSET;
  World.END_OFFSET = END_OFFSET;
  World.LEGACY_CH_H = 96;
  window.World = World;
})();
