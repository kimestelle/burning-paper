'use client'
import { useEffect, useState, useRef, useCallback } from "react";
import { burnFragmentShaderSrc } from "./burnShader";
// ─── Types ────────────────────────────────────────────────────────────────────

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  restX: number;
  restY: number;
  restZ: number;
  pinned: boolean;
}

// ─── Shaders ──────────────────────────────────────────────────────────────────

const vertexShaderSrc = /* glsl */ `
  attribute vec2 a_pos;
  attribute float a_depth;
  attribute vec3 a_nor;
  attribute vec2 a_uv;

  uniform vec2 u_resolution;

  varying vec3 v_normal;
  varying vec2 v_uv;
  varying float v_depth;

  void main() {
    vec2 clip = (a_pos / u_resolution) * 2.0 - 1.0;
    clip.y = -clip.y;

    float perspective = 1.0 + a_depth * 0.0008;
    clip *= perspective;

    gl_Position = vec4(clip, -a_depth * 0.001, 1.0);
    v_normal = a_nor;
    v_uv = a_uv;
    v_depth = a_depth;
  }
`;
// ─── WebGL helpers ────────────────────────────────────────────────────────────

function createShader(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
    throw new Error(gl.getShaderInfoLog(s) ?? "shader error");
  return s;
}

function createProgram(gl: WebGLRenderingContext, vs: string, fs: string): WebGLProgram {
  const prog = gl.createProgram()!;
  gl.attachShader(prog, createShader(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(prog, createShader(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
    throw new Error(gl.getProgramInfoLog(prog) ?? "link error");
  return prog;
}

// ─── Paper simulation ─────────────────────────────────────────────────────────

const COLS = 30;
const ROWS = 22;
const REST_Z_AMPLITUDE = 18; // slight initial curl

function buildGrid(w: number, h: number) {
  const particles: Particle[] = [];
  const padX = w * 0.12;
  const padY = h * 0.1;
  const cellW = (w - padX * 2) / (COLS - 1);
  const cellH = (h - padY * 2) / (ROWS - 1);

  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const rx = padX + col * cellW;
      const ry = padY + row * cellH;
      // Gentle initial curl/wave on Z axis
      const rz =
        Math.sin((col / (COLS - 1)) * Math.PI) * REST_Z_AMPLITUDE * 0.5 +
        Math.cos((row / (ROWS - 1)) * Math.PI * 0.7) * REST_Z_AMPLITUDE * 0.3;

      // Pin the top two corners
      // const pinned = row === 0 && (col === 0 || col === COLS - 1);

      particles.push({
        x: rx, y: ry, z: rz,
        vx: 0, vy: 0, vz: 0,
        restX: rx, restY: ry, restZ: rz,
        // pinned,
        pinned: false
      });
    }
  }
  return particles;
}

function buildIndices() {
  const idx: number[] = [];
  for (let row = 0; row < ROWS - 1; row++) {
    for (let col = 0; col < COLS - 1; col++) {
      const tl = row * COLS + col;
      const tr = tl + 1;
      const bl = tl + COLS;
      const br = bl + 1;
      idx.push(tl, bl, tr);
      idx.push(bl, br, tr);
    }
  }
  return new Uint16Array(idx);
}

function computeNormals(particles: Particle[], indices: Uint16Array): Float32Array {
  const normals = new Float32Array(particles.length * 3);
  for (let t = 0; t < indices.length; t += 3) {
    const i0 = indices[t], i1 = indices[t + 1], i2 = indices[t + 2];
    const p0 = particles[i0], p1 = particles[i1], p2 = particles[i2];
    const ux = p1.x - p0.x, uy = p1.y - p0.y, uz = p1.z - p0.z;
    const vx = p2.x - p0.x, vy = p2.y - p0.y, vz = p2.z - p0.z;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    for (const i of [i0, i1, i2]) {
      normals[i * 3] += nx;
      normals[i * 3 + 1] += ny;
      normals[i * 3 + 2] += nz;
    }
  }
  for (let i = 0; i < particles.length; i++) {
    const b = i * 3;
    const len = Math.hypot(normals[b], normals[b + 1], normals[b + 2]) || 1e-6;
    normals[b] /= len; normals[b + 1] /= len; normals[b + 2] /= len;
  }
  return normals;
}

// ─── Component ────────────────────────────────────────────────────────────────

interface PaperProps {
  width?: number;
  height?: number;
  maxSvh?: number;
  wireframe?: boolean;
  /** Label shown on the paper */
  label?: string;

  burning?: boolean;
  onBurnComplete?: () => void;
}

export default function Paper({
  width = 850,
  height = 1100,
  maxSvh = 80,
  wireframe = false,
  label = "",
  burning = false,
  onBurnComplete,
}: PaperProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<{
    particles: Particle[];
    indices: Uint16Array;
    mouse: { x: number; y: number; down: boolean };
    program: WebGLProgram | null;
    rafId: number;
    wireframe: boolean;
    time: number;
    burnProgress: number;
    burning: boolean;
    burnComplete: boolean;
    burnOrigin: {x: number, y: number}
  }>({
    particles: [],
    indices: new Uint16Array(),
    mouse: { x: -9999, y: -9999, down: false },
    program: null,
    rafId: 0,
    wireframe: false,
    time: 0,
    burnProgress: 0,
    burning: false,
    burnComplete: false,
    burnOrigin: { x: 0.5, y: 0.5 },
  });

  const [burningLocal, setBurningLocal] = useState(false);
  const [done, setDone] = useState(false);

  // Keep wireframe in sync without re-initialising
  useEffect(() => {
    stateRef.current.wireframe = wireframe;
  }, [wireframe]);

  useEffect(() => {
    stateRef.current.burning = burning;
  }, [burning]);

  useEffect(() => {
    stateRef.current.burning = burningLocal;
  }, [burningLocal]);

      const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();

      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;

      if (!burningLocal && !done) {
        stateRef.current.burnOrigin = { x, y };
        stateRef.current.burnProgress = 0;
        stateRef.current.burnComplete = false;
        setBurningLocal(true);
        return;
      }

      if (done) {
        stateRef.current.burnProgress = 0;
        stateRef.current.burnComplete = false;
        setDone(false);
        setBurningLocal(false);
      }
    };  

  const updateParticles = useCallback((
    particles: Particle[],
    mouse: { x: number; y: number; down: boolean },
    w: number,
    h: number,
    time: number
  ) => {
    const springK = 0.018;
    const damping = 0.88;
    const mouseR = 500;
    const mouseForce = 340;
    const gravity = 0.28;
    const airResist = 0.012;

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      if (p.pinned) continue;

      const row = Math.floor(i / COLS);
      const col = i % COLS;

      // Mouse interaction
      const dx = p.x - mouse.x;
      const dy = p.y - mouse.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < mouseR) {
        const t = 1 - dist / mouseR;

        p.vz += t;
      }

      //wind 
      const gust1 = Math.sin(time * 0.008 + col * 0.3) * Math.cos(time * 0.005 + row * 0.2);
      const gust2 = Math.sin(time * 0.013 + col * 0.15 + row * 0.1) * 0.5;

      // faster flutter layered on top
      const flutter = Math.sin(time * 0.03 + col * 0.5) * 0.25;

      const wind = (gust1 + gust2 + flutter) * 24;

      // Spring back to rest
      const ambientZ = p.restZ + wind * (row / (ROWS - 1));
      p.vx += (p.restX - p.x) * springK;
      p.vy += (p.restY - p.y) * springK;
      p.vz += (ambientZ - p.z) * (springK * 0.7);

      // Gravity (mostly on Z so page droops)
      p.vy += gravity * (row / (ROWS - 1));
      p.vz -= gravity * 0.5 * (row / (ROWS - 1));

      // Air resistance
      p.vx -= p.vx * airResist;
      p.vy -= p.vy * airResist;
      p.vz -= p.vz * airResist;

      // Damping
      p.vx *= damping;
      p.vy *= damping;
      p.vz *= damping;

      p.x += p.vx;
      p.y += p.vy;
      p.z += p.vz;

      // Soft boundary clamp
      p.x = Math.max(2, Math.min(w - 2, p.x));
      p.y = Math.max(2, Math.min(h - 2, p.y));
      p.z = Math.max(-120, Math.min(120, p.z));
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext("webgl", { alpha: true });
    if (!gl) return;

    const program = createProgram(gl, vertexShaderSrc, burnFragmentShaderSrc);
    stateRef.current.program = program;

    const particles = buildGrid(width, height);
    const indices = buildIndices();
    stateRef.current.particles = particles;
    stateRef.current.indices = indices;

    // Attribute/uniform locations
    const a_pos = gl.getAttribLocation(program, "a_pos");
    const a_depth = gl.getAttribLocation(program, "a_depth");
    const a_nor = gl.getAttribLocation(program, "a_nor");
    const a_uv = gl.getAttribLocation(program, "a_uv");
    const u_resolution = gl.getUniformLocation(program, "u_resolution");
    const u_lightDir = gl.getUniformLocation(program, "u_lightDir");
    const u_time = gl.getUniformLocation(program, "u_time");
    const u_wireframe = gl.getUniformLocation(program, "u_wireframe");
    const u_burnProgress = gl.getUniformLocation(program, "u_burnProgress");
    const u_burnOrigin = gl.getUniformLocation(program, "u_burnOrigin");

    const textTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, textTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    const textCanvas = document.createElement("canvas");
    textCanvas.width = width;
    textCanvas.height = height;
    const textCtx = textCanvas.getContext("2d")!;
    const u_textTexture = gl.getUniformLocation(program, "u_textTexture");


    // Build static UV buffer
    const uvData = new Float32Array(particles.length * 2);
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const i = row * COLS + col;
        uvData[i * 2] = col / (COLS - 1);
        uvData[i * 2 + 1] = row / (ROWS - 1);
      }
    }
    const uvBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
    gl.bufferData(gl.ARRAY_BUFFER, uvData, gl.STATIC_DRAW);

    // Static index buffer
    const idxBuf = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

    // Dynamic buffers
    const posBuf = gl.createBuffer();
    const depthBuf = gl.createBuffer();
    const norBuf = gl.createBuffer();

    // Mouse handlers
    const getPos = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: (clientX - rect.left) * (width / rect.width),
        y: (clientY - rect.top) * (height / rect.height),
      };
    };

    const onMouseMove = (e: MouseEvent) => {
      Object.assign(stateRef.current.mouse, getPos(e.clientX, e.clientY));
    };
    const onMouseLeave = () => {
      stateRef.current.mouse.x = -9999;
      stateRef.current.mouse.y = -9999;
      stateRef.current.mouse.down = false;
    };
    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      const t = e.touches[0];
      Object.assign(stateRef.current.mouse, getPos(t.clientX, t.clientY));
    };

    const drawTextTexture = (text: string) => {
      textCtx.clearRect(0, 0, width, height);

      textCtx.fillStyle = "rgba(74, 63, 48, 0.78)";
      textCtx.font = "36px EB Garamond";
      textCtx.textBaseline = "top";

      const paddingX = width * 0.10;
      const paddingTop = height * 0.085;

      const maxWidth = width - paddingX * 2;
      const x = paddingX;
      let y = paddingTop;
      const lineHeight = 61;

      const paragraphs = text.split("\n");

      for (let p = 0; p < paragraphs.length; p++) {
        const paragraph = paragraphs[p];

        // Preserve blank lines
        if (paragraph.trim() === "") {
          y += lineHeight;
          continue;
        }

        const words = paragraph.split(" ");
        let line = "";

        for (let word of words) {
          const testLine = line ? `${line} ${word}` : word;

          if (textCtx.measureText(testLine).width <= maxWidth) {
            line = testLine;
            continue;
          }

          if (line) {
            textCtx.fillText(line, x, y);
            y += lineHeight;
            line = "";
          }

          while (textCtx.measureText(word).width > maxWidth) {
            let cut = word.length;

            while (cut > 1) {
              const slice = word.slice(0, cut) + "-";
              if (textCtx.measureText(slice).width <= maxWidth) break;
              cut--;
            }

            const part = word.slice(0, cut) + "-";
            textCtx.fillText(part, x, y);
            y += lineHeight;

            word = word.slice(cut);
          }

          line = word;
        }

        if (line) {
          textCtx.fillText(line, x, y);
          y += lineHeight;
        }
      }

      gl.bindTexture(gl.TEXTURE_2D, textTexture);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        textCanvas
      );
    };

    drawTextTexture(label);

    canvas.addEventListener("mousemove", onMouseMove);
    canvas.addEventListener("mouseleave", onMouseLeave);
    canvas.addEventListener("touchmove", onTouchMove, { passive: false });

    // Render loop
    const loop = () => {
      const state = stateRef.current;
      state.time++;

      updateParticles(state.particles, state.mouse, width, height, state.time);

      if (state.burning && state.burnProgress < 1) {
        state.burnProgress += 0.008;

      if (state.burnProgress >= 1 && !state.burnComplete) {
        state.burnComplete = true;
        setDone(true);
        onBurnComplete?.();
      }
      }

      gl.viewport(0, 0, width, height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);

      gl.useProgram(program);
      gl.uniform2f(u_resolution, width, height);
      gl.uniform3f(u_lightDir, 0.6, -0.8, 1.0);
      gl.uniform1f(u_time, state.time);
      gl.uniform1i(u_wireframe, state.wireframe ? 1 : 0);
      gl.uniform1f(u_burnProgress, state.burnProgress);
      gl.uniform2f(
        u_burnOrigin,
        state.burnOrigin.x,
        state.burnOrigin.y
      );

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, textTexture);
      gl.uniform1i(u_textTexture, 0);

      // Upload positions
      const posData = new Float32Array(state.particles.length * 2);
      const depthData = new Float32Array(state.particles.length);
      for (let i = 0; i < state.particles.length; i++) {
        posData[i * 2] = state.particles[i].x;
        posData[i * 2 + 1] = state.particles[i].y;
        depthData[i] = state.particles[i].z;
      }

      gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
      gl.bufferData(gl.ARRAY_BUFFER, posData, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(a_pos);
      gl.vertexAttribPointer(a_pos, 2, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, depthBuf);
      gl.bufferData(gl.ARRAY_BUFFER, depthData, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(a_depth);
      gl.vertexAttribPointer(a_depth, 1, gl.FLOAT, false, 0, 0);

      // Normals
      const normals = computeNormals(state.particles, indices);
      gl.bindBuffer(gl.ARRAY_BUFFER, norBuf);
      gl.bufferData(gl.ARRAY_BUFFER, normals, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(a_nor);
      gl.vertexAttribPointer(a_nor, 3, gl.FLOAT, false, 0, 0);

      // UV
      gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
      gl.enableVertexAttribArray(a_uv);
      gl.vertexAttribPointer(a_uv, 2, gl.FLOAT, false, 0, 0);

      // Index buffer
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);

      if (state.wireframe) {
        gl.drawElements(gl.LINES, indices.length, gl.UNSIGNED_SHORT, 0);
      } else {
        gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_SHORT, 0);
      }

      state.rafId = requestAnimationFrame(loop);
    };

    stateRef.current.rafId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(stateRef.current.rafId);
      canvas.removeEventListener("mousemove", onMouseMove);
      canvas.removeEventListener("mouseleave", onMouseLeave);
      canvas.removeEventListener("touchmove", onTouchMove);
      gl.deleteProgram(program);
    };
  }, [width, height, updateParticles, onBurnComplete, label]);

  return (
    <div
      style={{
        width: `min(${width}px, ${maxSvh * (width / height)}svh)`,
        aspectRatio: `${width} / ${height}`,
        position: "relative",
        overflow: "hidden",
        userSelect: "none",
        touchAction: "none",
        filter: `
          drop-shadow(0 18px 24px rgba(40, 28, 16, 0.18))
          drop-shadow(0 4px 6px rgba(40, 28, 16, 0.10))
        `,
      }}
      onClick={handleClick}
    >
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        style={{
          display: "block",
          width: "100%",
          height: "100%",
        }}
      />
    </div>
  );
}