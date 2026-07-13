/* gl.js — WebGL1 helpers, shader programs, mat4 math */
'use strict';
(function () {
  const GL = {};
  let gl = null;
  GL.uintIndices = false;
  GL.makeIndexArray = (data) => new Uint16Array(data);

  GL.init = function (canvas) {
    gl = canvas.getContext('webgl', { antialias: false, alpha: false, preserveDrawingBuffer: false })
      || canvas.getContext('experimental-webgl', { antialias: false, alpha: false, preserveDrawingBuffer: false });
    if (!gl) return null;
    GL.uintIndices = !!gl.getExtension('OES_element_index_uint');
    GL.indexType = GL.uintIndices ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
    GL.makeIndexArray = (data) => GL.uintIndices ? new Uint32Array(data) : new Uint16Array(data);
    GL.gl = gl;
    return gl;
  };

  GL.program = function (vsSrc, fsSrc) {
    function compile(type, src) {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        throw new Error('Shader error: ' + gl.getShaderInfoLog(sh) + '\n' + src);
      }
      return sh;
    }
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, vsSrc));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fsSrc));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error('Link error: ' + gl.getProgramInfoLog(prog));
    }
    // collect attribs/uniforms
    const p = { prog, attr: {}, uni: {} };
    const na = gl.getProgramParameter(prog, gl.ACTIVE_ATTRIBUTES);
    for (let i = 0; i < na; i++) {
      const info = gl.getActiveAttrib(prog, i);
      p.attr[info.name] = gl.getAttribLocation(prog, info.name);
    }
    const nu = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < nu; i++) {
      const info = gl.getActiveUniform(prog, i);
      const nm = info.name.replace(/\[0\]$/, '');
      p.uni[nm] = gl.getUniformLocation(prog, nm);
    }
    return p;
  };

  GL.textureFromCanvas = function (canvas, nearest) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, nearest ? gl.NEAREST : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  };

  // ---------- mat4 (column-major Float32Array(16)) ----------
  const M = {};
  const MUL_TMP = new Float32Array(16);
  M.create = () => { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; };
  M.identity = (m) => { m.fill(0); m[0] = m[5] = m[10] = m[15] = 1; return m; };
  M.perspective = function (out, fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2);
    out.fill(0);
    out[0] = f / aspect; out[5] = f;
    out[10] = (far + near) / (near - far); out[11] = -1;
    out[14] = (2 * far * near) / (near - far);
    return out;
  };
  M.mul = function (out, a, b) {
    const r = MUL_TMP;
    for (let c = 0; c < 4; c++) {
      for (let rw = 0; rw < 4; rw++) {
        r[c * 4 + rw] = a[rw] * b[c * 4] + a[4 + rw] * b[c * 4 + 1] + a[8 + rw] * b[c * 4 + 2] + a[12 + rw] * b[c * 4 + 3];
      }
    }
    out.set(r);
    return out;
  };
  M.translate = function (out, m, x, y, z) {
    out.set(m);
    out[12] = m[0] * x + m[4] * y + m[8] * z + m[12];
    out[13] = m[1] * x + m[5] * y + m[9] * z + m[13];
    out[14] = m[2] * x + m[6] * y + m[10] * z + m[14];
    out[15] = m[3] * x + m[7] * y + m[11] * z + m[15];
    return out;
  };
  M.rotX = function (out, m, rad) {
    const s = Math.sin(rad), c = Math.cos(rad);
    const a4 = m[4], a5 = m[5], a6 = m[6], a7 = m[7];
    const a8 = m[8], a9 = m[9], a10 = m[10], a11 = m[11];
    if (out !== m) out.set(m);
    for (let i = 0; i < 4; i++) {
      const av = i === 0 ? a4 : i === 1 ? a5 : i === 2 ? a6 : a7;
      const bv = i === 0 ? a8 : i === 1 ? a9 : i === 2 ? a10 : a11;
      out[4 + i] = av * c + bv * s;
      out[8 + i] = bv * c - av * s;
    }
    return out;
  };
  M.rotY = function (out, m, rad) {
    const s = Math.sin(rad), c = Math.cos(rad);
    const a0 = m[0], a1 = m[1], a2 = m[2], a3 = m[3];
    const a8 = m[8], a9 = m[9], a10 = m[10], a11 = m[11];
    if (out !== m) out.set(m);
    for (let i = 0; i < 4; i++) {
      const av = i === 0 ? a0 : i === 1 ? a1 : i === 2 ? a2 : a3;
      const bv = i === 0 ? a8 : i === 1 ? a9 : i === 2 ? a10 : a11;
      out[i] = av * c - bv * s;
      out[8 + i] = av * s + bv * c;
    }
    return out;
  };
  M.rotZ = function (out, m, rad) {
    const s = Math.sin(rad), c = Math.cos(rad);
    const a0 = m[0], a1 = m[1], a2 = m[2], a3 = m[3];
    const a4 = m[4], a5 = m[5], a6 = m[6], a7 = m[7];
    if (out !== m) out.set(m);
    for (let i = 0; i < 4; i++) {
      const av = i === 0 ? a0 : i === 1 ? a1 : i === 2 ? a2 : a3;
      const bv = i === 0 ? a4 : i === 1 ? a5 : i === 2 ? a6 : a7;
      out[i] = av * c + bv * s;
      out[4 + i] = bv * c - av * s;
    }
    return out;
  };
  M.scale = function (out, m, x, y, z) {
    for (let i = 0; i < 4; i++) {
      out[i] = m[i] * x; out[4 + i] = m[4 + i] * y; out[8 + i] = m[8 + i] * z; out[12 + i] = m[12 + i];
    }
    return out;
  };
  // FPS view matrix: translate(-eye) then rotY(yaw) then rotX(pitch)
  M.fpsView = function (out, ex, ey, ez, yaw, pitch, roll) {
    M.identity(out);
    if (roll) M.rotZ(out, out, roll);
    M.rotX(out, out, pitch);
    M.rotY(out, out, yaw);
    M.translate(out, out, -ex, -ey, -ez);
    return out;
  };
  GL.mat4 = M;

  // Frustum planes from proj*view matrix; each plane [a,b,c,d]
  GL.frustumPlanes = function (m, out) {
    const p = out || new Array(6);
    let n = 0;
    function plane(a, b, c, d) {
      const l = Math.hypot(a, b, c) || 1;
      const dst = p[n] || (p[n] = new Float32Array(4));
      dst[0] = a / l; dst[1] = b / l; dst[2] = c / l; dst[3] = d / l;
      n++;
    }
    plane(m[3] + m[0], m[7] + m[4], m[11] + m[8], m[15] + m[12]);   // left
    plane(m[3] - m[0], m[7] - m[4], m[11] - m[8], m[15] - m[12]);   // right
    plane(m[3] + m[1], m[7] + m[5], m[11] + m[9], m[15] + m[13]);   // bottom
    plane(m[3] - m[1], m[7] - m[5], m[11] - m[9], m[15] - m[13]);   // top
    plane(m[3] + m[2], m[7] + m[6], m[11] + m[10], m[15] + m[14]);  // near
    plane(m[3] - m[2], m[7] - m[6], m[11] - m[10], m[15] - m[14]);  // far
    return p;
  };
  // AABB vs frustum
  GL.boxInFrustum = function (planes, x0, y0, z0, x1, y1, z1) {
    for (const pl of planes) {
      const px = pl[0] > 0 ? x1 : x0;
      const py = pl[1] > 0 ? y1 : y0;
      const pz = pl[2] > 0 ? z1 : z0;
      if (pl[0] * px + pl[1] * py + pl[2] * pz + pl[3] < 0) return false;
    }
    return true;
  };

  window.GL = GL;
})();
