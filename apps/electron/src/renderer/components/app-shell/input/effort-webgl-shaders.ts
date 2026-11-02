/**
 * Flame simulation and bloom from https://github.com/254558/claude-range-slider
 * (src/components/shaders/index.js). Keep its sparks, ignition, feedback trail,
 * original cell shape, and unmasked bloom. Tighten only the bloom radius;
 * adapt responsive geometry, colors, and compositing for the menu themes.
 */
export const VERT = `#version 300 es
  layout(location=0) in vec2 a_pos;
  out vec2 v_uv;
  void main(){ v_uv=a_pos*0.5+0.5; gl_Position=vec4(a_pos,0.0,1.0); }
`

export const FRAG_SIM = `#version 300 es
  precision highp float;
  in vec2 v_uv; out vec4 fc;
  uniform float u_time, u_slider, u_elapsed, u_origin;
  uniform vec2 u_cells;
  uniform vec3 u_ember, u_mid, u_core;
  uniform float u_heat;
  uniform sampler2D u_back;
  float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
  void main(){
    vec2 uv=v_uv;
    vec2 g=uv*u_cells;
    vec2 id=floor(g);
    vec2 cf=fract(g);
    float h=hash(id);
    vec2 ap=abs(cf-0.5);
    float cell=smoothstep(0.34,0.22,max(ap.x*0.9,ap.y));
    vec3 prev=texture(u_back,uv).rgb;
    // Keep more of the low-energy tail before it dissolves at the left edge.
    float fade_mask = smoothstep(0.0, 0.30, uv.x);
    vec3 decay = prev * 0.90 * fade_mask;
    float act=smoothstep(0.95,1.0,u_slider);
    if(act<0.01||u_elapsed<0.0){ fc=vec4(decay,1.0); return; }
    float t=u_time;
    float cellDelay = h * 1.2;
    float cellAge   = max(u_elapsed - cellDelay, 0.0);
    float ignited   = step(0.001, cellAge);
    float cellSpd   = 0.85 + h * 0.30;
    float eased = 1.0 - pow(1.0 - clamp(cellAge / 2.5, 0.0, 1.0), 3.0);
    float dist  = eased * u_slider * cellSpd * ignited;
    float cellOff = (h - 0.5) * 0.05;
    float front   = max(u_slider - dist - cellOff, 0.02);
    float tail    = max(u_slider - front, 0.001);
    float inZ   = step(front - 0.003, uv.x) * step(uv.x, u_slider + 0.003);
    float dn    = clamp(max(u_slider - uv.x, 0.0) / tail, 0.0, 1.0);
    float bright = pow(1.0 - dn, 0.65);
    bright = max(bright, 0.04 * ignited) * inZ;
    bright *= 1.0 - smoothstep(0.94, 1.05, dn);
    float es = mix(0.15, 0.5, min(u_elapsed / 1.0, 1.0));
    float vy = abs(uv.y - 0.5) * 2.0;
    float vf = pow(max(1.0 - vy * vy * 0.45, 0.0), 0.75);
    float ts = mix(0.85, 1.0, min(u_elapsed / 1.5, 1.0));
    float f1 = sin(uv.x * 30.0 + t * 15.0 * ts + h * 6.28);
    float f2 = sin(uv.x * 17.0 + t * 8.0 * ts + h * 3.14);
    float f3 = sin(uv.x * 52.0 + t * 25.0 * ts + h * 10.0);
    float flame = smoothstep(0.08, 0.92, (f1 + f2 * 0.5 + f3 * 0.25) * 0.35 + 0.5);
    float r1 = sin(dn * 16.0 - t * 5.0 * ts + h * 3.0);
    float r2 = sin(dn * 8.0 - t * 2.5 * ts + h * 5.0);
    float rhythm = smoothstep(-0.15, 0.55, r1) * (r2 * 0.5 + 0.5);
    rhythm = pow(max(rhythm, 0.0), 1.2);
    float avgSpd = dist / max(cellAge, 0.001);
    float age    = max(cellAge - max(u_slider - uv.x, 0.0) / max(avgSpd, 0.001), 0.0);
    float flash  = step(0.0, age) * exp(-age * 3.2);
    float sp  = fract(t * (0.38 + h * 0.15) + h * 7.0);
    float sX  = u_slider - sp * tail;
    float sY  = 0.5 + sin(sp * 11.0 + h * 6.28) * 0.28;
    float spark = smoothstep(0.014, 0.0, abs(uv.x - sX))
                * smoothstep(0.18, 0.0, abs(uv.y - sY))
                * (1.0 - sp) * (1.0 - sp) * es;
    float energy = bright * vf * (flame * 0.42 + rhythm * 0.38)
                 + flash * bright * vf * 0.55
                 + spark * 0.7 * inZ;
    energy *= es;
    float edgeBase = exp(-pow((uv.x - front) * 18.0, 2.0));
    float ef1 = sin(uv.x * 45.0 + t * 20.0 * ts + h * 6.28) * 0.5 + 0.5;
    float ef2 = sin(uv.x * 28.0 + t * 11.0 * ts + h * 3.14) * 0.5 + 0.5;
    float edge = edgeBase * (0.25 + ef1 * ef2 * 1.5) * 1.6 * act * es;
    float leadD    = front - uv.x;
    float leadZone = smoothstep(0.07, 0.0, leadD) * step(0.0, leadD) * vf;
    float h2       = hash(id + vec2(99.0, 33.0));
    float leadF    = sin(leadD * 100.0 + t * 20.0 * ts + h2 * 6.28) * 0.5 + 0.5;
    float leadSpark = leadZone * step(0.6, h2) * leadF * act * es * 0.5;
    float total = energy + edge + leadSpark;
    vec3 ember = u_ember;
    vec3 wpur  = u_mid;
    vec3 wht   = u_core;
    float temp = 1.0 - dn;
    vec3 col   = mix(ember, wpur, temp);
    col        = mix(col, wht, pow(temp, 4.5));
    col       *= total;
    float pulse = sin(t * 2.8) * 0.15 + 1.0;
    float core  = exp(-pow((uv.x - u_slider) * 16.0, 2.0));
    col += wht * core * u_heat * pulse * act * es;
    col += wpur * exp(-pow((uv.x - u_slider) * 3.5, 2.0)) * 0.12 * act * es;
    col *= cell;
    col *= fade_mask;
    // Emit from the handle center. Each cell arrives with the outward front,
    // then ignites at a staggered time and builds energy locally. Once settled
    // this mask is one, so the accepted steady-state field stays unchanged.
    vec2 cellUV=(id+0.5)/u_cells;
    vec2 fromHandle=cellUV-vec2(u_origin,0.5);
    fromHandle.y*=u_cells.y/u_cells.x;
    float arrival=length(fromHandle)*1.8;
    float birth=arrival+0.04+h*0.48;
    float reveal=smoothstep(0.0,0.42,u_elapsed-birth);
    fc = vec4(min(decay + col, vec3(1.5))*reveal, 1.0);
  }
`

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
    vec2 o=u_dir*0.9/u_res;
    vec3 r=s(v_uv)*0.227027;
    r+=s(v_uv+o)*0.194595;    r+=s(v_uv-o)*0.194595;
    r+=s(v_uv+o*2.0)*0.121622;r+=s(v_uv-o*2.0)*0.121622;
    r+=s(v_uv+o*3.0)*0.054054;r+=s(v_uv-o*3.0)*0.054054;
    fc=vec4(r,1.0);
  }
