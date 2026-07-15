/* mesher.js — chunk geometry builder: culling, AO, smooth light, special shapes */
'use strict';
(function () {
  const CH_H = World.CH_H;

  // Face defs: n normal, r right tangent, u up tangent, v[4] corners BL,BR,TR,TL
  // uv order: BL(0,1) BR(1,1) TR(1,0) TL(0,0)  (v down in atlas)
  const FACES = [
    { n: [1, 0, 0], r: [0, 0, -1], u: [0, 1, 0], v: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], shade: 0.6 },
    { n: [-1, 0, 0], r: [0, 0, 1], u: [0, 1, 0], v: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], shade: 0.6 },
    { n: [0, 1, 0], r: [1, 0, 0], u: [0, 0, -1], v: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], shade: 1.0 },
    { n: [0, -1, 0], r: [1, 0, 0], u: [0, 0, 1], v: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], shade: 0.5 },
    { n: [0, 0, 1], r: [1, 0, 0], u: [0, 1, 0], v: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], shade: 0.8 },
    { n: [0, 0, -1], r: [-1, 0, 0], u: [0, 1, 0], v: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], shade: 0.8 },
  ];
  const CORNER_SIGNS = [[-1, -1], [1, -1], [1, 1], [-1, 1]]; // (right, up) per BL,BR,TR,TL
  const AO_F = [0.42, 0.62, 0.82, 1.0];

  function faceTile(def, face, facing) {
    const t = def.tex;
    if (t.all) return t.all;
    const n = FACES[face].n;
    if (n[1] === 1) return t.top || t.side;
    if (n[1] === -1) return t.bottom || t.side;
    const frontFace = [5, 0, 4, 1][facing === undefined ? 0 : (facing & 3)];
    if (t.front && face === frontFace) return t.front;
    return t.side;
  }

  class Builder {
    constructor() {
      this.verts = [];   // x,y,z,u,v,sky,blk
      this.inds = [];
      this.n = 0;
    }
    reset() {
      this.verts.length = 0;
      this.inds.length = 0;
      this.n = 0;
      return this;
    }
    quad(p0, p1, p2, p3, uv, l0, l1, l2, l3, flip) {
      const V = this.verts;
      const push = (p, uvI, l) => {
        V.push(p[0], p[1], p[2], uv[uvI][0], uv[uvI][1], l[0], l[1]);
      };
      push(p0, 0, l0); push(p1, 1, l1); push(p2, 2, l2); push(p3, 3, l3);
      const b = this.n;
      if (flip) this.inds.push(b + 1, b + 2, b + 3, b + 1, b + 3, b);
      else this.inds.push(b, b + 1, b + 2, b, b + 2, b + 3);
      this.n += 4;
    }
    cubeQuad(pos, uv, lights, flip) {
      const V = this.verts;
      const u0 = uv[0], v0 = uv[1], u1 = uv[2], v1 = uv[3];
      V.push(
        pos[0], pos[1], pos[2], u0, v1, lights[0], lights[1],
        pos[3], pos[4], pos[5], u1, v1, lights[3], lights[4],
        pos[6], pos[7], pos[8], u1, v0, lights[6], lights[7],
        pos[9], pos[10], pos[11], u0, v0, lights[9], lights[10]
      );
      const b = this.n;
      if (flip) this.inds.push(b + 1, b + 2, b + 3, b + 1, b + 3, b);
      else this.inds.push(b, b + 1, b + 2, b, b + 2, b + 3);
      this.n += 4;
    }
    build(pool) {
      const useUint = typeof GL === 'undefined' || GL.uintIndices !== false;
      if (!useUint && this.n > 65535) {
        const needed = this.inds.length * 7;
        const verts = pool ? growTyped(pool.expandedVerts, Float32Array, needed) : new Float32Array(needed);
        if (pool) pool.expandedVerts = verts;
        for (let i = 0; i < this.inds.length; i++) {
          const src = this.inds[i] * 7;
          const dst = i * 7;
          for (let k = 0; k < 7; k++) verts[dst + k] = this.verts[src + k];
        }
        if (!pool) return { verts, inds: null, count: this.inds.length, indexed: false };
        const result = pool.result || (pool.result = {});
        result.verts = verts.subarray(0, needed);
        result.inds = null;
        result.count = this.inds.length;
        result.indexed = false;
        return result;
      }
      if (pool) {
        const IndexArray = useUint ? Uint32Array : Uint16Array;
        pool.verts = growTyped(pool.verts, Float32Array, this.verts.length);
        pool.inds = growTyped(pool.inds, IndexArray, this.inds.length);
        pool.verts.set(this.verts, 0);
        pool.inds.set(this.inds, 0);
        const result = pool.result || (pool.result = {});
        result.verts = pool.verts.subarray(0, this.verts.length);
        result.inds = pool.inds.subarray(0, this.inds.length);
        result.count = this.inds.length;
        result.indexed = true;
        return result;
      }
      return {
        verts: new Float32Array(this.verts),
        inds: useUint ? new Uint32Array(this.inds) : new Uint16Array(this.inds),
        count: this.inds.length,
        indexed: true,
      };
    }
  }

  function growTyped(current, Type, needed) {
    if (current && current.constructor === Type && current.length >= needed) return current;
    let capacity = current && current.constructor === Type ? current.length : 256;
    while (capacity < needed) capacity *= 2;
    return new Type(capacity);
  }

  function subUV(uv, x0, y0, x1, y1) {
    // sub-rect of a tile's uv [u0,v0,u1,v1]; x,y in 0..1 tile space (y down)
    const du = uv[2] - uv[0], dv = uv[3] - uv[1];
    return [uv[0] + du * x0, uv[1] + dv * y0, uv[0] + du * x1, uv[1] + dv * y1];
  }
  function uvCorners(uv) {
    // BL,BR,TR,TL with v down
    return [[uv[0], uv[3]], [uv[2], uv[3]], [uv[2], uv[1]], [uv[0], uv[1]]];
  }

  function rotateUVCorners(corners, degrees) {
    const turns = (((Math.round((Number(degrees) || 0) / 90) % 4) + 4) % 4);
    if (!turns) return corners;
    return corners.map((value, index) => corners[(index + turns) & 3]);
  }

  const Mesher = {};
  const OPQ_BUILDER = new Builder();
  const ALP_BUILDER = new Builder();
  const RUNTIME_MESH_POOL = { opaque: {}, alpha: {}, result: {} };
  const FACE_POS = new Float32Array(12);
  const FACE_LIGHT = new Float32Array(12); // sky, block, AO per corner
  let smoothLighting = true;

  // Build mesh for chunk. Returns {opaque:{verts,inds,count}, alpha:{...}}
  Mesher.mesh = function (world, ch, section, pools, fastLighting) {
    const opq = OPQ_BUILDER.reset();
    const alp = ALP_BUILDER.reset();
    const useSmoothLighting = smoothLighting && !fastLighting;
    const ID = Blocks.ID;
    const bx = ch.cx * 16, bz = ch.cz * 16;
    const yStart = section === undefined ? 0 : section * World.SEC_H;
    const yEnd = section === undefined ? CH_H : Math.min(CH_H, yStart + World.SEC_H);

    const getB = (x, y, z) => world.getBlock(x, y, z);
    const opaqueAt = (x, y, z) => Blocks.isOpaque(getB(x, y, z));

    function vertexLight(x, y, z, face, ci, shade, out, oi) {
      // smooth: average base + side1 + side2 + corner cells (in front of face)
      const F = FACES[face];
      const nbx = x + F.n[0], nby = y + F.n[1], nbz = z + F.n[2];
      if (!useSmoothLighting) {
        out[oi] = world.getSky(nbx, nby, nbz) / 15 * shade;
        out[oi + 1] = world.getBlkLight(nbx, nby, nbz) / 15 * shade;
        out[oi + 2] = 1;
        return;
      }
      const [sr, su] = CORNER_SIGNS[ci];
      const s1x = nbx + F.r[0] * sr, s1y = nby + F.r[1] * sr, s1z = nbz + F.r[2] * sr;
      const s2x = nbx + F.u[0] * su, s2y = nby + F.u[1] * su, s2z = nbz + F.u[2] * su;
      const ccx = s1x + F.u[0] * su, ccy = s1y + F.u[1] * su, ccz = s1z + F.u[2] * su;
      const o1 = opaqueAt(s1x, s1y, s1z) ? 1 : 0;
      const o2 = opaqueAt(s2x, s2y, s2z) ? 1 : 0;
      const oc = opaqueAt(ccx, ccy, ccz) ? 1 : 0;
      const ao = AO_F[(o1 && o2) ? 0 : 3 - (o1 + o2 + oc)];
      let sSky = world.getSky(nbx, nby, nbz), sBlk = world.getBlkLight(nbx, nby, nbz), cnt = 1;
      if (!o1) { sSky += world.getSky(s1x, s1y, s1z); sBlk += world.getBlkLight(s1x, s1y, s1z); cnt++; }
      if (!o2) { sSky += world.getSky(s2x, s2y, s2z); sBlk += world.getBlkLight(s2x, s2y, s2z); cnt++; }
      if (!(o1 && o2) && !oc) { sSky += world.getSky(ccx, ccy, ccz); sBlk += world.getBlkLight(ccx, ccy, ccz); cnt++; }
      const m = ao * shade;
      out[oi] = (sSky / (cnt * 15)) * m;
      out[oi + 1] = (sBlk / (cnt * 15)) * m;
      out[oi + 2] = ao;
    }

    function cubeFace(b, x, y, z, face, tile, y0, y1, inset) {
      const F = FACES[face];
      const uv = Textures.uv(tile);
      let faceUV = uv;
      const lights = FACE_LIGHT;
      for (let ci = 0; ci < 4; ci++) vertexLight(x, y, z, face, ci, F.shade, lights, ci * 3);
      const flip = lights[2] + lights[8] < lights[5] + lights[11];
      const pos = FACE_POS;
      for (let ci = 0; ci < 4; ci++) {
        const c = F.v[ci];
        let px = c[0], py = c[1], pz = c[2];
        if (y0 !== undefined) py = py === 0 ? y0 : y1; // adjusted height
        if (inset) { px -= F.n[0] * inset; pz -= F.n[2] * inset; }
        const pi = ci * 3;
        pos[pi] = x + px; pos[pi + 1] = y + py; pos[pi + 2] = z + pz;
      }
      if (y0 !== undefined && F.n[1] === 0) {
        const dv = uv[3] - uv[1];
        faceUV = [uv[0], uv[1] + dv * (1 - y1), uv[2], uv[1] + dv * (1 - y0)];
      }
      b.cubeQuad(pos, faceUV, lights, flip);
    }

    function liquidCellHeight(x, y, z, id) {
      if (getB(x, y, z) !== id) return null;
      if (getB(x, y + 1, z) === id) return 1;
      const state = world.getState(x, y, z);
      const level = Number.isInteger(state) && state > 0 ? Math.min(7, state) : 0;
      return Math.max(4 / 16, 14 / 16 - level * 1.25 / 16);
    }

    function liquidCornerHeight(x, y, z, id, cornerX, cornerZ) {
      const xs = cornerX === 0 ? [-1, 0] : [0, 1];
      const zs = cornerZ === 0 ? [-1, 0] : [0, 1];
      let total = 0, weightTotal = 0;
      for (const dx of xs) for (const dz of zs) {
        const height = liquidCellHeight(x + dx, y, z + dz, id);
        if (height === null) continue;
        if (height >= 1) return 1;
        const weight = height >= 13 / 16 ? 2 : 1;
        total += height * weight;
        weightTotal += weight;
      }
      return weightTotal ? total / weightTotal : 14 / 16;
    }

    function liquidMesh(builder, x, y, z, def) {
      const id = def.id;
      const heights = [
        liquidCornerHeight(x, y, z, id, 0, 0),
        liquidCornerHeight(x, y, z, id, 1, 0),
        liquidCornerHeight(x, y, z, id, 1, 1),
        liquidCornerHeight(x, y, z, id, 0, 1),
      ];
      const tileUV = Textures.uv(def.tex.all);

      if (getB(x, y + 1, z) !== id) {
        const face = FACES[2];
        const points = face.v.map((corner) => {
          const index = corner[0] + corner[2] * 2;
          const mapped = index === 2 ? 3 : index === 3 ? 2 : index;
          return [x + corner[0], y + heights[mapped], z + corner[2]];
        });
        const light = ownLight(x, y + 1, z, face.shade);
        builder.quad(points[0], points[1], points[2], points[3], uvCorners(tileUV), light, light, light, light, false);
      }

      for (const faceIndex of [0, 1, 4, 5]) {
        const face = FACES[faceIndex];
        const neighbor = getB(x + face.n[0], y, z + face.n[2]);
        const neighborDef = Blocks.get(neighbor);
        if (neighbor === id || neighborDef.liquid || Blocks.isOpaque(neighbor)) continue;
        const points = face.v.map((corner) => {
          if (corner[1] === 0) return [x + corner[0], y, z + corner[2]];
          const index = corner[0] + corner[2] * 2;
          const mapped = index === 2 ? 3 : index === 3 ? 2 : index;
          return [x + corner[0], y + heights[mapped], z + corner[2]];
        });
        const topRight = points[2][1] - y;
        const topLeft = points[3][1] - y;
        const sideUV = [
          [tileUV[0], tileUV[3]], [tileUV[2], tileUV[3]],
          [tileUV[2], tileUV[3] - (tileUV[3] - tileUV[1]) * topRight],
          [tileUV[0], tileUV[3] - (tileUV[3] - tileUV[1]) * topLeft],
        ];
        const light = ownLight(x + face.n[0], y, z + face.n[2], face.shade);
        builder.quad(points[0], points[1], points[2], points[3], sideUV, light, light, light, light, false);
      }
    }

    function ownLight(x, y, z, shade) {
      return [world.getSky(x, y, z) / 15 * shade, world.getBlkLight(x, y, z) / 15 * shade];
    }

    function cuboid(b, x, y, z, box, tile) {
      const x0 = x + box.x, x1 = x0 + box.w;
      const y0 = y + box.y, y1 = y0 + box.h;
      const z0 = z + box.z, z1 = z0 + box.d;
      const faces = [
        { key:'right', p:[[x1,y0,z1],[x1,y0,z0],[x1,y1,z0],[x1,y1,z1]], shade:0.72 },
        { key:'left', p:[[x0,y0,z0],[x0,y0,z1],[x0,y1,z1],[x0,y1,z0]], shade:0.72 },
        { key:'top', p:[[x0,y1,z1],[x1,y1,z1],[x1,y1,z0],[x0,y1,z0]], shade:1.0 },
        { key:'bottom', p:[[x0,y0,z0],[x1,y0,z0],[x1,y0,z1],[x0,y0,z1]], shade:0.55 },
        { key:'back', p:[[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]], shade:0.84 },
        { key:'front', p:[[x1,y0,z0],[x0,y0,z0],[x0,y1,z0],[x1,y1,z0]], shade:0.84 },
      ];
      for (const face of faces) {
        const map = box.faces || box.tiles;
        const spec = map && map[face.key];
        if (spec === false || (map && !Object.prototype.hasOwnProperty.call(map, face.key))) continue;
        const texture = typeof spec === 'string' ? spec : (spec && (spec.texture || spec.tile)) || box.tile || tile;
        const baseUV = Textures.uv(texture);
        const rect = spec && spec.uv;
        const rawUV = rect ? subUV(baseUV, rect[0] / 16, rect[1] / 16, rect[2] / 16, rect[3] / 16) : baseUV;
        const uv = rotateUVCorners(uvCorners(rawUV), spec && spec.rotation);
        const light = ownLight(x, y + Math.floor(box.y + box.h), z, face.shade);
        b.quad(face.p[0], face.p[1], face.p[2], face.p[3], uv, light, light, light, light, false);
      }
    }

    function modelElement(b, x, y, z, element, fallbackTile) {
      const from = element.from || [0, 0, 0];
      const to = element.to || [16, 16, 16];
      const corners = new Array(8);
      for (let i = 0; i < 8; i++) {
        corners[i] = [
          (i & 1 ? to[0] : from[0]) / 16,
          (i & 2 ? to[1] : from[1]) / 16,
          (i & 4 ? to[2] : from[2]) / 16,
        ];
      }
      const rotation = element.rotation;
      if (rotation && rotation.angle) {
        const origin = rotation.origin || [8, 8, 8];
        const ox = origin[0] / 16, oy = origin[1] / 16, oz = origin[2] / 16;
        const angle = rotation.angle * Math.PI / 180;
        const c = Math.cos(angle), s = Math.sin(angle);
        for (const point of corners) {
          let px = point[0] - ox, py = point[1] - oy, pz = point[2] - oz;
          if (rotation.axis === 'x') {
            const ny = py * c - pz * s;
            pz = py * s + pz * c; py = ny;
          } else if (rotation.axis === 'y') {
            const nx = px * c - pz * s;
            pz = px * s + pz * c; px = nx;
          } else {
            const nx = px * c - py * s;
            py = px * s + py * c; px = nx;
          }
          point[0] = px + ox; point[1] = py + oy; point[2] = pz + oz;
        }
      }
      const modelRotation = element.modelRotation;
      if (modelRotation) {
        const rx = (Number(modelRotation.x) || 0) * Math.PI / 180;
        const ry = (Number(modelRotation.y) || 0) * Math.PI / 180;
        const rz = (Number(modelRotation.z) || 0) * Math.PI / 180;
        for (const point of corners) {
          let px = point[0] - 0.5, py = point[1] - 0.5, pz = point[2] - 0.5;
          if (rx) { const c = Math.cos(rx), s = Math.sin(rx), ny = py * c - pz * s; pz = py * s + pz * c; py = ny; }
          if (ry) { const c = Math.cos(ry), s = Math.sin(ry), nx = px * c - pz * s; pz = px * s + pz * c; px = nx; }
          if (rz) { const c = Math.cos(rz), s = Math.sin(rz), nx = px * c - py * s; py = px * s + py * c; px = nx; }
          point[0] = px + 0.5; point[1] = py + 0.5; point[2] = pz + 0.5;
        }
      }
      for (const point of corners) { point[0] += x; point[1] += y; point[2] += z; }
      const faces = [
        { key:'right', c:[5,1,3,7], shade:0.72 }, { key:'left', c:[0,4,6,2], shade:0.72 },
        { key:'top', c:[6,7,3,2], shade:1.0 }, { key:'bottom', c:[0,1,5,4], shade:0.55 },
        { key:'back', c:[4,5,7,6], shade:0.84 }, { key:'front', c:[1,0,2,3], shade:0.84 },
      ];
      const hasFaceMap = element.faces && Object.keys(element.faces).length > 0;
      for (const face of faces) {
        const spec = element.faces && element.faces[face.key];
        if (spec === false || (hasFaceMap && !Object.prototype.hasOwnProperty.call(element.faces, face.key))) continue;
        const texture = typeof spec === 'string' ? spec : (spec && spec.texture) || element.texture || fallbackTile;
        const baseUV = Textures.uv(texture);
        const rect = spec && spec.uv;
        const rawUV = rect ? subUV(baseUV, rect[0] / 16, rect[1] / 16, rect[2] / 16, rect[3] / 16) : baseUV;
        const uv = rotateUVCorners(uvCorners(rawUV), spec && spec.rotation);
        const light = ownLight(x, y + Math.floor(to[1] / 16), z, element.shade === false ? 1 : face.shade);
        b.quad(corners[face.c[0]], corners[face.c[1]], corners[face.c[2]], corners[face.c[3]], uv, light, light, light, light, false);
      }
    }

    function cross(b, x, y, z, tile) {
      const uv = uvCorners(Textures.uv(tile));
      const l = ownLight(x, y, z, 1.0);
      const a = 0.146, c = 0.854; // diagonal inset
      const quads = [
        [[x + a, y, z + a], [x + c, y, z + c], [x + c, y + 1, z + c], [x + a, y + 1, z + a]],
        [[x + c, y, z + c], [x + a, y, z + a], [x + a, y + 1, z + a], [x + c, y + 1, z + c]],
        [[x + a, y, z + c], [x + c, y, z + a], [x + c, y + 1, z + a], [x + a, y + 1, z + c]],
        [[x + c, y, z + a], [x + a, y, z + c], [x + a, y + 1, z + c], [x + c, y + 1, z + a]],
      ];
      for (const q of quads) b.quad(q[0], q[1], q[2], q[3], uv, l, l, l, l, false);
    }

    function torch(b, x, y, z, state, tile) {
      const uv = Textures.uv(tile || 'torch');
      const pose = Blocks.torchPose(state);
      const direction = pose.direction, wall = pose.wall, bottom = pose.bottom, top = pose.top;
      const ax = top[0] - bottom[0], ay = top[1] - bottom[1], az = top[2] - bottom[2];
      const invLength = 1 / Math.hypot(ax, ay, az);
      const nx = ax * invLength, ny = ay * invLength, nz = az * invLength;
      const half = pose.half;
      let ux, uy = 0, uz;
      if (wall) { ux = direction[1] * half; uz = -direction[0] * half; }
      else { ux = half; uz = 0; }
      const unitUx = ux / half, unitUz = uz / half;
      const vx = (ny * unitUz) * half;
      const vy = (nz * unitUx - nx * unitUz) * half;
      const vz = (-ny * unitUx) * half;
      const point = (center, su, sv) => [
        x + center[0] + ux * su + vx * sv,
        y + center[1] + uy * su + vy * sv,
        z + center[2] + uz * su + vz * sv,
      ];
      const b0 = point(bottom, -1, -1), b1 = point(bottom, 1, -1);
      const b2 = point(bottom, 1, 1), b3 = point(bottom, -1, 1);
      const t0 = point(top, -1, -1), t1 = point(top, 1, -1);
      const t2 = point(top, 1, 1), t3 = point(top, -1, 1);
      const sideUV = uvCorners(subUV(uv, 7 / 16, 6 / 16, 9 / 16, 1));
      const sides = [[b1,b2,t2,t1,0.72], [b3,b0,t0,t3,0.72], [b2,b3,t3,t2,0.84], [b0,b1,t1,t0,0.84]];
      for (const q of sides) {
        const light = ownLight(x, y, z, q[4]);
        b.quad(q[0], q[1], q[2], q[3], sideUV, light, light, light, light, false);
        b.quad(q[3], q[2], q[1], q[0], sideUV, light, light, light, light, false);
      }
      const topUV = uvCorners(subUV(uv, 7 / 16, 5 / 16, 9 / 16, 7 / 16));
      const topLight = ownLight(x, y, z, 1.0);
      b.quad(t3, t2, t1, t0, topUV, topLight, topLight, topLight, topLight, false);
      const bottomUV = uvCorners(subUV(uv, 7 / 16, 14 / 16, 9 / 16, 1));
      const bottomLight = ownLight(x, y, z, 0.55);
      b.quad(b0, b3, b2, b1, bottomUV, bottomLight, bottomLight, bottomLight, bottomLight, false);
    }

    function bed(b, x, y, z, def) {
      const l = ownLight(x, y, z, 1.0);
      const l2 = ownLight(x, y, z, 0.8);
      const h = 9 / 16;
      const top = uvCorners(Textures.uv(def.tex.top));
      b.quad([x, y + h, z + 1], [x + 1, y + h, z + 1], [x + 1, y + h, z], [x, y + h, z], top, l, l, l, l, false);
      const su = uvCorners(subUV(Textures.uv(def.tex.side), 0, 1 - h, 1, 1));
      b.quad([x, y, z + 1], [x + 1, y, z + 1], [x + 1, y + h, z + 1], [x, y + h, z + 1], su, l2, l2, l2, l2, false);
      b.quad([x + 1, y, z], [x, y, z], [x, y + h, z], [x + 1, y + h, z], su, l2, l2, l2, l2, false);
      b.quad([x + 1, y, z + 1], [x + 1, y, z], [x + 1, y + h, z], [x + 1, y + h, z + 1], su, l2, l2, l2, l2, false);
      b.quad([x, y, z], [x, y, z + 1], [x, y + h, z + 1], [x, y + h, z], su, l2, l2, l2, l2, false);
    }

    function ladder(b, x, y, z, state) {
      const uv = uvCorners(Textures.uv('ladder'));
      const l = ownLight(x, y, z, 1.0);
      const inset = 1 / 32;
      let q;
      if (state === 0) q = [[x + inset, y, z], [x + inset, y, z + 1], [x + inset, y + 1, z + 1], [x + inset, y + 1, z]];
      else if (state === 1) q = [[x + 1 - inset, y, z + 1], [x + 1 - inset, y, z], [x + 1 - inset, y + 1, z], [x + 1 - inset, y + 1, z + 1]];
      else if (state === 2) q = [[x + 1, y, z + inset], [x, y, z + inset], [x, y + 1, z + inset], [x + 1, y + 1, z + inset]];
      else q = [[x, y, z + 1 - inset], [x + 1, y, z + 1 - inset], [x + 1, y + 1, z + 1 - inset], [x, y + 1, z + 1 - inset]];
      b.quad(q[0], q[1], q[2], q[3], uv, l, l, l, l, false);
      b.quad(q[1], q[0], q[3], q[2], uv, l, l, l, l, false);
    }

    function rail(b, x, y, z, state) {
      const raw = Textures.uv('rail');
      const uv = state & 1
        ? [[raw[2], raw[3]], [raw[2], raw[1]], [raw[0], raw[1]], [raw[0], raw[3]]]
        : uvCorners(raw);
      const light = ownLight(x, y, z, 1.0);
      const py = y + 1 / 32;
      const q = [[x, py, z + 1], [x + 1, py, z + 1], [x + 1, py, z], [x, py, z]];
      b.quad(q[0], q[1], q[2], q[3], uv, light, light, light, light, false);
      b.quad(q[3], q[2], q[1], q[0], uv, light, light, light, light, false);
    }

    for (let y = yStart; y < yEnd; y++) {
      for (let lz = 0; lz < 16; lz++) {
        for (let lx = 0; lx < 16; lx++) {
          const id = ch.blocks[(lx | (lz << 4) | (y << 8))];
          if (id === 0) continue;
          const def = Blocks.get(id);
          const x = bx + lx, z = bz + lz;
          const state = (def.orientable || def.stateTextures || def.stateFamily) ? world.getState(x, y, z) : undefined;
          if (def.shape === 'cross') {
            const tile = def.stateTextures
              ? def.stateTextures[U.clamp(Number.isInteger(state) ? state : 0, 0, def.stateTextures.length - 1)]
              : def.tex.all;
            cross(opq, x, y, z, tile);
            continue;
          }
          if (def.shape === 'torch') { torch(opq, x, y, z, Number.isInteger(state) ? state : 0, def.tex.all); continue; }
          if (def.shape === 'bed') { bed(opq, x, y, z, def); continue; }
          if (def.shape === 'ladder') { ladder(opq, x, y, z, Number.isInteger(state) ? state : 3); continue; }
          if (def.shape === 'rail') { rail(opq, x, y, z, Number.isInteger(state) ? state : 0); continue; }
          if (def.shape === 'model') {
            const elementSource = def.modelElements;
            const elements = typeof elementSource === 'function'
              ? elementSource(world, x, y, z, Number.isInteger(state) ? state : 0)
              : elementSource;
            const source = def.modelBoxes || def.collisionBoxes || [];
            const boxes = typeof source === 'function'
              ? source(world, x, y, z, Number.isInteger(state) ? state : 0)
              : source;
            let tile = def.tex.all || def.tex.side || def.tex.top;
            if (id === ID.REDSTONE_WIRE && (state | 0) > 0) tile = 'redstone_wire_lit';
            if (elements && elements.length) {
              for (const element of elements) modelElement(opq, x, y, z, element, tile);
            } else {
              for (const box of boxes || []) cuboid(opq, x, y, z, box, box.tile || tile);
            }
            continue;
          }
          if (def.shape === 'portal') {
            const uv = uvCorners(Textures.uv(def.tex.all));
            const light = ownLight(x, y, z, 1.0);
            const py = y + 2 / 16;
            opq.quad([x, py, z + 1], [x + 1, py, z + 1], [x + 1, py, z], [x, py, z], uv, light, light, light, light, false);
            opq.quad([x, py, z], [x + 1, py, z], [x + 1, py, z + 1], [x, py, z + 1], uv, light, light, light, light, false);
            continue;
          }
          if (def.shape === 'nether_portal') {
            const uv = uvCorners(Textures.uv(def.tex.all));
            const light = ownLight(x, y, z, 1.0);
            const inset = 0.49;
            const alongX = (state | 0) === 0;
            const q = alongX
              ? [[x, y, z + inset], [x + 1, y, z + inset], [x + 1, y + 1, z + inset], [x, y + 1, z + inset]]
              : [[x + inset, y, z + 1], [x + inset, y, z], [x + inset, y + 1, z], [x + inset, y + 1, z + 1]];
            alp.quad(q[0], q[1], q[2], q[3], uv, light, light, light, light, false);
            alp.quad(q[1], q[0], q[3], q[2], uv, light, light, light, light, false);
            continue;
          }
          if (def.shape === 'stairs' || def.shape === 'fence') {
            const boxes = typeof def.collisionBoxes === 'function'
              ? def.collisionBoxes(world, x, y, z, Number.isInteger(state) ? state : 0)
              : def.collisionBoxes;
            for (const box of boxes || []) cuboid(opq, x, y, z, box, def.tex.all || def.tex.side);
            continue;
          }
          if (def.shape === 'slab') {
            const slabHeight = def.collision && def.collision.h ? def.collision.h : 0.5;
            for (let f = 0; f < 6; f++) {
              const F = FACES[f];
              const nb = getB(x + F.n[0], y + F.n[1], z + F.n[2]);
              if (F.n[1] < 0 && Blocks.isOpaque(nb)) continue;
              if (F.n[1] === 0 && (Blocks.isOpaque(nb) || nb === id)) continue;
              cubeFace(opq, x, y, z, f, faceTile(def, f), 0, slabHeight);
            }
            continue;
          }
          if (def.liquid) {
            liquidMesh(def.id === ID.LAVA ? opq : alp, x, y, z, def);
            continue;
          }
          if (def.shape === 'cactus') {
            for (let f = 0; f < 6; f++) {
              const F = FACES[f];
              if (F.n[1] === 0) {
                cubeFace(opq, x, y, z, f, def.tex.side, 0, 1, 1 / 16);
              } else {
                const nb = getB(x + F.n[0], y + F.n[1], z + F.n[2]);
                if (Blocks.isOpaque(nb) || nb === id) continue;
                cubeFace(opq, x, y, z, f, F.n[1] > 0 ? def.tex.top : def.tex.bottom);
              }
            }
            continue;
          }
          // regular cube
          for (let f = 0; f < 6; f++) {
            const F = FACES[f];
            const nb = getB(x + F.n[0], y + F.n[1], z + F.n[2]);
            const nd = Blocks.get(nb);
            if (Blocks.isOpaque(nb)) continue;
            if (nb === id && (def.transparent || def.liquid)) continue; // glass-glass, leaves-leaves keep? glass only
            if (nd.liquid && !def.transparent) {
              // solid face against water: still visible through water — draw it
            }
            cubeFace(opq, x, y, z, f, faceTile(def, f, state));
          }
        }
      }
    }

    if (pools) {
      pools.result.opaque = opq.build(pools.opaque);
      pools.result.alpha = alp.build(pools.alpha);
      return pools.result;
    }
    return { opaque: opq.build(), alpha: alp.build() };
  };
  Mesher.meshSection = function (world, ch, section) { return Mesher.mesh(world, ch, section); };
  // Runtime meshes are uploaded before the next call, so their staging arrays
  // can be reused instead of becoming garbage after every block edit.
  Mesher.meshSectionRuntime = function (world, ch, section, fastLighting) {
    return Mesher.mesh(world, ch, section, RUNTIME_MESH_POOL, fastLighting);
  };
  Mesher.setSmoothLighting = function (on) { smoothLighting = !!on; };
  Mesher.smoothLighting = function () { return smoothLighting; };

  window.Mesher = Mesher;
})();
