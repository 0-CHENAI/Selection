/**
 * Adapted from https://github.com/254558/claude-range-slider and the approved
 * rounded-cell demo. Sample energy at cell centers; remask after bloom so
 * brightness never changes the shared cell silhouette.
 */
export const VERT = `#version 300 es
  layout(location=0) in vec2 a_pos;
  out vec2 v_uv;
  void main(){ v_uv=a_pos*0.5+0.5; gl_Position=vec4(a_pos,0.0,1.0); }
`;

const CELL_SDF_GLSL = `
  float cellSD(vec2 ap) {
    float halfExtent = 0.390;
    float cornerR = 0.115;
    vec2 b = ap - vec2(halfExtent - cornerR);
    return length(max(b, 0.0)) + min(max(b.x, b.y), 0.0) - cornerR;
  }
  float cellMask(vec2 ap) {
    float sd = cellSD(ap);
    float aa = max(fwidth(sd), 1e-4) * 0.7;
    return 1.0 - smoothstep(-aa, aa, sd);
  }
`;

export const FRAG_SIM = `#version 300 es
  precision highp float;
  in vec2 v_uv; out vec4 fc;
  uniform float u_time, u_slider, u_elapsed;
  uniform vec2 u_cells;
  uniform sampler2D u_back;
  float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
  ${CELL_SDF_GLSL}
  void main(){
    vec2 uv=v_uv;
    vec2 g=uv*u_cells;
    vec2 id=floor(g);
    vec2 cf=fract(g);
    float h=hash(id);
    float cell=cellMask(abs(cf-0.5));
    vec2 cellUV = (id + 0.5) / u_cells;
    float cx = cellUV.x;
    float cy = cellUV.y;
    vec3 prev=texture(u_back,uv).rgb;
    float fade_mask = smoothstep(0.0, 0.45, uv.x);
    vec3 decay = prev * 0.90 * fade_mask * cell;
    float act=smoothstep(0.95,1.0,u_slider);
    if(act<0.01||u_elapsed<0.0){ fc=vec4(decay,1.0); return; }
    float t=u_time;
    float cellDelay = h * 0.22;
    float cellAge   = max(u_elapsed - cellDelay, 0.0);
    float ignited   = step(0.001, cellAge);
    float cellSpd   = 0.96 + h * 0.06;
    float fillT = clamp(cellAge / 4.0, 0.0, 1.0);
    float eased = 1.0 - pow(1.0 - fillT, 1.35);
    float dist  = eased * u_slider * cellSpd * ignited;
    float cellOff = (h - 0.5) * 0.012;
    float front   = max(u_slider - dist - cellOff, 0.02);
    float tail    = max(u_slider - front, 0.001);
    float inZ = smoothstep(front - 0.025, front + 0.008, cx)
              * smoothstep(u_slider + 0.012, u_slider - 0.004, cx);
    float dn    = clamp(max(u_slider - cx, 0.0) / tail, 0.0, 1.0);
    float bright = pow(1.0 - dn, 0.75);
    bright = max(bright, 0.04 * ignited) * inZ;
    bright *= 1.0 - smoothstep(0.94, 1.05, dn);
    float es = mix(0.22, 0.5, min(u_elapsed / 2.2, 1.0));
    float vy = abs(cy - 0.5) * 2.0;
    float vf = pow(max(1.0 - vy * vy * 0.45, 0.0), 0.75);
    float ts = mix(0.85, 1.0, min(u_elapsed / 1.5, 1.0));
    float f1 = sin(cx * 30.0 + t * 15.0 * ts + h * 6.28);
    float f2 = sin(cx * 17.0 + t * 8.0 * ts + h * 3.14);
    float f3 = sin(cx * 52.0 + t * 25.0 * ts + h * 10.0);
    float flame = smoothstep(0.08, 0.92, (f1 + f2 * 0.5 + f3 * 0.25) * 0.35 + 0.5);
    float r1 = sin(dn * 16.0 - t * 5.0 * ts + h * 3.0);
    float r2 = sin(dn * 8.0 - t * 2.5 * ts + h * 5.0);
    float rhythm = smoothstep(-0.15, 0.55, r1) * (r2 * 0.5 + 0.5);
    rhythm = pow(max(rhythm, 0.0), 1.2);
    float avgSpd = dist / max(cellAge, 0.001);
    float age    = max(cellAge - max(u_slider - cx, 0.0) / max(avgSpd, 0.001), 0.0);
    float flash  = step(0.0, age) * exp(-age * 2.0);
    float energy = bright * vf * (flame * 0.42 + rhythm * 0.38)
                 + flash * bright * vf * 0.28;
    energy *= es;
    float edgeBase = exp(-pow((cx - front) * 10.0, 2.0));
    float ef1 = sin(cx * 45.0 + t * 20.0 * ts + h * 6.28) * 0.5 + 0.5;
    float ef2 = sin(cx * 28.0 + t * 11.0 * ts + h * 3.14) * 0.5 + 0.5;
    float edge = edgeBase * (0.25 + ef1 * ef2 * 1.2) * 1.1 * act * es;
    float leadD    = front - cx;
    float leadZone = smoothstep(0.07, 0.0, leadD) * step(0.0, leadD) * vf;
    float h2       = hash(id + vec2(99.0, 33.0));
    float leadF    = sin(leadD * 100.0 + t * 20.0 * ts + h2 * 6.28) * 0.5 + 0.5;
    float leadSpark = leadZone * step(0.6, h2) * leadF * act * es * 0.5;
    float total = energy + edge + leadSpark;
    vec3 ember = vec3(0.28, 0.10, 0.58);
    vec3 wpur  = vec3(0.62, 0.32, 1.0);
    vec3 wht   = vec3(1.0, 0.94, 0.98);
    float temp = 1.0 - dn;
    vec3 col   = mix(ember, wpur, temp);
    col        = mix(col, wht, pow(temp, 4.5));
    col       *= total;
    float pulse = sin(t * 2.8) * 0.15 + 1.0;
    float core  = exp(-pow((cx - u_slider) * 16.0, 2.0));
    col += wht * core * 1.2 * pulse * act * es;
    col += wpur * exp(-pow((cx - u_slider) * 3.5, 2.0)) * 0.10 * act * es;
    col *= cell;
    col *= fade_mask;
    fc = vec4(min(decay + col, vec3(1.5)), 1.0);
  }
`;

