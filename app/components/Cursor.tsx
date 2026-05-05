'use client';

import { useEffect, useRef } from 'react';

const vertex = `
attribute vec2 a_pos;
varying vec2 v_uv;

void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const fragment = `
precision mediump float;

varying vec2 v_uv;

uniform vec2 u_resolution;
uniform vec2 u_mouse;
uniform float u_time;
uniform float u_visible;
uniform float u_size;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);

  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}

void main() {
  vec2 px = v_uv * u_resolution;
  vec2 diff = px - u_mouse;
  float d = length(diff);

  float n = noise(vec2(u_time * 2.2, d * 0.035));
  float flicker = n * 1.55 + sin(u_time * 9.0) * 0.08;

  float core = 1.0 - smoothstep(
    0.0,
    4.0 * u_size + flicker * 5.0,
    d
  );

  float glow = 1.0 - smoothstep(
    2.0 * u_size,
    20.0 * u_size + flicker * 16.0,
    d
  );

  float outer = 1.0 - smoothstep(
    24.0 * u_size,
    90.0 * u_size,
    d
  );

  vec3 deepRed = vec3(0.50, 0.035, 0.015);
  vec3 ember = vec3(1.0, 0.16, 0.035);
  vec3 gold = vec3(1.0, 0.55, 0.12);

  vec3 color = deepRed * outer * 0.55;
  color += ember * glow * 0.9;
  color += gold * core * (flicker);

  float alpha = (outer * 0.18 + glow * 0.38 + core * 0.75) * u_visible;

  gl_FragColor = vec4(color, alpha);
}
`;

function makeShader(
  gl: WebGLRenderingContext,
  type: number,
  src: string
): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) ?? 'shader error');
  }

  return shader;
}

function makeProgram(gl: WebGLRenderingContext): WebGLProgram {
  const program = gl.createProgram()!;

  gl.attachShader(program, makeShader(gl, gl.VERTEX_SHADER, vertex));
  gl.attachShader(program, makeShader(gl, gl.FRAGMENT_SHADER, fragment));
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) ?? 'program error');
  }

  return program;
}

export default function EmberCursor() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const targetMouse = useRef({
    x: -9999,
    y: -9999,
    visible: 0,
  });

  const renderMouse = useRef({
    x: -9999,
    y: -9999,
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext('webgl', {
      alpha: true,
      premultipliedAlpha: false,
    });

    if (!gl) return;

    const program = makeProgram(gl);

    const a_pos = gl.getAttribLocation(program, 'a_pos');
    const u_resolution = gl.getUniformLocation(program, 'u_resolution');
    const u_mouse = gl.getUniformLocation(program, 'u_mouse');
    const u_time = gl.getUniformLocation(program, 'u_time');
    const u_visible = gl.getUniformLocation(program, 'u_visible');
    const u_size = gl.getUniformLocation(program, 'u_size');

    const quad = new Float32Array([
      -1, -1,
       1, -1,
      -1,  1,
      -1,  1,
       1, -1,
       1,  1,
    ]);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;

      canvas.width = Math.floor(window.innerWidth * dpr);
      canvas.height = Math.floor(window.innerHeight * dpr);

      canvas.style.width = '100vw';
      canvas.style.height = '100vh';

      gl.viewport(0, 0, canvas.width, canvas.height);
    };

    const move = (e: PointerEvent) => {
      const dpr = window.devicePixelRatio || 1;

      targetMouse.current.x = e.clientX * dpr;
      targetMouse.current.y = (window.innerHeight - e.clientY) * dpr;
      targetMouse.current.visible = 1;

      if (renderMouse.current.x < -9000) {
        renderMouse.current.x = targetMouse.current.x;
        renderMouse.current.y = targetMouse.current.y;
      }
    };

    const leave = () => {
      targetMouse.current.visible = 0;
    };

    window.addEventListener('resize', resize);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerleave', leave);
    document.addEventListener('mouseleave', leave);

    resize();

    let raf = 0;
    const start = performance.now();

    const loop = () => {
      const t = (performance.now() - start) / 1000;

      const lag = 0.11;

      renderMouse.current.x +=
        (targetMouse.current.x - renderMouse.current.x) * lag;

      renderMouse.current.y +=
        (targetMouse.current.y - renderMouse.current.y) * lag;

      const danceX =
        Math.sin(t * 9.0) * 6 +
        Math.sin(t * 17.0) * 2.5;

      const danceY =
        Math.cos(t * 11.0) * 6 +
        Math.sin(t * 19.0) * 2.5;

      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);

      gl.useProgram(program);

      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(a_pos);
      gl.vertexAttribPointer(a_pos, 2, gl.FLOAT, false, 0, 0);

      gl.uniform2f(u_resolution, canvas.width, canvas.height);

      gl.uniform2f(
        u_mouse,
        renderMouse.current.x + danceX,
        renderMouse.current.y + danceY
      );

      gl.uniform1f(u_time, t);
      gl.uniform1f(u_visible, targetMouse.current.visible);
      gl.uniform1f(u_size, 1.9);

      gl.drawArrays(gl.TRIANGLES, 0, 6);

      raf = requestAnimationFrame(loop);
    };

    loop();

    return () => {
      cancelAnimationFrame(raf);

      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerleave', leave);
      document.removeEventListener('mouseleave', leave);

      gl.deleteProgram(program);
      gl.deleteBuffer(buffer);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 z-50"
      style={{
        mixBlendMode: 'screen',
      }}
    />
  );
}