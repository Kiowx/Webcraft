/* craft.js — recipe matching (3x3/2x2 grids), furnace smelting tick */
'use strict';
(function () {
  const Craft = {};

  // grid: array of 4 (2x2) or 9 (3x3) slots ({id,n}|null)
  // returns {recipe, out:{id,n}} or null
  Craft.match = function (grid) {
    const size = grid.length === 4 ? 2 : 3;
    // build trimmed pattern of ids
    const ids = grid.map(s => (s ? s.id : 0));
    // bounding box of non-empty
    let minR = 9, minC = 9, maxR = -1, maxC = -1;
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
      if (ids[r * size + c]) { minR = Math.min(minR, r); maxR = Math.max(maxR, r); minC = Math.min(minC, c); maxC = Math.max(maxC, c); }
    }
    if (maxR < 0) return null;
    const h = maxR - minR + 1, w = maxC - minC + 1;
    const cells = [];
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) cells.push(ids[(minR + r) * size + (minC + c)]);
    const nonEmpty = ids.filter(i => i);

    for (const R of Items.RECIPES) {
      if (R.shapeless) {
        if (nonEmpty.length !== R.shapeless.length) continue;
        const need = R.shapeless.slice();
        let ok = true;
        for (const id of nonEmpty) {
          const idx = need.indexOf(id);
          if (idx < 0) { ok = false; break; }
          need.splice(idx, 1);
        }
        if (ok && need.length === 0) return { recipe: R, out: R.out };
        continue;
      }
      const rows = R.pattern;
      const rh = rows.length, rw = rows[0].length;
      if (rh > size || rw > size) continue;
      if (rh !== h || rw !== w) {
        if (!(R.mirror && rh === h && rw === w)) continue;
      }
      const tryMatch = (mirror) => {
        for (let r = 0; r < rh; r++) for (let c = 0; c < rw; c++) {
          const ch = rows[r][mirror ? (rw - 1 - c) : c];
          const want = ch === ' ' ? 0 : R.key[ch];
          if (cells[r * rw + c] !== want) return false;
        }
        return true;
      };
      if (tryMatch(false)) return { recipe: R, out: R.out };
      if (R.mirror && tryMatch(true)) return { recipe: R, out: R.out };
    }
    return null;
  };

  // consume one of each non-empty cell
  Craft.consume = function (grid) {
    for (let i = 0; i < grid.length; i++) {
      const s = grid[i];
      if (s) {
        s.n--;
        if (s.n <= 0) grid[i] = null;
      }
    }
  };

  // furnace BE tick: slots [0]=input [1]=fuel [2]=output
  // returns true if visual state (lit) changed
  Craft.furnaceTick = function (world, x, y, z, be, dt) {
    const ID = Blocks.ID;
    let changed = false;
    const wasLit = be.burn > 0;
    if (be.burn > 0) be.burn -= dt;

    const input = be.slots[0];
    const smelt = input ? Items.SMELT[input.id] : null;
    let canSmelt = false;
    if (smelt) {
      const out = be.slots[2];
      canSmelt = !out || (out.id === smelt.id && out.n + smelt.n <= Items.maxStack(out.id));
    }

    // ignite new fuel
    if (be.burn <= 0 && canSmelt) {
      const fuel = be.slots[1];
      const burnT = fuel ? Items.FUEL[fuel.id] : null;
      if (burnT) {
        be.burn = burnT;
        be.burnMax = burnT;
        fuel.n--;
        if (fuel.n <= 0) be.slots[1] = null;
      }
    }

    // cook
    if (be.burn > 0 && canSmelt) {
      be.cook += dt;
      if (be.cook >= 10) {
        be.cook = 0;
        input.n--;
        if (input.n <= 0) be.slots[0] = null;
        const out = be.slots[2];
        if (out) out.n += smelt.n;
        else be.slots[2] = { id: smelt.id, n: smelt.n };
        be.xpStored = Math.max(0, Number(be.xpStored) || 0) + (Number(smelt.xp) || 0) * smelt.n;
        Sound.playAt('pop', x, y, z, 0.4, 0.8);
      }
    } else {
      be.cook = Math.max(0, be.cook - dt * 2);
    }

    const lit = be.burn > 0;
    if (lit !== wasLit) {
      const cur = world.getBlock(x, y, z);
      if (cur === ID.FURNACE || cur === ID.FURNACE_LIT) {
        world.setBlock(x, y, z, lit ? ID.FURNACE_LIT : ID.FURNACE);
        changed = true;
      }
    }
    return changed;
  };

  Craft.furnaceNeedsTick = function (be) {
    if (!be || be.type !== 'furnace') return false;
    if (be.burn > 0 || be.cook > 0) return true;
    const input = be.slots && be.slots[0];
    const fuel = be.slots && be.slots[1];
    if (!input || !fuel || !Items.SMELT[input.id] || !Items.FUEL[fuel.id]) return false;
    const smelt = Items.SMELT[input.id];
    const out = be.slots[2];
    return !out || (out.id === smelt.id && out.n + smelt.n <= Items.maxStack(out.id));
  };

  window.Craft = Craft;
})();
