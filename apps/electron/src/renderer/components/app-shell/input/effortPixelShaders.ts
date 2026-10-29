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
  uniform vec2 u_res;
  uniform vec3 u_accent;
  float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
  void main(){
    vec2 px = v_uv * u_res;
    float rows = 4.0;
    float gapRatio = 0.8;
    float cell = u_res.y / (rows + (rows + 1.0) * gapRatio);
    float gap = cell * gapRatio;
    float pitch = cell + gap;
    float gridH = rows * cell + (rows + 1.0) * gap;
    float y0 = (u_res.y - gridH) * 0.5 + gap;
    vec2 id = floor((px - vec2(gap, y0)) / pitch);
    vec2 center = vec2(gap, y0) + id * pitch + cell * 0.5;
    vec2 delta = abs(px - center);
    float square = 1.0 - smoothstep(cell * 0.5 - 0.65, cell * 0.5, max(delta.x, delta.y));
    if (id.y < 0.0 || id.y >= rows || square <= 0.001) {
      fc = vec4(0.0);
      return;
    }
    float across = clamp(center.x / max(u_res.x, 1.0), 0.0, 1.0);
    float h = hash(id);
    float chance = mix(0.34, 1.0, across);
    if (h > chance) {
      fc = vec4(0.0);
      return;
    }
    float flick = 0.9 + 0.1 * sin(u_time * 1.7 + h * 6.28318);
    float reveal = u_elapsed < 0.0 ? 1.0 : smoothstep(0.0, 0.45, u_elapsed);
    float alpha = mix(0.45, 0.78, across) * flick * reveal * u_slider * square;
    vec3 dim = vec3(0.48, 0.46, 0.54);
    vec3 lit = vec3(0.70, 0.64, 0.76);
    vec3 col = mix(dim, lit, across);
    if (u_pro > 0.5) col = mix(col, u_accent, 0.55);
    fc = vec4(col * alpha, alpha);
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
    vec4 s=texture(u_scene,v_uv);
    fc=vec4(s.rgb,s.a);
  }
`