`

export const FRAG_COMP = `#version 300 es
  precision highp float;
  in vec2 v_uv; out vec4 fc;
  uniform sampler2D u_scene, u_glow;
  uniform vec2 u_cells;
  uniform vec3 u_mid, u_core, u_track;
  uniform float u_exposure, u_floor, u_rise, u_chroma, u_backdrop;
  void main(){
    vec3 s=texture(u_scene,v_uv).rgb;
    vec3 g=texture(u_glow,v_uv).rgb;
    // Original bloom and tone mapping; do not clip the halo back into cells.
    vec3 mapped=1.0-exp(-(s+g*1.2+s*g*0.35)*u_exposure);
    // Light mode follows the same simulation and bloom, with no added waves
    // or cell remasking. Luminance preserves the source's dark / hot contrast.
    float energy=dot(mapped,vec3(0.2126,0.7152,0.0722));
    float alpha=smoothstep(u_floor,u_floor+u_rise,energy);
    // On a light surface, whitening the center while keeping a dark rim reads
    // as an outline. Use one pigment per cell; retain the source's soft alpha.
    vec2 centerUV=(floor(v_uv*u_cells)+0.5)/u_cells;
    vec3 center=1.0-exp(-texture(u_scene,centerUV).rgb*u_exposure);
    float hot=smoothstep(0.12,0.82,dot(center,vec3(0.2126,0.7152,0.0722)));
    // Extend the light theme's saturated shoulder toward the middle while
    // leaving the faint left tail and the peak beside the handle unchanged.
    float shoulder=smoothstep(0.28,0.52,centerUV.x)*(1.0-smoothstep(0.78,0.98,centerUV.x));
    hot+=(1.0-hot)*shoulder*0.32;
    // A hot cell must gain visual weight on a light surface. Dark mode can
    // glow toward white; light mode instead builds toward the saturated ink.
    vec3 pigment=mix(u_core,u_mid,0.2+hot*0.8);
    // Premultiplied color suppresses dim residue on the neutral light track.
    vec3 light=mix(mapped * alpha, pigment * alpha, u_chroma);
    vec3 dark=u_track + mapped * (1.0 - u_track);
    float backdrop=clamp(u_backdrop, 0.0, 1.0);
    fc=vec4(mix(light, dark, backdrop), mix(alpha, 1.0, backdrop));
  }
`;
