/* physics.js — swept AABB collision against the voxel world */
'use strict';
(function () {
  const Physics = {};
  const FULL_BLOCK = { x: 0, y: 0, z: 0, w: 1, h: 1, d: 1 };
  const BOX_WORK = { x: 0, y: 0, z: 0, w: 0, h: 0, d: 0 };
  const CLIP_WORK = [0, 0];
  const FLOW_WORK = [0, 0, 0];
  const FLOW_DIRECTIONS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  function shapesOf(world, def, x, y, z) {
    if (def.collisionBoxes) {
      const state = world.getState(x, y, z);
      return typeof def.collisionBoxes === 'function'
        ? def.collisionBoxes(world, x, y, z, Number.isInteger(state) ? state : 0)
        : def.collisionBoxes;
    }
    return [def.collision || FULL_BLOCK];
  }

  function overlapsShape(box, x, y, z, shape) {
    return box.x < x + shape.x + shape.w && box.x + box.w > x + shape.x &&
      box.y < y + shape.y + shape.h && box.y + box.h > y + shape.y &&
      box.z < z + shape.z + shape.d && box.z + box.d > z + shape.z;
  }

  function collidesAt(world, box) {
    const x0 = Math.floor(box.x), x1 = Math.floor(box.x + box.w);
    const y0 = Math.floor(box.y), y1 = Math.floor(box.y + box.h);
    const z0 = Math.floor(box.z), z1 = Math.floor(box.z + box.d);
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++)
        for (let z = z0; z <= z1; z++) {
          const id = world.getBlock(x, y, z);
          const def = Blocks.get(id);
          if (!def.solid) continue;
          for (const shape of shapesOf(world, def, x, y, z)) {
            if (overlapsShape(box, x, y, z, shape)) return true;
          }
        }
    return false;
  }

  // Move entity {x,y,z,vx,vy,vz,w,h,onGround} by dt using per-axis resolution.
  Physics.move = function (world, e, dt) {
    e.onGround = false;
    const steps = Math.max(1, Math.ceil((Math.max(Math.abs(e.vx), Math.abs(e.vy), Math.abs(e.vz)) * dt) / 0.4));
    const sdt = dt / steps;
    for (let s = 0; s < steps; s++) {
      moveAxis(world, e, 'x', e.vx * sdt);
      moveAxis(world, e, 'z', e.vz * sdt);
      const hit = moveAxis(world, e, 'y', e.vy * sdt);
      if (hit && e.vy <= 0) e.onGround = true;
    }
  };

  function boxAt(x, y, z, w, h) {
    BOX_WORK.x = x - w / 2;
    BOX_WORK.y = y;
    BOX_WORK.z = z - w / 2;
    BOX_WORK.w = w;
    BOX_WORK.h = h;
    BOX_WORK.d = w;
    return BOX_WORK;
  }
  function box(e) { return boxAt(e.x, e.y, e.z, e.w, e.h); }

  Physics.canOccupy = function (world, e, x, y, z) {
    return !collidesAt(world, boxAt(x, y, z, e.w, e.h));
  };
  Physics.resolvePenetration = function (world, e, maxLift) {
    if (Physics.canOccupy(world, e, e.x, e.y, e.z)) return false;
    const ox = e.x, oy = e.y, oz = e.z;
    const liftLimit = maxLift === undefined ? 3 : Math.max(0.1, maxLift);
    const moveTo = (x, y, z) => {
      if (!Physics.canOccupy(world, e, x, y, z)) return false;
      e.x = x; e.y = y; e.z = z;
      e.vx = e.vy = e.vz = 0;
      return true;
    };
    for (let lift = 0.05; lift <= liftLimit + 1e-6; lift += 0.05) {
      if (moveTo(ox, oy + lift, oz)) return true;
    }
    for (let radius = 0.25; radius <= 1.5 + 1e-6; radius += 0.25) {
      for (let lift = 0; lift <= Math.min(1.5, liftLimit) + 1e-6; lift += 0.5) {
        for (let direction = 0; direction < 8; direction++) {
          const angle = direction * Math.PI / 4;
          if (moveTo(ox + Math.cos(angle) * radius, oy + lift, oz + Math.sin(angle) * radius)) return true;
        }
      }
    }
    return false;
  };
  Physics.blockShapes = function (world, x, y, z) {
    return shapesOf(world, Blocks.get(world.getBlock(x, y, z)), x, y, z);
  };

  function pointSupported(world, x, feetY, z) {
    const bx = Math.floor(x), by = Math.floor(feetY - 0.05), bz = Math.floor(z);
    const def = Blocks.get(world.getBlock(bx, by, bz));
    if (!def.solid) return false;
    for (const shape of shapesOf(world, def, bx, by, bz)) {
      const top = by + shape.y + shape.h;
      if (x > bx + shape.x + 1e-5 && x < bx + shape.x + shape.w - 1e-5 &&
          z > bz + shape.z + 1e-5 && z < bz + shape.z + shape.d - 1e-5 &&
          feetY >= top - 0.03 && feetY <= top + 0.12) return true;
    }
    return false;
  }

  Physics.supportCount = function (world, e, x, y, z) {
    const half = Math.max(0.02, e.w / 2 - 0.04);
    let count = 0;
    if (pointSupported(world, x - half, y, z - half)) count++;
    if (pointSupported(world, x + half, y, z - half)) count++;
    if (pointSupported(world, x - half, y, z + half)) count++;
    if (pointSupported(world, x + half, y, z + half)) count++;
    return count;
  };

  Physics.clipSneakMovement = function (world, e, dx, dz) {
    const baseline = Math.max(1, Physics.supportCount(world, e, e.x, e.y, e.z));
    const valid = (mx, mz) => Physics.supportCount(world, e, e.x + mx, e.y, e.z + mz) >= baseline;
    const towardZero = (v) => Math.abs(v) <= 0.05 ? 0 : v - Math.sign(v) * 0.05;
    while (dx !== 0 && !valid(dx, 0)) dx = towardZero(dx);
    while (dz !== 0 && !valid(0, dz)) dz = towardZero(dz);
    while (dx !== 0 && dz !== 0 && !valid(dx, dz)) {
      dx = towardZero(dx);
      dz = towardZero(dz);
    }
    CLIP_WORK[0] = dx; CLIP_WORK[1] = dz;
    return CLIP_WORK;
  };

  Physics.findStepHeight = function (world, e, x, z, maxHeight) {
    if (Physics.canOccupy(world, e, x, e.y, z)) return 0;
    const max = maxHeight === undefined ? 1.05 : maxHeight;
    for (let h = 0.1; h <= max + 1e-6; h += 0.1) {
      const y = e.y + h;
      if (Physics.canOccupy(world, e, x, y, z) && Physics.supportCount(world, e, x, y, z) > 0) return h;
    }
    return 0;
  };

  function moveAxis(world, e, axis, d) {
    if (d === 0) return false;
    if (axis === 'x') e.x += d; else if (axis === 'y') e.y += d; else e.z += d;
    const b = box(e);
    if (!collidesAt(world, b)) return false;
    // collision — step back to contact
    if (axis === 'x') {
      resolve(world, e, 'x', d);
      e.vx = 0;
    } else if (axis === 'z') {
      resolve(world, e, 'z', d);
      e.vz = 0;
    } else {
      resolve(world, e, 'y', d);
      const grounded = d < 0;
      e.vy = 0;
      return grounded;
    }
    return false;
  }

  // Binary-search back the last axis move until no collision.
  function resolve(world, e, axis, d) {
    let lo = 0, hi = Math.abs(d);
    // current position is colliding; back off by up to |d|
    const sign = d > 0 ? 1 : -1;
    // undo full move then re-apply the max safe amount
    if (axis === 'x') e.x -= d; else if (axis === 'y') e.y -= d; else e.z -= d;
    for (let i = 0; i < 9; i++) {
      const mid = (lo + hi) / 2;
      if (axis === 'x') e.x += sign * mid;
      else if (axis === 'y') e.y += sign * mid;
      else e.z += sign * mid;
      const hit = collidesAt(world, box(e));
      if (axis === 'x') e.x -= sign * mid;
      else if (axis === 'y') e.y -= sign * mid;
      else e.z -= sign * mid;
      if (hit) hi = mid; else lo = mid;
    }
    const safe = lo * sign;
    if (axis === 'x') e.x += safe;
    else if (axis === 'y') e.y += safe;
    else e.z += safe;
  }

  // Attempt an auto-step up (for walking up 1-block ledges).
  Physics.tryStep = function (world, e, dx, dz) {
    if (!e.onGround) return false;
    const orig = { x: e.x, y: e.y, z: e.z };
    // is there a wall in the way at current level but open one block up?
    e.y += 1.02;
    if (collidesAt(world, box(e))) { e.x = orig.x; e.y = orig.y; e.z = orig.z; return false; }
    e.x += dx; e.z += dz;
    if (collidesAt(world, box(e))) { e.x = orig.x; e.y = orig.y; e.z = orig.z; return false; }
    // settle down onto the ledge
    let drop = 0;
    while (drop < 1.1) {
      e.y -= 0.05; drop += 0.05;
      if (collidesAt(world, box(e))) { e.y += 0.05; break; }
    }
    if (Math.abs(e.x - orig.x) < 1e-4 && Math.abs(e.z - orig.z) < 1e-4) {
      e.x = orig.x; e.y = orig.y; e.z = orig.z; return false;
    }
    return true;
  };

  Physics.isInLiquid = function (world, e, which) {
    const b = box(e);
    const x0 = Math.floor(b.x), x1 = Math.floor(b.x + b.w);
    const y0 = Math.floor(b.y), y1 = Math.floor(b.y + b.h);
    const z0 = Math.floor(b.z), z1 = Math.floor(b.z + b.d);
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++)
        for (let z = z0; z <= z1; z++) {
          const id = world.getBlock(x, y, z);
          if (which === 'water' && id === Blocks.ID.WATER) return true;
          if (which === 'lava' && id === Blocks.ID.LAVA) return true;
          if (!which && Blocks.get(id).liquid) return true;
        }
    return false;
  };

  Physics.touchesBlock = function (world, e, wanted) {
    const b = box(e);
    const x0 = Math.floor(b.x + 1e-5), x1 = Math.floor(b.x + b.w - 1e-5);
    const y0 = Math.floor(b.y + 1e-5), y1 = Math.floor(b.y + b.h - 1e-5);
    const z0 = Math.floor(b.z + 1e-5), z1 = Math.floor(b.z + b.d - 1e-5);
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++)
        for (let z = z0; z <= z1; z++)
          if (world.getBlock(x, y, z) === wanted) return true;
    return false;
  };

  Physics.headInLiquid = function (world, e, which) {
    const x = Math.floor(e.x), y = Math.floor(e.y + e.h - 0.1), z = Math.floor(e.z);
    const id = world.getBlock(x, y, z);
    if (which === 'water') return id === Blocks.ID.WATER;
    if (which === 'lava') return id === Blocks.ID.LAVA;
    return Blocks.get(id).liquid;
  };

  Physics.liquidFlow = function (world, e, which) {
    const wanted = which === 'lava' ? Blocks.ID.LAVA : Blocks.ID.WATER;
    const x = Math.floor(e.x), z = Math.floor(e.z);
    let y = Math.floor(e.y + Math.min(0.35, (e.h || 1.8) * 0.35));
    if (world.getBlock(x, y, z) !== wanted) y = Math.floor(e.y + 0.05);
    if (world.getBlock(x, y, z) !== wanted) {
      FLOW_WORK[0] = FLOW_WORK[1] = FLOW_WORK[2] = 0;
      return FLOW_WORK;
    }

    const state = world.getState(x, y, z);
    const level = Number.isInteger(state) && state > 0 ? Math.min(7, state) : 0;
    let flowX = 0, flowZ = 0;
    for (const direction of FLOW_DIRECTIONS) {
      const nx = x + direction[0], nz = z + direction[1];
      const neighbor = world.getBlock(nx, y, nz);
      if (neighbor === wanted) {
        const neighborState = world.getState(nx, y, nz);
        const neighborLevel = Number.isInteger(neighborState) && neighborState > 0 ? Math.min(7, neighborState) : 0;
        const difference = neighborLevel - level;
        flowX += direction[0] * difference;
        flowZ += direction[1] * difference;
      } else if (!Blocks.isSolid(neighbor) && !Blocks.get(neighbor).liquid) {
        const belowNeighbor = world.getBlock(nx, y - 1, nz);
        if (!Blocks.isSolid(belowNeighbor) || belowNeighbor === wanted) {
          const difference = 8 - level;
          flowX += direction[0] * difference;
          flowZ += direction[1] * difference;
        }
      }
    }

    const below = world.getBlock(x, y - 1, z);
    const downward = !Blocks.isSolid(below) && below !== wanted ? -1 : 0;
    const length = Math.hypot(flowX, flowZ);
    FLOW_WORK[0] = length > 1e-6 ? flowX / length : 0;
    FLOW_WORK[1] = downward;
    FLOW_WORK[2] = length > 1e-6 ? flowZ / length : 0;
    return FLOW_WORK;
  };

  window.Physics = Physics;
})();
