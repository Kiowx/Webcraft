/* renderer.js — WebGL frame rendering: sky, sun/moon, chunks, entities, particles,
   selection box, crack overlay, held item, weather, underwater tint */
'use strict';
(function () {
  const Renderer = {};
  let gl, canvas;
  let progWorld, progSky, progLine;
  let atlasTex;
  const M = () => GL.mat4;

  const VS_WORLD = `
    attribute vec3 aPos;
    attribute vec2 aUV;
    attribute vec2 aLight;
    uniform mat4 uPV;
    uniform vec3 uCamera;
    uniform float uLightOverride;
    uniform vec2 uHandLight;
    varying vec2 vUV;
    varying vec2 vLight;
    varying float vFogD;
    void main() {
      gl_Position = uPV * vec4(aPos, 1.0);
      vUV = aUV;
      vLight = mix(aLight, aLight * uHandLight, uLightOverride);
      vFogD = length(aPos - uCamera);
    }
  `;
  const FS_WORLD = `
    precision mediump float;
    uniform sampler2D uTex;
    uniform float uDay;
    uniform vec3 uFogCol;
    uniform float uFogNear, uFogFar;
    uniform float uAlphaCut;
    uniform float uBright;
    uniform vec3 uTint;
    uniform float uAlpha;
    varying vec2 vUV;
    varying vec2 vLight;
    varying float vFogD;
    void main() {
      vec4 c = texture2D(uTex, vUV);
      if (c.a < uAlphaCut) discard;
      float sky = vLight.x * uDay;
      float blk = vLight.y;
      float l = max(sky, blk);
      l = max(l, 0.045) * uBright;
      vec3 lit = c.rgb * min(l, 1.35);
      // torch warmth
      lit *= mix(vec3(1.0), vec3(1.12, 1.02, 0.86), clamp(blk - sky, 0.0, 1.0) * 0.7);
      lit *= uTint;
      float fog = clamp((vFogD - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
      gl_FragColor = vec4(mix(lit, uFogCol, fog), c.a * uAlpha);
    }
  `;
  const VS_SKY = `
    attribute vec2 aPos;
    varying vec2 vPos;
    void main() { vPos = aPos; gl_Position = vec4(aPos, 0.9999, 1.0); }
  `;
  const FS_SKY = `
    precision mediump float;
    uniform vec3 uTop, uBottom;
    varying vec2 vPos;
    void main() {
      float t = clamp(vPos.y * 0.5 + 0.5, 0.0, 1.0);
      gl_FragColor = vec4(mix(uBottom, uTop, pow(t, 0.8)), 1.0);
    }
  `;
  const VS_LINE = `
    attribute vec3 aPos;
    uniform mat4 uPV;
    void main() { gl_Position = uPV * vec4(aPos, 1.0); gl_PointSize = 1.5; }
  `;
  const FS_LINE = `
    precision mediump float;
    uniform vec4 uCol;
    void main() { gl_FragColor = uCol; }
  `;

  const chunkGL = new Map(); // key -> {cx,cz,sections:Map<section,{opaque,alpha}>}
  const handMeshCache = new Map();
  const WHITE = new Float32Array([1, 1, 1]);
  const BLACK = new Float32Array([0, 0, 0]);
  const DAY_TOP = [0.45, 0.68, 0.99], DAY_BOTTOM = [0.70, 0.83, 0.99];
  const NIGHT_TOP = [0.015, 0.02, 0.06], NIGHT_BOTTOM = [0.05, 0.06, 0.12];
  const CELESTIAL_SIGNS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const BOX_EDGES = [0, 1, 1, 5, 5, 4, 4, 0, 2, 3, 3, 7, 7, 6, 6, 2, 0, 2, 1, 3, 5, 7, 4, 6];
  const CRACK_FACES = [[0, 1, 3, 2], [5, 4, 6, 7], [4, 0, 2, 6], [1, 5, 7, 3], [2, 3, 7, 6], [4, 5, 1, 0]];
  const CUBE_INDICES = [
    0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 8, 10, 11,
    12, 13, 14, 12, 14, 15, 16, 17, 18, 16, 18, 19, 20, 21, 22, 20, 22, 23,
  ];
  const EMPTY_OPTS = {};
  const SHADOW_OPTS = { tint: [0.08, 0.08, 0.08], alpha: 0.42, blend: true };
  const FLASH_OPTS = { tint: [1.45, 0.28, 0.28] };
  const CHARGE_OPTS = { tint: [2.1, 2.1, 2.1] };
  const GLINT_OPTS = { tint: [1.08, 0.96, 1.18], alpha: 0.32, blend: true };
  const DEFAULT_HAND_POSE = { pos: [0.50, -0.50, -0.82], rot: [0, 0, 0], scale: 0.68, grip: [0, -0.22, 0] };
  const BLOCK_HAND_POSE = { pos: [0.56, -0.57, -0.94], rot: [0.06, 0.78, 0], scale: 0.40, grip: [0, 0, 0] };
  const FIRST_PERSON_ARM_LENGTH_PIXELS = 12;
  const FIRST_PERSON_WRIST_OFFSET_PIXELS = 6;
  const FIRST_PERSON_ARM_SCALE = Object.freeze([4 / 16, FIRST_PERSON_ARM_LENGTH_PIXELS / 16, 4 / 16]);
  const HAND_GRIP_REACH = -FIRST_PERSON_WRIST_OFFSET_PIXELS / 16;

  Renderer.init = function (cv) {
    canvas = cv;
    gl = GL.init(cv);
    if (!gl) return false;
    progWorld = GL.program(VS_WORLD, FS_WORLD);
    progSky = GL.program(VS_SKY, FS_SKY);
    progLine = GL.program(VS_LINE, FS_LINE);
    Textures.build();
    if (typeof Entities !== 'undefined' && Entities.prewarmGeometry) Entities.prewarmGeometry();
    atlasTex = GL.textureFromCanvas(Textures.atlas.canvas, true);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    // fullscreen quad for sky
    this._skyVB = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this._skyVB);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    this._lineVB = gl.createBuffer();
    this._lineCap = 0;
    this._dynVB = gl.createBuffer();
    this._dynIB = gl.createBuffer();
    this._dynVCap = 0;
    this._dynICap = 0;
    this._proj = M().create();
    this._view = M().create();
    this._pv = M().create();
    this._handProj = M().create();
    this._handBase = M().create();
    this._handArmMV = M().create();
    this._handItemMV = M().create();
    this._handArmPV = M().create();
    this._handItemPV = M().create();
    this._handAnchor = new Float32Array(3);
    this._handLight = new Float32Array(2);
    this._handAnimPose = {};
    this._handBlockPose = {};
    this._planes = Array.from({ length: 6 }, () => new Float32Array(4));
    this._skyColors = { top: new Float32Array(3), bot: new Float32Array(3) };
    this._fogCol = new Float32Array(3);
    this._visibleAlpha = [];
    this._alphaPool = [];
    this._celestialVerts = new Float32Array(4 * 7);
    this._quadIndices = GL.makeIndexArray([0, 1, 2, 0, 2, 3]);
    this._selectionVerts = new Float32Array(24 * 3);
    this._starDirs = new Float32Array(420 * 3);
    this._starVerts = new Float32Array(420 * 3);
    for (let i = 0; i < 420; i++) {
      const a = U.posRand(0x5A17, i, 1, 9) * Math.PI * 2;
      const y = U.posRand(0x5A17, i, 2, 9) * 2 - 1;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      this._starDirs[i * 3] = Math.cos(a) * r;
      this._starDirs[i * 3 + 1] = y;
      this._starDirs[i * 3 + 2] = Math.sin(a) * r;
    }
    this._weatherVerts = new Float32Array(96 * 2 * 3);
    this._crackMesh = {
      verts: new Float32Array(24 * 7),
      inds: GL.makeIndexArray(CUBE_INDICES),
      count: CUBE_INDICES.length,
    };
    this._handArmGpu = makeGpuPart();
    this._handItemGpu = makeGpuPart();
    this._entityGpu = {
      normal: makeGpuPart(), flash: makeGpuPart(), charge: makeGpuPart(),
      glint: makeGpuPart(), shadow: makeGpuPart(),
    };
    this._particleGpu = makeGpuPart();
    this._entityCacheKey = '';
    this._particleCacheKey = '';
    this._handItemId = null;
    this._handArmKey = 'steve:classic';
    uploadGpuPart(this._handArmGpu, playerArmMesh('steve', 'classic'));
    return true;
  };

  function makeGpuPart() {
    return { vb: gl.createBuffer(), ib: gl.createBuffer(), n: 0, indexed: true, vCap: 0, iCap: 0 };
  }

  function uploadPartBuffer(target, buffer, data, part, capKey, usage) {
    gl.bindBuffer(target, buffer);
    const bytes = data ? data.byteLength : 0;
    if (bytes === 0) return;
    if (part[capKey] < bytes) {
      let cap = Math.max(256, part[capKey] || 0);
      while (cap < bytes) cap *= 2;
      gl.bufferData(target, cap, usage);
      part[capKey] = cap;
    }
    gl.bufferSubData(target, 0, data);
  }

  function uploadGpuPart(part, mesh, usage) {
    usage = usage || gl.STATIC_DRAW;
    uploadPartBuffer(gl.ARRAY_BUFFER, part.vb, mesh.verts, part, 'vCap', usage);
    part.indexed = mesh.indexed !== false;
    if (part.indexed) {
      uploadPartBuffer(gl.ELEMENT_ARRAY_BUFFER, part.ib, mesh.inds, part, 'iCap', usage);
    }
    part.n = mesh.count;
  }

  Renderer.uploadSection = function (key, section, mesh) {
    let entry = chunkGL.get(key);
    if (!entry) {
      const comma = key.indexOf(',');
      entry = { cx: +key.slice(0, comma), cz: +key.slice(comma + 1), sections: new Map() };
      chunkGL.set(key, entry);
    }
    let sec = entry.sections.get(section);
    if (!sec) {
      sec = { opaque: makeGpuPart(), alpha: makeGpuPart() };
      entry.sections.set(section, sec);
    }
    uploadGpuPart(sec.opaque, mesh.opaque);
    uploadGpuPart(sec.alpha, mesh.alpha);
  };
  Renderer.uploadChunk = function (key, mesh) { this.uploadSection(key, 0, mesh); };

  Renderer.dropChunk = function (key) {
    const e = chunkGL.get(key);
    if (!e) return;
    for (const sec of e.sections.values()) {
      for (const p of ['opaque', 'alpha']) {
        gl.deleteBuffer(sec[p].vb);
        gl.deleteBuffer(sec[p].ib);
      }
    }
    chunkGL.delete(key);
  };
  Renderer.clearChunks = function () {
    for (const key of Array.from(chunkGL.keys())) this.dropChunk(key);
    this._entityCacheKey = '';
    this._particleCacheKey = '';
  };
  Renderer.refreshTextureAtlas = function () {
    if (!gl || !atlasTex || !Textures.atlas) return false;
    gl.bindTexture(gl.TEXTURE_2D, atlasTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, Textures.atlas.canvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    handMeshCache.clear();
    this._handItemId = null;
    this._handArmKey = '';
    this._entityCacheKey = '';
    this._particleCacheKey = '';
    return true;
  };
  Renderer.hasChunk = (key) => chunkGL.has(key);
  Renderer.hasSection = (key, section) => {
    const e = chunkGL.get(key);
    return !!(e && e.sections.has(section));
  };
  Renderer.chunkKeys = () => chunkGL.keys();

  function bindWorldAttribs(prog) {
    const stride = 7 * 4;
    gl.enableVertexAttribArray(prog.attr.aPos);
    gl.vertexAttribPointer(prog.attr.aPos, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(prog.attr.aUV);
    gl.vertexAttribPointer(prog.attr.aUV, 2, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(prog.attr.aLight);
    gl.vertexAttribPointer(prog.attr.aLight, 2, gl.FLOAT, false, stride, 20);
  }

  function drawGpuPart(part) {
    if (!part || part.n === 0) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, part.vb);
    bindWorldAttribs(progWorld);
    if (part.indexed) {
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, part.ib);
      gl.drawElements(gl.TRIANGLES, part.n, GL.indexType, 0);
    } else {
      gl.drawArrays(gl.TRIANGLES, 0, part.n);
    }
  }

  function uploadDynamic(target, buffer, data, capProp) {
    gl.bindBuffer(target, buffer);
    const bytes = data.byteLength;
    if (Renderer[capProp] < bytes) {
      let cap = Math.max(256, Renderer[capProp] || 0);
      while (cap < bytes) cap *= 2;
      gl.bufferData(target, cap, gl.DYNAMIC_DRAW);
      Renderer[capProp] = cap;
    }
    gl.bufferSubData(target, 0, data);
  }

  function compatibleIndices(inds) {
    if (GL.uintIndices || inds instanceof Uint16Array) return inds;
    return new Uint16Array(inds);
  }

  function skyColors(dayF, underwater, out) {
    // dayF 0..1
    const t = U.smoothstep(U.clamp((dayF - 0.15) / 0.5, 0, 1));
    const top = out.top, bot = out.bot;
    top[0] = U.lerp(NIGHT_TOP[0], DAY_TOP[0], t);
    top[1] = U.lerp(NIGHT_TOP[1], DAY_TOP[1], t);
    top[2] = U.lerp(NIGHT_TOP[2], DAY_TOP[2], t);
    bot[0] = U.lerp(NIGHT_BOTTOM[0], DAY_BOTTOM[0], t);
    bot[1] = U.lerp(NIGHT_BOTTOM[1], DAY_BOTTOM[1], t);
    bot[2] = U.lerp(NIGHT_BOTTOM[2], DAY_BOTTOM[2], t);
    if (underwater) {
      top[0] *= 0.2; top[1] *= 0.35; top[2] *= 0.7;
      bot[0] *= 0.2; bot[1] *= 0.35; bot[2] *= 0.7;
    }
    return out;
  }

  // draw one frame
  // state: {world, player, dayF, viewDist, mining, uiCrack, fov}
  Renderer.frame = function (st) {
    const w = canvas.width, h = canvas.height;
    gl.viewport(0, 0, w, h);
    const p = st.player;
    const alpha = st.interpAlpha === undefined ? 1 : U.clamp(st.interpAlpha, 0, 1);
    const px = U.lerp(p.prevX === undefined ? p.x : p.prevX, p.x, alpha);
    const py = U.lerp(p.prevY === undefined ? p.y : p.prevY, p.y, alpha);
    const pz = U.lerp(p.prevZ === undefined ? p.z : p.prevZ, p.z, alpha);
    const cameraBlock = st.world.getBlock(Math.floor(px), Math.floor(py + p.eye), Math.floor(pz));
    const cameraInsideOpaque = Blocks.isOpaque(cameraBlock);
    const underwater = Physics.headInLiquid(st.world, p, 'water');
    const cols = skyColors(st.dayF, underwater, this._skyColors);
    const rain = st.world.rainStrength || 0;
    if (rain > 0) {
      for (let i = 0; i < 3; i++) {
        cols.top[i] = U.lerp(cols.top[i], i === 2 ? 0.43 : 0.34, rain * 0.62);
        cols.bot[i] = U.lerp(cols.bot[i], i === 2 ? 0.48 : 0.39, rain * 0.55);
      }
    }
    const fogCol = this._fogCol;
    fogCol[0] = (cols.top[0] + cols.bot[0]) / 2;
    fogCol[1] = (cols.top[1] + cols.bot[1]) / 2;
    fogCol[2] = (cols.top[2] + cols.bot[2]) / 2;
    const biome = st.world.biomeAt(Math.floor(px), Math.floor(pz));
    if (biome === 'nether') {
      cols.top[0] = 0.16; cols.top[1] = 0.035; cols.top[2] = 0.028;
      cols.bot[0] = 0.31; cols.bot[1] = 0.07; cols.bot[2] = 0.045;
    } else if (biome === 'end') {
      cols.top[0] = 0.025; cols.top[1] = 0.018; cols.top[2] = 0.040;
      cols.bot[0] = 0.055; cols.bot[1] = 0.042; cols.bot[2] = 0.075;
    }
    fogCol[0] = (cols.top[0] + cols.bot[0]) / 2;
    fogCol[1] = (cols.top[1] + cols.bot[1]) / 2;
    fogCol[2] = (cols.top[2] + cols.bot[2]) / 2;
    const biomeFog = biome === 'swamp' ? [0.34, 0.45, 0.37] :
      biome === 'desert' ? [0.72, 0.66, 0.51] :
      biome === 'snow' ? [0.72, 0.77, 0.81] :
      biome === 'mountain' ? [0.52, 0.60, 0.67] :
      biome === 'nether' ? [0.30, 0.055, 0.035] : biome === 'end' ? [0.06, 0.045, 0.085] : null;
    if (biomeFog && !underwater) {
      for (let i = 0; i < 3; i++) fogCol[i] = U.lerp(fogCol[i], biomeFog[i], 0.22);
    }
    const eyeY = Math.floor(py + p.eye);
    const skyLight = st.world.getSky(Math.floor(px), eyeY, Math.floor(pz));
    const caveFog = !underwater && eyeY < 64 ? U.clamp((7 - skyLight) / 7, 0, 0.78) : 0;
    if (caveFog > 0) {
      fogCol[0] = U.lerp(fogCol[0], 0.035, caveFog);
      fogCol[1] = U.lerp(fogCol[1], 0.045, caveFog);
      fogCol[2] = U.lerp(fogCol[2], 0.055, caveFog);
    }

    gl.clearColor(fogCol[0], fogCol[1], fogCol[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // ---- sky gradient ----
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(progSky.prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, this._skyVB);
    gl.enableVertexAttribArray(progSky.attr.aPos);
    gl.vertexAttribPointer(progSky.attr.aPos, 2, gl.FLOAT, false, 0, 0);
    gl.uniform3fv(progSky.uni.uTop, cols.top);
    gl.uniform3fv(progSky.uni.uBottom, cols.bot);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.enable(gl.DEPTH_TEST);

    // ---- matrices ----
    const proj = this._proj;
    const eyeX = px;
    const eyeZ = pz;
    M().perspective(proj, U.rad(st.fov || 75), w / h, 0.08, 480);
    const view = this._view;
    const hurt = U.clamp((p.hurtTime || 0) / 0.5, 0, 1);
    const hurtRoll = -Math.sin(Math.pow(hurt, 4) * Math.PI) * 0.055;
    M().fpsView(view, eyeX, py + p.eye, eyeZ, p.yaw, p.pitch, hurtRoll);
    const pv = this._pv;
    M().mul(pv, proj, view);
    const planes = GL.frustumPlanes(pv, this._planes);

    // ---- rotating night sky ----
    if (biome !== 'nether' && biome !== 'end') this.drawStars(st, pv, px, py, pz);

    // ---- sun & moon (textured quads on world prog, no fog) ----
    if (biome !== 'nether' && biome !== 'end') this.drawCelestial(st, pv, px, py, pz);

    // ---- world chunks ----
    gl.useProgram(progWorld.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, atlasTex);
    gl.uniform1i(progWorld.uni.uTex, 0);
    gl.uniform1f(progWorld.uni.uDay, st.dayF);
    gl.uniform3fv(progWorld.uni.uFogCol, fogCol);
    const vd = st.viewDist * 16;
    gl.uniform1f(progWorld.uni.uFogNear, underwater ? 6 : U.lerp(vd * 0.72, 10, caveFog));
    gl.uniform1f(progWorld.uni.uFogFar, underwater ? 26 : U.lerp(vd * 0.98, 42, caveFog));
    gl.uniform1f(progWorld.uni.uAlphaCut, 0.5);
    gl.uniform1f(progWorld.uni.uBright, 1.0);
    gl.uniform1f(progWorld.uni.uLightOverride, 0.0);
    gl.uniform3f(progWorld.uni.uCamera, px, py + p.eye, pz);
    gl.uniform3fv(progWorld.uni.uTint, WHITE);
    gl.uniform1f(progWorld.uni.uAlpha, 1.0);
    gl.uniformMatrix4fv(progWorld.uni.uPV, false, pv);

    const visibleAlpha = this._visibleAlpha;
    let alphaCount = 0;
    const pcx = Math.floor(px) >> 4, pcz = Math.floor(pz) >> 4;
    const chunkRadius = st.viewDist + 1;
    if (cameraInsideOpaque) gl.disable(gl.CULL_FACE);
    else gl.enable(gl.CULL_FACE);
    for (const entry of chunkGL.values()) {
      const x0 = entry.cx * 16, z0 = entry.cz * 16;
      const dx = (x0 + 8) - px, dz = (z0 + 8) - pz;
      const cdx = entry.cx - pcx, cdz = entry.cz - pcz;
      if (cdx * cdx + cdz * cdz > chunkRadius * chunkRadius) continue;
      for (const [section, sec] of entry.sections) {
        const y0 = section * World.SEC_H;
        if (!GL.boxInFrustum(planes, x0, y0, z0, x0 + 16, y0 + World.SEC_H, z0 + 16)) continue;
        drawGpuPart(sec.opaque);
        if (sec.alpha.n) {
          const dy = y0 + World.SEC_H * 0.5 - (py + p.eye);
          const item = this._alphaPool[alphaCount] || (this._alphaPool[alphaCount] = { part: null, d2: 0 });
          item.part = sec.alpha;
          item.d2 = dx * dx + dy * dy + dz * dz;
          visibleAlpha[alphaCount++] = item;
        }
      }
    }
    gl.enable(gl.CULL_FACE);

    // ---- entities ----
    const networkVersion = typeof Network !== 'undefined' && Network.renderVersion ? Network.renderVersion() : 0;
    const entityCacheKey = (Entities.renderVersion ? Entities.renderVersion() : 0) + '|' + networkVersion + '|' +
      Math.floor(px / 4) + ',' + Math.floor(py / 4) + ',' + Math.floor(pz / 4);
    if (entityCacheKey !== this._entityCacheKey) {
      const ent = Entities.buildGeometry(st.world, px, py, pz);
      uploadGpuPart(this._entityGpu.normal, ent.normal, gl.DYNAMIC_DRAW);
      uploadGpuPart(this._entityGpu.flash, ent.flash, gl.DYNAMIC_DRAW);
      uploadGpuPart(this._entityGpu.charge, ent.charge, gl.DYNAMIC_DRAW);
      uploadGpuPart(this._entityGpu.glint, ent.glint, gl.DYNAMIC_DRAW);
      uploadGpuPart(this._entityGpu.shadow, ent.shadow, gl.DYNAMIC_DRAW);
      this._entityCacheKey = entityCacheKey;
    }
    if (this._entityGpu.shadow.n) this.drawPreparedDynamic(this._entityGpu.shadow, SHADOW_OPTS);
    if (this._entityGpu.normal.n) this.drawPreparedDynamic(this._entityGpu.normal, EMPTY_OPTS);
    if (this._entityGpu.flash.n) this.drawPreparedDynamic(this._entityGpu.flash, FLASH_OPTS);
    if (this._entityGpu.charge.n) this.drawPreparedDynamic(this._entityGpu.charge, CHARGE_OPTS);
    if (this._entityGpu.glint.n) this.drawPreparedDynamic(this._entityGpu.glint, GLINT_OPTS);

    // ---- crack overlay ----
    if (st.mining) {
      const m = st.mining;
      const stage = Math.min(7, Math.floor((m.progress / m.total) * 8));
      this.drawCrack(m.x, m.y, m.z, stage, m.id);
    }

    // ---- particles ----
    const particleVersion = Entities.particleRenderVersion ? Entities.particleRenderVersion() : 0;
    const particleCacheKey = particleVersion + '|' + Math.round(p.yaw * 64) + ',' + Math.round(p.pitch * 64);
    if (particleCacheKey !== this._particleCacheKey) {
      uploadGpuPart(this._particleGpu, Entities.buildParticleGeometry(p.yaw, p.pitch), gl.DYNAMIC_DRAW);
      this._particleCacheKey = particleCacheKey;
    }
    if (this._particleGpu.n) this.drawPreparedDynamic(this._particleGpu, EMPTY_OPTS);

    // ---- alpha pass (water), back-to-front ----
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    gl.useProgram(progWorld.prog);
    gl.uniform1f(progWorld.uni.uAlphaCut, 0.02);
    gl.uniform3fv(progWorld.uni.uTint, WHITE);
    gl.uniform1f(progWorld.uni.uAlpha, 1.0);
    gl.uniformMatrix4fv(progWorld.uni.uPV, false, pv);
    visibleAlpha.length = alphaCount;
    visibleAlpha.sort((a, b) => b.d2 - a.d2);
    for (const entry of visibleAlpha) drawGpuPart(entry.part);
    gl.enable(gl.CULL_FACE);
    gl.depthMask(true);
    gl.disable(gl.BLEND);

    // ---- rain / snow around the camera ----
    if (!underwater) this.drawWeather(st, pv, px, py, pz);

    // ---- selection wireframe ----
    if (st.sel) this.drawSelection(st.sel, pv);

    // ---- held item (own clear of depth) ----
    this.drawHand(st, w / h);
  };

  Renderer.drawStars = function (st, pv, px, py, pz) {
    const night = U.clamp((0.48 - st.dayF) * 2.4, 0, 1) * (1 - (st.world.rainStrength || 0));
    if (night <= 0.01) return;
    const ang = st.world.timeOfDay * Math.PI * 2;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const dirs = this._starDirs, verts = this._starVerts;
    for (let i = 0; i < dirs.length; i += 3) {
      const dx = dirs[i], dy = dirs[i + 1], dz = dirs[i + 2];
      verts[i] = px + (dx * ca - dy * sa) * 330;
      verts[i + 1] = py + (dx * sa + dy * ca) * 330;
      verts[i + 2] = pz + dz * 330;
    }
    gl.useProgram(progLine.prog);
    uploadDynamic(gl.ARRAY_BUFFER, this._lineVB, verts, '_lineCap');
    gl.enableVertexAttribArray(progLine.attr.aPos);
    gl.vertexAttribPointer(progLine.attr.aPos, 3, gl.FLOAT, false, 0, 0);
    gl.uniformMatrix4fv(progLine.uni.uPV, false, pv);
    gl.uniform4f(progLine.uni.uCol, 0.92, 0.94, 1.0, night);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.drawArrays(gl.POINTS, 0, verts.length / 3);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  };

  Renderer.drawWeather = function (st, pv, px, py, pz) {
    const strength = st.world.rainStrength || 0;
    if (strength < 0.02) return;
    const snow = st.world.biomeAt(Math.floor(px), Math.floor(pz)) === 'snow';
    const verts = this._weatherVerts;
    const fallSpeed = snow ? 3.2 : 18;
    const length = snow ? 0.35 : 2.4;
    for (let i = 0; i < 96; i++) {
      const rx = U.posRand(st.world.seed ^ 0x71A1, i, 1, 3);
      const rz = U.posRand(st.world.seed ^ 0x71A1, i, 2, 3);
      const phase = U.posRand(st.world.seed ^ 0x71A1, i, 3, 3) * 24;
      const x = px + (rx - 0.5) * 28;
      const z = pz + (rz - 0.5) * 28;
      const y = py - 5 + U.mod(phase - st.world.time * fallSpeed, 24);
      const o = i * 6;
      if (st.world.getSky(Math.floor(x), Math.floor(y), Math.floor(z)) < 13) {
        verts[o] = verts[o + 3] = px + 10000;
        verts[o + 1] = verts[o + 4] = py;
        verts[o + 2] = verts[o + 5] = pz;
        continue;
      }
      verts[o] = x; verts[o + 1] = y; verts[o + 2] = z;
      verts[o + 3] = snow ? x + 0.12 : x; verts[o + 4] = y - length; verts[o + 5] = snow ? z + 0.08 : z;
    }
    gl.useProgram(progLine.prog);
    uploadDynamic(gl.ARRAY_BUFFER, this._lineVB, verts, '_lineCap');
    gl.enableVertexAttribArray(progLine.attr.aPos);
    gl.vertexAttribPointer(progLine.attr.aPos, 3, gl.FLOAT, false, 0, 0);
    gl.uniformMatrix4fv(progLine.uni.uPV, false, pv);
    if (snow) gl.uniform4f(progLine.uni.uCol, 0.96, 0.98, 1.0, strength * 0.82);
    else gl.uniform4f(progLine.uni.uCol, 0.58, 0.68, 0.82, strength * 0.72);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.drawArrays(gl.LINES, 0, verts.length / 3);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  };

  Renderer.drawCelestial = function (st, pv, px, py, pz) {
    // sun/moon quads positioned on sky sphere
    const t = st.world.timeOfDay;
    const ang = (t - 0.25) * Math.PI * 2; // sunrise east at t=0.25
    const dist = 350;
    const draw = (tile, a, size) => {
      const sx = px + Math.cos(a) * dist;
      const sy = py + Math.sin(a) * dist;
      const sz = pz;
      if (sy < py - 60) return;
      const uv = Textures.uv(tile);
      const upX = Math.cos(a + Math.PI / 2) * size;
      const upY = Math.sin(a + Math.PI / 2) * size;
      const verts = this._celestialVerts;
      for (let k = 0; k < 4; k++) {
        const i = k * 7, sr = CELESTIAL_SIGNS[k][0], su = CELESTIAL_SIGNS[k][1];
        verts[i] = sx + upX * su;
        verts[i + 1] = sy + upY * su;
        verts[i + 2] = sz + size * sr;
        verts[i + 3] = (k === 0 || k === 3) ? uv[0] : uv[2];
        verts[i + 4] = k < 2 ? uv[3] : uv[1];
        verts[i + 5] = 1.6; verts[i + 6] = 1.6;
      }
      gl.useProgram(progWorld.prog);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, atlasTex);
      gl.uniform1i(progWorld.uni.uTex, 0);
      gl.uniform1f(progWorld.uni.uDay, 1.0);
      gl.uniform3fv(progWorld.uni.uFogCol, BLACK);
      gl.uniform1f(progWorld.uni.uFogNear, 9999);
      gl.uniform1f(progWorld.uni.uFogFar, 10000);
      gl.uniform1f(progWorld.uni.uAlphaCut, 0.4);
      gl.uniform1f(progWorld.uni.uBright, 1.0);
      gl.uniform1f(progWorld.uni.uLightOverride, 0.0);
      gl.uniform3f(progWorld.uni.uCamera, px, py, pz);
      gl.uniform3fv(progWorld.uni.uTint, WHITE);
      gl.uniform1f(progWorld.uni.uAlpha, 1.0);
      gl.uniformMatrix4fv(progWorld.uni.uPV, false, pv);
      gl.depthMask(false);
      gl.disable(gl.CULL_FACE);
      uploadDynamic(gl.ARRAY_BUFFER, this._dynVB, verts, '_dynVCap');
      bindWorldAttribs(progWorld);
      uploadDynamic(gl.ELEMENT_ARRAY_BUFFER, this._dynIB, this._quadIndices, '_dynICap');
      gl.drawElements(gl.TRIANGLES, 6, GL.indexType, 0);
      gl.enable(gl.CULL_FACE);
      gl.depthMask(true);
    };
    draw('sun', ang, 22);
    draw('moon', ang + Math.PI, 16);
  };

  Renderer.drawDynamic = function (mesh, opts) {
    if (!mesh || mesh.count === 0) return;
    opts = opts || EMPTY_OPTS;
    const useBlend = !!opts.blend;
    gl.useProgram(progWorld.prog);
    gl.uniform1f(progWorld.uni.uLightOverride, 0.0);
    gl.uniform3fv(progWorld.uni.uTint, opts.tint || WHITE);
    gl.uniform1f(progWorld.uni.uAlpha, opts.alpha === undefined ? 1.0 : opts.alpha);
    if (useBlend) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
    }
    uploadDynamic(gl.ARRAY_BUFFER, this._dynVB, mesh.verts, '_dynVCap');
    bindWorldAttribs(progWorld);
    gl.disable(gl.CULL_FACE);
    if (mesh.indexed === false) {
      gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
    } else {
      const inds = compatibleIndices(mesh.inds);
      uploadDynamic(gl.ELEMENT_ARRAY_BUFFER, this._dynIB, inds, '_dynICap');
      gl.drawElements(gl.TRIANGLES, mesh.count, GL.indexType, 0);
    }
    gl.enable(gl.CULL_FACE);
    if (useBlend) {
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }
  };

  Renderer.drawPreparedDynamic = function (part, opts) {
    if (!part || part.n === 0) return;
    opts = opts || EMPTY_OPTS;
    const useBlend = !!opts.blend;
    gl.useProgram(progWorld.prog);
    gl.uniform1f(progWorld.uni.uLightOverride, 0.0);
    gl.uniform3fv(progWorld.uni.uTint, opts.tint || WHITE);
    gl.uniform1f(progWorld.uni.uAlpha, opts.alpha === undefined ? 1.0 : opts.alpha);
    if (useBlend) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
    }
    gl.disable(gl.CULL_FACE);
    drawGpuPart(part);
    gl.enable(gl.CULL_FACE);
    if (useBlend) {
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }
  };

  function blockBounds(id) {
    const shape = Blocks.get(id).collision;
    return shape || { x: 0, y: 0, z: 0, w: 1, h: 1, d: 1 };
  }

  Renderer.drawCrack = function (x, y, z, stage, id) {
    const uv = Textures.uv('crack_' + stage);
    const e = 0.002;
    const bounds = blockBounds(id);
    const x0 = x + bounds.x - e, y0 = y + bounds.y - e, z0 = z + bounds.z - e;
    const x1 = x + bounds.x + bounds.w + e;
    const y1 = y + bounds.y + bounds.h + e;
    const z1 = z + bounds.z + bounds.d + e;
    const verts = this._crackMesh.verts;
    let vertex = 0;
    for (const face of CRACK_FACES) {
      for (let k = 0; k < 4; k++) {
        const corner = face[k], i = vertex++ * 7;
        verts[i] = corner & 1 ? x1 : x0;
        verts[i + 1] = corner & 2 ? y1 : y0;
        verts[i + 2] = corner & 4 ? z1 : z0;
        verts[i + 3] = (k === 0 || k === 3) ? uv[0] : uv[2];
        verts[i + 4] = k < 2 ? uv[3] : uv[1];
        verts[i + 5] = 1; verts[i + 6] = 1;
      }
    }
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(-1, -1);
    this.drawDynamic(this._crackMesh);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.disable(gl.BLEND);
  };

  Renderer.drawSelection = function (sel, pv) {
    const e = 0.003;
    const bounds = blockBounds(sel.id);
    const x0 = sel.x + bounds.x - e, y0 = sel.y + bounds.y - e, z0 = sel.z + bounds.z - e;
    const x1 = sel.x + bounds.x + bounds.w + e;
    const y1 = sel.y + bounds.y + bounds.h + e;
    const z1 = sel.z + bounds.z + bounds.d + e;
    const L = this._selectionVerts;
    for (let i = 0; i < BOX_EDGES.length; i++) {
      const corner = BOX_EDGES[i], j = i * 3;
      L[j] = corner & 1 ? x1 : x0;
      L[j + 1] = corner & 2 ? y1 : y0;
      L[j + 2] = corner & 4 ? z1 : z0;
    }
    gl.useProgram(progLine.prog);
    uploadDynamic(gl.ARRAY_BUFFER, this._lineVB, L, '_lineCap');
    gl.enableVertexAttribArray(progLine.attr.aPos);
    gl.vertexAttribPointer(progLine.attr.aPos, 3, gl.FLOAT, false, 0, 0);
    gl.uniformMatrix4fv(progLine.uni.uPV, false, pv);
    gl.uniform4f(progLine.uni.uCol, 0.05, 0.05, 0.05, 0.85);
    gl.lineWidth(2);
    gl.drawArrays(gl.LINES, 0, 24);
  };

  function handAnimationPose(action, phase, eatProgress, out, heldStyle) {
    out = out || {};
    phase = U.clamp(phase || 0, 0, 1);
    const rootSwing = Math.sin(Math.sqrt(phase) * Math.PI);
    const rootCycle = Math.sin(Math.sqrt(phase) * Math.PI * 2);
    const squaredSwing = Math.sin(phase * phase * Math.PI);
    const linearSwing = Math.sin(phase * Math.PI);
    out.x = 0; out.y = 0; out.z = 0;
    out.rx = 0; out.ry = 0; out.rz = 0;
    if (action === 'attack' || action === 'mine') {
      const bladeFirst = heldStyle === 'sword' || heldStyle === 'pickaxe' || heldStyle === 'axe' ||
        heldStyle === 'shovel' || heldStyle === 'hoe';
      const strength = action === 'mine' ? 0.88 : 1;
      out.x = -rootSwing * (bladeFirst ? 0.14 : 0.40) * strength;
      out.y = rootCycle * (bladeFirst ? 0.08 : 0.20) * strength;
      out.z = -linearSwing * (bladeFirst ? 0.10 : 0.20) * strength;
      out.rx = -rootCycle * (bladeFirst ? 0.20 : 0.35) * strength;
      out.ry = -squaredSwing * (bladeFirst ? 0.22 : 0.35) * strength;
      out.rz = rootSwing * (bladeFirst ? 1.10 : -1.40) * strength;
    } else if (action === 'use') {
      out.x = -linearSwing * 0.08;
      out.y = -linearSwing * 0.11;
      out.z = -linearSwing * 0.06;
      out.rx = -linearSwing * 0.28;
      out.rz = linearSwing * 0.12;
    } else if (action === 'eat') {
      eatProgress = U.clamp(eatProgress || 0, 0, 1);
      const raise = 1 - Math.pow(1 - eatProgress, 27);
      const chew = Math.abs(Math.cos(phase * Math.PI * 2)) * 0.045;
      out.x = raise * 0.30;
      out.y = raise * 0.21 + chew;
      out.z = -raise * 0.16;
      out.rx = -raise * 0.38;
      out.ry = raise * 0.72;
      out.rz = raise * 0.24 + rootCycle * 0.04;
    } else if (action === 'bow') {
      const draw = U.smoothstep(phase);
      out.x = -0.16 * draw;
      out.y = 0.10 * draw;
      out.z = -0.10 * draw;
      out.rx = -0.32 * draw;
      out.ry = 0.48 * draw;
      out.rz = -0.18 * draw;
    } else if (action === 'fish') {
      const cast = U.smoothstep(Math.min(1, phase * 4));
      out.x = -0.08 * cast;
      out.y = 0.04 * cast;
      out.rx = -0.45 * cast;
      out.rz = 0.16 * cast;
    } else if (action === 'block') {
      const raise = U.smoothstep(phase);
      out.x = -0.24 * raise;
      out.y = 0.16 * raise;
      out.z = -0.20 * raise;
      out.rx = -0.30 * raise;
      out.ry = 0.50 * raise;
      out.rz = -0.78 * raise;
    }
    return out;
  }

  Renderer.handAnimationPose = function (action, phase, eatProgress, heldStyle) {
    return handAnimationPose(action, phase, eatProgress, {}, heldStyle);
  };

  function buildFirstPersonArmFrame(out, hasItem, rx, ry, rz, blockBlend) {
    M().identity(out);
    M().translate(out, out, hasItem ? 0.69 : 0.62, hasItem ? -0.69 : -0.62, hasItem ? -0.69 : -0.90);
    M().rotX(out, out, rx * U.lerp(0.65, 0.90, blockBlend));
    M().rotY(out, out, ry * U.lerp(0.65, 0.90, blockBlend));
    M().rotZ(out, out, rz * U.lerp(0.80, 0.94, blockBlend));
    M().rotX(out, out, 0.10);
    M().rotY(out, out, hasItem ? -0.46 : -0.50);
    M().rotZ(out, out, hasItem ? -0.34 : -0.20);
    return out;
  }

  function handAnchorFromFrame(frame, out) {
    out = out || new Float32Array(3);
    out[0] = frame[12] + frame[8] * HAND_GRIP_REACH;
    out[1] = frame[13] + frame[9] * HAND_GRIP_REACH;
    out[2] = frame[14] + frame[10] * HAND_GRIP_REACH;
    return out;
  }

  Renderer.drawHand = function (st, aspect) {
    const p = st.player;
    const s = p.held();
    const heldItem = s ? Items.get(s.id) : null;
    const heldStyle = heldItem && heldItem.tool ? heldItem.tool.type :
      heldItem && heldItem.block && heldItem.handModel !== 'sprite' ? 'block' : 'item';
    const handSkin = Textures.normalizeSkin ? Textures.normalizeSkin(p.skin) : 'steve';
    const handModel = p.modelType === 'slim' ? 'slim' : 'classic';
    const handArmKey = handSkin + ':' + handModel;
    if (this._handArmKey !== handArmKey) {
      uploadGpuPart(this._handArmGpu, playerArmMesh(handSkin, handModel));
      this._handArmKey = handArmKey;
    }
    gl.clear(gl.DEPTH_BUFFER_BIT);
    const proj = this._handProj;
    const handFov = U.clamp(st.fov || 75, 30, 110);
    M().perspective(proj, U.rad(handFov), aspect, 0.05, 10);
    const action = p.handAction || 'idle';
    const duration = Math.max(0.001, p.handActionDuration || 0.30);
    const phase = action === 'idle' ? 0 : U.clamp((p.handActionTime || 0) / duration, 0, 1);
    const equip = U.smoothstep(U.clamp((p.equipTime || 0) / (p.equipDuration || 0.18), 0, 1));
    const bob = 0;
    const eatProgress = action === 'eat' ? 1 - U.clamp((p.eatTimer || 1.2) / 1.2, 0, 1) : 0;
    const anim = handAnimationPose(action, phase, eatProgress, this._handAnimPose, heldStyle);
    const blockBlend = U.clamp(p.blockBlend === undefined ? (p.isBlocking ? 1 : 0) : p.blockBlend, 0, 1);
    let moveX = anim.x, moveY = anim.y, moveZ = anim.z;
    let actionRX = anim.rx, actionRY = anim.ry, actionRZ = anim.rz;
    if (blockBlend > 0) {
      const guard = handAnimationPose('block', blockBlend, 0, this._handBlockPose);
      const strikeWeight = action === 'attack' ? 0.52 : 0;
      moveX = guard.x + anim.x * strikeWeight;
      moveY = guard.y + anim.y * strikeWeight;
      moveZ = guard.z + anim.z * strikeWeight;
      actionRX = guard.rx + anim.rx * strikeWeight;
      actionRY = guard.ry + anim.ry * strikeWeight;
      actionRZ = guard.rz + anim.rz * strikeWeight;
    }
    if ((p.blockHitTime || 0) > 0) {
      const hitPhase = 1 - U.clamp(p.blockHitTime / 0.18, 0, 1);
      const recoil = Math.sin(hitPhase * Math.PI);
      moveX += recoil * 0.055;
      moveZ += recoil * 0.12;
      actionRY -= recoil * 0.16;
      actionRZ += recoil * 0.09;
    }
    const base = this._handBase;
    M().identity(base);
    M().translate(base, base, moveX, bob - equip * 0.68 + moveY, moveZ);

    const armMV = this._handArmMV;
    buildFirstPersonArmFrame(armMV, !!s, actionRX, actionRY, actionRZ, blockBlend);
    const handAnchor = handAnchorFromFrame(armMV, this._handAnchor);
    // Skin limbs are authored along Y. Rotate the complete arm into the
    // first-person reach direction without rotating or stretching its UVs.
    M().rotX(armMV, armMV, Math.PI * 0.5);
    M().scale(armMV, armMV,
      FIRST_PERSON_ARM_SCALE[0], FIRST_PERSON_ARM_SCALE[1], FIRST_PERSON_ARM_SCALE[2]);
    M().mul(armMV, base, armMV);
    M().mul(this._handArmPV, proj, armMV);

    let itemPV = null;
    if (s) {
      const it = heldItem;
      const pose = it && it.display && it.display.firstPerson
        ? it.display.firstPerson
        : (it && it.handPose ? it.handPose : (it && it.block ? BLOCK_HAND_POSE : DEFAULT_HAND_POSE));
      const itemMV = this._handItemMV;
      M().identity(itemMV);
      const itemPos = pose.attach === 'hand' ? handAnchor : pose.pos;
      M().translate(itemMV, itemMV, itemPos[0], itemPos[1], itemPos[2]);
      M().rotX(itemMV, itemMV, actionRX);
      M().rotY(itemMV, itemMV, actionRY);
      M().rotZ(itemMV, itemMV, actionRZ);
      M().rotX(itemMV, itemMV, pose.rot[0]);
      M().rotY(itemMV, itemMV, pose.rot[1]);
      M().rotZ(itemMV, itemMV, pose.rot[2]);
      const grip = pose.grip || DEFAULT_HAND_POSE.grip;
      M().translate(itemMV, itemMV, -grip[0] * pose.scale, -grip[1] * pose.scale, -grip[2] * pose.scale);
      M().scale(itemMV, itemMV, pose.scale, pose.scale, pose.scale);
      M().mul(itemMV, base, itemMV);
      itemPV = this._handItemPV;
      M().mul(itemPV, proj, itemMV);

      if (this._handItemId !== s.id) {
        const mesh = handMeshForItem(s.id);
        uploadGpuPart(this._handItemGpu, mesh);
        this._handItemId = s.id;
      }
    }

    // ambient light at player position
    const lx = Math.floor(p.x), ly = Math.floor(p.y + 1), lz = Math.floor(p.z);
    const sky = st.world.getSky(lx, ly, lz) / 15;
    const heldDef = s && Blocks.get(s.id);
    const heldLight = heldDef ? (heldDef.light || 0) / 15 : 0;
    const blk = Math.max(st.world.getBlkLight(lx, ly, lz) / 15, heldLight);
    this._handLight[0] = sky;
    this._handLight[1] = blk;
    gl.useProgram(progWorld.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, atlasTex);
    gl.uniform1i(progWorld.uni.uTex, 0);
    gl.uniform1f(progWorld.uni.uDay, st.dayF);
    gl.uniform3fv(progWorld.uni.uFogCol, BLACK);
    gl.uniform1f(progWorld.uni.uFogNear, 999);
    gl.uniform1f(progWorld.uni.uFogFar, 1000);
    gl.uniform1f(progWorld.uni.uAlphaCut, 0.4);
    gl.uniform1f(progWorld.uni.uBright, 1.0);
    gl.uniform1f(progWorld.uni.uLightOverride, 1.0);
    gl.uniform3f(progWorld.uni.uCamera, 0, 0, 0);
    gl.uniform2fv(progWorld.uni.uHandLight, this._handLight);
    gl.uniform3fv(progWorld.uni.uTint, WHITE);
    gl.uniform1f(progWorld.uni.uAlpha, 1.0);
    gl.disable(gl.CULL_FACE);
    gl.uniformMatrix4fv(progWorld.uni.uPV, false, this._handArmPV);
    drawGpuPart(this._handArmGpu);
    if (s && itemPV) {
      gl.uniformMatrix4fv(progWorld.uni.uPV, false, itemPV);
      drawGpuPart(this._handItemGpu);
    }
    gl.enable(gl.CULL_FACE);
    gl.uniform1f(progWorld.uni.uLightOverride, 0.0);
  };

  function blockMesh(id) {
    const def = Blocks.get(id);
    const t = def.tex;
    const tilesFor = (tile) => ({
      right: tile || t.all || t.side, left: tile || t.all || t.side,
      top: tile || t.all || t.top || t.side, bottom: tile || t.all || t.bottom || t.side,
      back: tile || t.all || t.side, front: tile || t.all || t.front || t.side,
    });
    const boxes = Blocks.itemModelBoxes ? Blocks.itemModelBoxes(id) : [];
    if (boxes.length) {
      return mergeMeshes(boxes.map(box => cubeGeom(tilesFor(box.tile), {
        x0: box.x - 0.5, x1: box.x + box.w - 0.5,
        y0: box.y - 0.5, y1: box.y + box.h - 0.5,
        z0: box.z - 0.5, z1: box.z + box.d - 0.5,
      })));
    }
    return cubeGeom(tilesFor(null));
  }
  function playerArmMesh(skin, modelType) {
    const tex = (part) => ({
      right:'skin.' + skin + '.' + part + '.right', left:'skin.' + skin + '.' + part + '.left',
      top:'skin.' + skin + '.' + part + '.top', bottom:'skin.' + skin + '.' + part + '.bottom',
      back:'skin.' + skin + '.' + part + '.back', front:'skin.' + skin + '.' + part + '.front',
    });
    const armHalf = modelType === 'slim' ? 0.375 : 0.5;
    const wristY = -FIRST_PERSON_WRIST_OFFSET_PIXELS / FIRST_PERSON_ARM_LENGTH_PIXELS;
    const shoulderY = wristY + 1;
    const base = cubeGeom(tex('armR'), { x0:-armHalf, x1:armHalf, y0:wristY, y1:shoulderY, z0:-0.5, z1:0.5 });
    const sleeveThickness = 1 / 16;
    const sleeveLength = 0.25 / FIRST_PERSON_ARM_LENGTH_PIXELS;
    const sleeve = cubeGeom(tex('sleeveR'), {
      x0:-armHalf-sleeveThickness, x1:armHalf+sleeveThickness,
      y0:wristY-sleeveLength, y1:shoulderY+sleeveLength,
      z0:-0.5-sleeveThickness, z1:0.5+sleeveThickness,
    });
    return mergeMeshes([base, sleeve]);
  }
  Renderer.playerArmModelStats = function (modelType) {
    const mesh = playerArmMesh(modelType === 'slim' ? 'alex' : 'steve', modelType);
    let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity, zMin = Infinity, zMax = -Infinity;
    for (let i = 0; i < mesh.verts.length; i += 7) {
      xMin = Math.min(xMin, mesh.verts[i]);
      xMax = Math.max(xMax, mesh.verts[i]);
      yMin = Math.min(yMin, mesh.verts[i + 1]);
      yMax = Math.max(yMax, mesh.verts[i + 1]);
      zMin = Math.min(zMin, mesh.verts[i + 2]);
      zMax = Math.max(zMax, mesh.verts[i + 2]);
    }
    const baseWidth = modelType === 'slim' ? 0.75 : 1;
    return {
      baseWidth, width: xMax - xMin,
      lengthAxis: 'y',
      lengthPixels: FIRST_PERSON_ARM_LENGTH_PIXELS,
      wristOffsetPixels: FIRST_PERSON_WRIST_OFFSET_PIXELS,
      gripReach: HAND_GRIP_REACH,
      baseDimensions: [baseWidth * FIRST_PERSON_ARM_SCALE[0], FIRST_PERSON_ARM_SCALE[1], FIRST_PERSON_ARM_SCALE[2]],
      sleeveDimensions: [
        (xMax - xMin) * FIRST_PERSON_ARM_SCALE[0],
        (yMax - yMin) * FIRST_PERSON_ARM_SCALE[1],
        (zMax - zMin) * FIRST_PERSON_ARM_SCALE[2],
      ],
    };
  };
  function mergeMeshes(meshes) {
    const verts = [], inds = [];
    let vertexOffset = 0;
    for (const mesh of meshes) {
      for (const value of mesh.verts) verts.push(value);
      for (const index of mesh.inds) inds.push(index + vertexOffset);
      vertexOffset += mesh.verts.length / 7;
    }
    return { verts:new Float32Array(verts), inds:GL.makeIndexArray(inds), count:inds.length };
  }
  function handMeshForItem(id) {
    let mesh = handMeshCache.get(id);
    if (mesh) return mesh;
    const it = Items.get(id);
    if (it && it.handModel === 'sprite') {
      const def = it.block ? Blocks.get(id) : null;
      const tile = it.tex || (def && (def.tex.icon || def.tex.all || def.tex.front || def.tex.side)) || 'stick';
      mesh = extrudedSpriteMesh(tile);
    } else {
      mesh = it && it.block ? blockMesh(id) : extrudedSpriteMesh(it && it.tex ? it.tex : 'stick');
    }
    handMeshCache.set(id, mesh);
    return mesh;
  }
  function cubeGeom(tiles, bounds) {
    const verts = [], inds = [];
    const C = [];
    const x0 = bounds && bounds.x0 !== undefined ? bounds.x0 : -0.5;
    const x1 = bounds && bounds.x1 !== undefined ? bounds.x1 : 0.5;
    const y0 = bounds ? bounds.y0 : -0.5, y1 = bounds ? bounds.y1 : 0.5;
    const z0 = bounds && bounds.z0 !== undefined ? bounds.z0 : -0.5;
    const z1 = bounds && bounds.z1 !== undefined ? bounds.z1 : 0.5;
    for (let i = 0; i < 8; i++) C.push([(i & 1) ? x1 : x0, (i & 2) ? y1 : y0, (i & 4) ? z1 : z0]);
    const F = [
      { c: [5, 1, 3, 7], t: tiles.right, sh: 0.75 }, { c: [0, 4, 6, 2], t: tiles.left, sh: 0.75 },
      { c: [2, 6, 7, 3], t: tiles.top, sh: 1.0 }, { c: [0, 1, 5, 4], t: tiles.bottom, sh: 0.6 },
      { c: [4, 5, 7, 6], t: tiles.back, sh: 0.85 }, { c: [1, 0, 2, 3], t: tiles.front, sh: 0.85 },
    ];
    let n = 0;
    for (const f of F) {
      const uv = Textures.uv(f.t);
      const q = [[uv[0], uv[3]], [uv[2], uv[3]], [uv[2], uv[1]], [uv[0], uv[1]]];
      for (let k = 0; k < 4; k++) {
        const p = C[f.c[k]];
        verts.push(p[0], p[1], p[2], q[k][0], q[k][1], f.sh, f.sh);
      }
      inds.push(n, n + 1, n + 2, n, n + 2, n + 3);
      n += 4;
    }
    return { verts: new Float32Array(verts), inds: GL.makeIndexArray(inds), count: inds.length };
  }
  function extrudedSpriteMesh(tile) {
    const uv = Textures.uv(tile || 'stick');
    const verts = [], inds = [];
    const thick = 1 / 32;
    const addQuad = (points, tex, shade) => {
      const base = verts.length / 7;
      for (let i = 0; i < 4; i++) {
        const p = points[i], t = tex[i];
        verts.push(p[0], p[1], p[2], t[0], t[1], shade, shade);
      }
      inds.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };
    const q = [[uv[0], uv[3]], [uv[2], uv[3]], [uv[2], uv[1]], [uv[0], uv[1]]];
    addQuad([[-0.5, -0.5, thick], [0.5, -0.5, thick], [0.5, 0.5, thick], [-0.5, 0.5, thick]], q, 1.0);
    addQuad([[0.5, -0.5, -thick], [-0.5, -0.5, -thick], [-0.5, 0.5, -thick], [0.5, 0.5, -thick]], [q[1], q[0], q[3], q[2]], 0.82);

    const rect = Textures.rect(tile || 'stick');
    const pixels = Textures.atlas.canvas.getContext('2d').getImageData(rect[0], rect[1], 16, 16).data;
    const opaque = (x, y) => x >= 0 && x < 16 && y >= 0 && y < 16 && pixels[(y * 16 + x) * 4 + 3] >= 128;
    const du = (uv[2] - uv[0]) / 16, dv = (uv[3] - uv[1]) / 16;
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      if (!opaque(x, y)) continue;
      const x0 = x / 16 - 0.5, x1 = (x + 1) / 16 - 0.5;
      const y0 = 0.5 - (y + 1) / 16, y1 = 0.5 - y / 16;
      const tc = [uv[0] + (x + 0.5) * du, uv[1] + (y + 0.5) * dv];
      const edgeUV = [tc, tc, tc, tc];
      if (!opaque(x - 1, y)) addQuad([[x0, y0, -thick], [x0, y0, thick], [x0, y1, thick], [x0, y1, -thick]], edgeUV, 0.72);
      if (!opaque(x + 1, y)) addQuad([[x1, y0, thick], [x1, y0, -thick], [x1, y1, -thick], [x1, y1, thick]], edgeUV, 0.72);
      if (!opaque(x, y - 1)) addQuad([[x0, y1, thick], [x1, y1, thick], [x1, y1, -thick], [x0, y1, -thick]], edgeUV, 0.90);
      if (!opaque(x, y + 1)) addQuad([[x0, y0, -thick], [x1, y0, -thick], [x1, y0, thick], [x0, y0, thick]], edgeUV, 0.62);
    }
    return { verts: new Float32Array(verts), inds: GL.makeIndexArray(inds), count: inds.length, indexed: true };
  }

  Renderer.handModelStats = function (id) {
    const mesh = handMeshForItem(id);
    let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
    let zMin = Infinity, zMax = -Infinity;
    for (let i = 0; i < mesh.verts.length; i += 7) {
      xMin = Math.min(xMin, mesh.verts[i]);
      xMax = Math.max(xMax, mesh.verts[i]);
      yMin = Math.min(yMin, mesh.verts[i + 1]);
      yMax = Math.max(yMax, mesh.verts[i + 1]);
      zMin = Math.min(zMin, mesh.verts[i + 2]);
      zMax = Math.max(zMax, mesh.verts[i + 2]);
    }
    const it = Items.get(id);
    return {
      vertices: mesh.verts.length / 7,
      triangles: mesh.count / 3,
      width: xMax - xMin,
      height: yMax - yMin,
      depth: zMax - zMin,
      hasPose: !!(it && ((it.display && it.display.firstPerson) || it.handPose)),
      display: it && it.display ? it.display : null,
    };
  };

  Renderer.handAttachmentStats = function (id, action, phase) {
    const item = Items.get(id);
    if (!item) return null;
    const pose = item.display && item.display.firstPerson
      ? item.display.firstPerson
      : (item.handPose || (item.block ? BLOCK_HAND_POSE : DEFAULT_HAND_POSE));
    const style = item.tool ? item.tool.type : item.block && item.handModel !== 'sprite' ? 'block' : 'item';
    const anim = handAnimationPose(action || 'idle', phase || 0, 0, {}, style);
    const armFrame = M().create();
    buildFirstPersonArmFrame(armFrame, true, anim.rx, anim.ry, anim.rz, 0);
    const anchor = handAnchorFromFrame(armFrame);
    const itemMatrix = M().create();
    const pos = pose.attach === 'hand' ? anchor : pose.pos;
    M().translate(itemMatrix, itemMatrix, pos[0], pos[1], pos[2]);
    M().rotX(itemMatrix, itemMatrix, anim.rx);
    M().rotY(itemMatrix, itemMatrix, anim.ry);
    M().rotZ(itemMatrix, itemMatrix, anim.rz);
    M().rotX(itemMatrix, itemMatrix, pose.rot[0]);
    M().rotY(itemMatrix, itemMatrix, pose.rot[1]);
    M().rotZ(itemMatrix, itemMatrix, pose.rot[2]);
    const grip = pose.grip || DEFAULT_HAND_POSE.grip;
    M().translate(itemMatrix, itemMatrix, -grip[0] * pose.scale, -grip[1] * pose.scale, -grip[2] * pose.scale);
    M().scale(itemMatrix, itemMatrix, pose.scale, pose.scale, pose.scale);
    const gripWorld = [
      itemMatrix[0] * grip[0] + itemMatrix[4] * grip[1] + itemMatrix[8] * grip[2] + itemMatrix[12],
      itemMatrix[1] * grip[0] + itemMatrix[5] * grip[1] + itemMatrix[9] * grip[2] + itemMatrix[13],
      itemMatrix[2] * grip[0] + itemMatrix[6] * grip[1] + itemMatrix[10] * grip[2] + itemMatrix[14],
    ];
    return {
      attached:pose.attach === 'hand', anchor:Array.from(anchor), gripWorld,
      gap:Math.hypot(gripWorld[0] - anchor[0], gripWorld[1] - anchor[1], gripWorld[2] - anchor[2]),
    };
  };

  Renderer.projectPoint = function (x, y, z) {
    const m = this._pv;
    if (!m) return null;
    const clipX = m[0] * x + m[4] * y + m[8] * z + m[12];
    const clipY = m[1] * x + m[5] * y + m[9] * z + m[13];
    const clipZ = m[2] * x + m[6] * y + m[10] * z + m[14];
    const clipW = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (!Number.isFinite(clipW) || clipW <= 0.001) return null;
    const nx = clipX / clipW, ny = clipY / clipW, nz = clipZ / clipW;
    if (nx < -1.08 || nx > 1.08 || ny < -1.08 || ny > 1.08 || nz < -1 || nz > 1) return null;
    return { x: nx * 0.5 + 0.5, y: 0.5 - ny * 0.5, depth: nz };
  };

  Renderer.stats = function () {
    return { chunks: chunkGL.size };
  };

  window.Renderer = Renderer;
})();