export const FRAG_BLUR = `#version 300 es
  precision highp float;
  in vec2 v_uv; out vec4 fc;
  uniform sampler2D u_tex;
  uniform vec2 u_dir, u_res;
  uniform float u_ext;
  vec3 s(vec2 uv){
    vec3 c=texture(u_tex,uv).rgb;
    return u_ext>0.5 && dot(c,vec3(0.2126,0.7152,0.0722))<0.3 ? vec3(0.0) : c;
  }
  void main(){
    vec2 o=u_dir*1.1/u_res;
    vec3 r=s(v_uv)*0.227027;
    r+=s(v_uv+o)*0.194595;    r+=s(v_uv-o)*0.194595;
    r+=s(v_uv+o*2.0)*0.121622;r+=s(v_uv-o*2.0)*0.121622;
    r+=s(v_uv+o*3.0)*0.054054;r+=s(v_uv-o*3.0)*0.054054;
    fc=vec4(r,1.0);
  }
`;

export const FRAG_COMP = `#version 300 es
  precision highp float;
  in vec2 v_uv; out vec4 fc;
  uniform sampler2D u_scene, u_glow;
  uniform vec2 u_cells;
  ${CELL_SDF_GLSL}
  void main(){
    vec3 s=texture(u_scene,v_uv).rgb;
    vec3 g=texture(u_glow,v_uv).rgb;
    vec3 mapped = 1.0 - exp(-(s + g * 1.0 + s * g * 0.22) * 1.10);
    vec2 ap = abs(fract(v_uv * u_cells) - 0.5);
    float cell = cellMask(ap);
    fc = vec4(mapped * cell, 1.0);
  }
`;
