// All layers share deformation so filaments stay attached to particle knots.
const field = /* glsl */ `
  uniform float uTime;
  uniform float uAmplitude;
  uniform float uEnergy;
  varying float vLight;
  varying float vDepth;
  float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1,311.7,74.7))) * 43758.5453); }
  float noise(vec3 p) {
    vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
    return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
      mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
  }
  vec3 deform(vec3 p) {
    float t=uTime;
    vec3 n=normalize(p);
    float a=noise(n*2.6+vec3(t*.19,-t*.13,t*.09));
    float b=noise(n*5.8-vec3(t*.11,t*.16,0.0));
    float ripple=sin(n.y*11.0+n.x*5.0+t*.8)*sin(n.z*9.0-t*.55);
    p*=1.0+uAmplitude*((a-.5)*1.15+(b-.5)*.35+ripple*.13);
    // Tangential drift folds the mesh instead of just inflating a ball.
    p+=uAmplitude*.18*vec3(sin(p.y*5.0+t*.5),sin(p.z*5.0-t*.4),sin(p.x*5.0+t*.3));
    float strand=pow(1.0-abs(sin(n.y*7.0+n.x*4.0+n.z*6.0+t*.35)), 7.0);
    vLight=.16+a*.28+strand*.9+pow(b,5.0)*1.3;
    return p;
  }
`;
export const pointVertex = /* glsl */ `
  ${field}
  attribute float aSize;
  uniform float uPointSize;
  uniform float uDpr;
  void main() {
    vec3 p=deform(position);
    vec4 mv=modelViewMatrix*vec4(p,1.0);
    vDepth=clamp((mv.z+5.5)/3.0,.2,1.0);
    gl_Position=projectionMatrix*mv;
    gl_PointSize=clamp(aSize*uPointSize*uDpr*3.4/-mv.z,1.0,18.0);
  }
`;
export const pointFragment = /* glsl */ `
  uniform float uEnergy;
  varying float vLight;
  varying float vDepth;
  void main() {
    float r=length(gl_PointCoord-.5)*2.0;
    if(r>1.0) discard;
    float glow=exp(-r*r*5.5)*.45+exp(-r*r*35.0)*.9;
    vec3 color=mix(vec3(.015,.6,.65),vec3(.3,1.0,1.0),clamp(vLight*.6,0.0,1.0));
    gl_FragColor=vec4(color*(1.0+vLight*.7),glow*vLight*vDepth*uEnergy);
  }
`;
export const lineVertex = /* glsl */ `
  ${field}
  void main() {
    vec4 mv=modelViewMatrix*vec4(deform(position),1.0);
    vDepth=clamp((mv.z+5.5)/3.0,.15,1.0);
    gl_Position=projectionMatrix*mv;
  }
`;
export const lineFragment = /* glsl */ `
  uniform float uEnergy;
  varying float vLight;
  varying float vDepth;
  void main() { gl_FragColor=vec4(.015,.78,.83,min(vLight,1.4)*.3*vDepth*uEnergy); }
`;
