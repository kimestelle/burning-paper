export const burnFragmentShaderSrc = /* glsl */ `
precision mediump float;

varying vec3 v_normal;
varying vec2 v_uv;
varying float v_depth;

uniform vec3 u_lightDir;
uniform float u_time;
uniform int u_wireframe;
uniform float u_burnProgress;
uniform vec2 u_burnOrigin;
uniform sampler2D u_textTexture;

vec3 paperColor = vec3(1.0, 0.98, 0.93);
vec3 paperShadow = vec3(0.95, 0.93, 0.86);

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1,0)), f.x),
    mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x),
    f.y
  );
}

void main() {
  if (u_wireframe == 1) {
    gl_FragColor = vec4(0.3, 0.5, 0.9, 0.8);
    return;
  }

  vec2 uv = v_uv;

  // --- radial distance from click ---
    float aspect = 1100.0 / 850.0;
    vec2 p = vec2(uv.x, uv.y * aspect);
    vec2 o = vec2(u_burnOrigin.x, u_burnOrigin.y * aspect);

  float d = distance(p, o);

  // --- layered noise for rough edge ---
  float n1 = noise(uv * 4.0 + u_time * 0.015);
  float n2 = noise(uv * 24.0 - u_time * 0.01);

  float edgeNoise = n1 * 0.12 + n2 * 0.06;

  // expanding radius
    float easedProgress = pow(u_burnProgress, 3.6);
    float radius = easedProgress * 1.6;

  // mask: 1 = intact, 0 = gone
  float burnMask = smoothstep(radius - 0.045, radius + 0.045, d + edgeNoise);

  if (burnMask < 0.06) discard;

  vec3 nor = normalize(v_normal);
  vec3 lightDir = normalize(u_lightDir);
  float diff = max(dot(nor, lightDir), 0.0);
  float light = 0.45 + diff * 0.55;

  float depthShade = 1.0 - clamp(abs(v_depth) * 0.003, 0.0, 0.35);
  float grain = noise(uv * 180.0) * 0.04;
  float grain2 = noise(uv * 60.0 + 3.7) * 0.025;
  float rule = step(0.97, fract(uv.y * 18.0)) * 0.07;

  vec3 color = mix(paperShadow, paperColor, light);

  vec4 text = texture2D(u_textTexture, uv);

    // dark ink text
    color = mix(color, text.rgb, text.a * 0.72);

  color += grain + grain2 - rule;
  color *= depthShade;

  // --- ember ring ---
  float ring = 1.0 - smoothstep(0.0, 0.06, abs((d + edgeNoise) - radius));

  vec3 charColor = vec3(0.055, 0.038, 0.026);
    vec3 glowColor = vec3(1.0, 0.28, 0.06);

  color = mix(charColor, color, smoothstep(0.12, 0.42, burnMask));
  color += glowColor * ring * (0.7 + n2 * 0.6);

  vec2 vignette = uv * 2.0 - 1.0;
  color *= 1.0 - dot(vignette, vignette) * 0.08;

  gl_FragColor = vec4(color, burnMask);
}
`;