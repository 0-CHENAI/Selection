/**
 * Ultracode pixel-field shaders adapted from
 * https://github.com/254558/claude-range-slider (commit e79b9ac, author 张帅).
 * That repository does not publish a LICENSE file. The simulation, blur, and
 * composite passes are kept and retuned for Selection: a square cell grid,
 * a dark-to-lavender density gradient, and a quiet glow instead of a fire bloom.
 */

export const VERT = `#version 300 es
  layout(location=0) in vec2 a_pos;
  out vec2 v_uv;
  void main(){ v_uv=a_pos*0.5+0.5; gl_Position=vec4(a_pos,0.0,1.0); }
`

export const FRAG_SIM = `#version 300 es
  precision highp float;
  in vec2 v_uv; out vec4 fc;
  uniform float u_time, u_slider, u_elapsed, u_dark, u_pro;
  uniform vec3 u_accent;
  uniform sampler2D u_back;
  float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
  void main(){
    vec2 uv=v_uv;
    vec2 g=uv*vec2(64.0,5.0);
    vec2 id=floor(g);
    vec2 cf=fract(g);
    float h=hash(id);
    vec2 ap=abs(cf-0.5);
    float cell=smoothstep(0.49,0.33,max(ap.x,ap.y));
    vec3 prev=texture(u_back,uv).rgb;
    float fade_mask = smoothstep(0.02, 0.30, uv.x);
    vec3 decay = prev * 0.8 * fade_mask;
    float act=smoothstep(0.95,1.0,u_slider);
    if(act<0.01||u_elapsed<0.0){ fc=vec4(decay,1.0); return; }
    float t=u_time;
    float cellDelay = h * 0.55;
    float cellAge   = max(u_elapsed - cellDelay, 0.0);
    float ignited   = step(0.001, cellAge);
    float cellSpd   = 0.9 + h * 0.25;
    float eased = 1.0 - pow(1.0 - clamp(cellAge / 1.6, 0.0, 1.0), 3.0);
    float dist  = eased * u_slider * cellSpd * ignited;
    float cellOff = (h - 0.5) * 0.04;
    float front   = max(u_slider - dist - cellOff, 0.02);
    float tail    = max(u_slider - front, 0.001);
    float inZ   = step(front - 0.003, uv.x) * step(uv.x, u_slider + 0.003);
    float dn    = clamp(max(u_slider - uv.x, 0.0) / tail, 0.0, 1.0);
    float bright = pow(1.0 - dn, 0.85);
    bright = max(bright, 0.05 * ignited) * inZ;
    bright *= 1.0 - smoothstep(0.92, 1.05, dn);
    float es = mix(0.28, 0.55, min(u_elapsed / 0.8, 1.0));
    float vy = abs(uv.y - 0.5) * 2.0;
    float vf = pow(max(1.0 - vy * vy * 0.2, 0.0), 0.8);
    float ts = mix(0.85, 1.0, min(u_elapsed / 1.5, 1.0));
    float f1 = sin(uv.x * 30.0 + t * 6.0 * ts + h * 6.28);
    float f2 = sin(uv.x * 17.0 + t * 3.5 * ts + h * 3.14);
    float flame = smoothstep(0.08, 0.92, (f1 + f2 * 0.5) * 0.35 + 0.5);
    float r1 = sin(dn * 16.0 - t * 2.2 * ts + h * 3.0);
    float rhythm = smoothstep(-0.15, 0.55, r1);
    rhythm = pow(max(rhythm, 0.0), 1.2);
    float life = 0.72 + 0.28 * flame * rhythm;
    float energy = bright * vf * life;
    energy *= es;
    vec3 ember = u_dark > 0.5 ? vec3(0.34, 0.32, 0.40) : vec3(0.70, 0.64, 0.82);
    vec3 mid = u_dark > 0.5 ? vec3(0.50, 0.46, 0.58) : vec3(0.56, 0.44, 0.76);
    vec3 peak = u_dark > 0.5 ? vec3(0.68, 0.62, 0.76) : vec3(0.46, 0.34, 0.68);
    if(u_pro > 0.5){
      ember = mix(ember, u_accent, 0.72);
      mid = mix(mid, u_accent, 0.45);
      peak = mix(peak, u_accent, 0.25);
    }
    float temp = 1.0 - dn;
    vec3 col = mix(ember, mid, temp);
    col = mix(col, peak, pow(temp, 2.4) * (0.35 + 0.65 * flame));
    col *= energy * cell * fade_mask;
    fc = vec4(min(decay + col, vec3(1.0)), 1.0);
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
    return u_ext>0.5 && dot(c,vec3(0.2126,0.7152,0.0722))<0.28 ? vec3(0.0) : c;
  }
  void main(){
    vec2 o=u_dir*1.15/u_res;
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
  void main(){
    vec3 s=texture(u_scene,v_uv).rgb;
    vec3 g=texture(u_glow,v_uv).rgb;
    vec3 col=(s+g*0.1)*0.82;
    float luma=max(col.r,max(col.g,col.b));
    float a=smoothstep(0.05,0.16,luma);
    fc=vec4(col*a,a);
  }
`
