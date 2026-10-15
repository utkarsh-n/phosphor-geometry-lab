export type Vec4 = [number, number, number, number];
export type Motion = 'Orbit' | 'Pendulum' | 'Precession' | 'Lissajous' | 'Breathing';
export type Channel = { motion: Motion; speed: number; amplitude: number; frequency: number; phase: number };
export type Settings = { morph: number; radius: number; yaw: number; pitch: number; trails: boolean; persistence: number; glow: number; mesh: boolean; axes: boolean; connections: boolean; fourD: boolean; xw: number; yw: number; zw: number; channels: Channel[] };
export const TAU = 2 * Math.PI;
export const radians = (deg: number) => deg * Math.PI / 180;
export const defaults = (): Settings => ({ morph: 0, radius: 2, yaw: 0, pitch: 0, trails: true, persistence: 3, glow: .65, mesh: true, axes: true, connections: true, fourD: false, xw: 25, yw: 0, zw: 0, channels: [0,120,240].map(phase => ({motion:'Orbit',speed:1,amplitude:.7,frequency:.12,phase})) });
export const norm = (v: number[]) => Math.hypot(...v);
export const distance = (a: Vec4,b: Vec4) => norm(a.map((x,i)=>x-b[i]));
export function rotatePlane(v: Vec4, i: number, j: number, angle: number): Vec4 {
  const out = [...v] as Vec4, c = Math.cos(angle), s = Math.sin(angle);
  out[i] = v[i]*c-v[j]*s; out[j] = v[i]*s+v[j]*c; return out;
}
export function rotate4(v: Vec4, s: Settings): Vec4 {
  return s.fourD ? rotatePlane(rotatePlane(rotatePlane(v,0,3,radians(s.xw)),1,3,radians(s.yw)),2,3,radians(s.zw)) : v;
}
// Latitude opens continuously from the equatorial circle to the full sphere.
export function surface(theta: number, latitude: number, wAngle: number, s: Settings, radius = s.radius): Vec4 {
  const lat = latitude*s.morph, w = s.fourD ? wAngle : 0;
  return rotate4([radius*Math.cos(w)*Math.cos(lat)*Math.cos(theta),radius*Math.cos(w)*Math.cos(lat)*Math.sin(theta),radius*Math.cos(w)*Math.sin(lat),radius*Math.sin(w)],s);
}
export function pointAt(t: number, index: number, s: Settings): Vec4 {
  const c=s.channels[index], phase=radians(c.phase), q=TAU*c.frequency*c.speed*t;
  let theta=q+phase, lat=0, wa=0, r=s.radius;
  const a=c.amplitude;
  switch(c.motion){
    case 'Orbit': lat=Math.cos(phase)*.65*a; wa=Math.cos(phase)*.4*a; break;
    case 'Pendulum': {
      const swing=a*1.4*Math.sin(q), tilt=.7;
      const v=rotatePlane([Math.cos(swing),Math.sin(swing),0,0],1,2,tilt);
      theta=phase+Math.atan2(v[1],v[0]);lat=Math.asin(v[2]);wa=0;break;
    }
    case 'Precession': {
      const v=rotatePlane(rotatePlane([Math.cos(q),Math.sin(q),0,0],0,2,a*1.2),0,1,q*.25+phase);
      theta=Math.atan2(v[1],v[0]);lat=Math.asin(v[2]);wa=s.fourD?a*.5*Math.sin(q*.5):0;break;
    }
    case 'Breathing': r*=1-a*.45*(1-Math.cos(q)); lat=Math.sin(phase)*.7; wa=a*.6*Math.sin(q*.5); break;
    case 'Lissajous': {
      // A bounded 2:3:4:5 harmonic curve; coordinates are not renormalized.
      const scale=s.radius*a/Math.sqrt(2+s.morph*s.morph+(s.fourD?1:0));
      return rotate4([scale*Math.sin(2*q+phase),scale*Math.sin(3*q),scale*s.morph*Math.sin(4*q+phase),s.fourD?scale*Math.sin(5*q+phase):0],s);
    }
  }
  return surface(theta,lat,wa,s,r);
}
// Eye is at w=3R. Since |w|<=R the projection denominator never vanishes.
export function project(v: Vec4,s: Settings): [number,number,number] {
  const f=s.fourD?3*s.radius/(3*s.radius-v[3]):1;
  const y=radians(s.yaw), p=radians(s.pitch);
  const x=(v[0]*Math.cos(y)+v[2]*Math.sin(y))*f;
  const z=(-v[0]*Math.sin(y)+v[2]*Math.cos(y))*f;
  return [x,v[1]*f*Math.cos(p)-z*Math.sin(p),v[1]*f*Math.sin(p)+z*Math.cos(p)];
}
export function meshLines(s: Settings): Vec4[][] {
  const lines: Vec4[][]=[];
  const ws=s.fourD?[-Math.PI/3,0,Math.PI/3]:[0];
  for(const w of ws){
    const lats=s.morph<.005?[0]:[-Math.PI/2,-Math.PI/3,-Math.PI/6,0,Math.PI/6,Math.PI/3,Math.PI/2];
    for(const lat of lats) lines.push(Array.from({length:81},(_,i)=>surface(TAU*i/80,lat,w,s)));
    if(s.morph>.005) for(let j=0;j<12;j++) lines.push(Array.from({length:41},(_,i)=>surface(TAU*j/12,-Math.PI/2+Math.PI*i/40,w,s)));
  }
  if(s.fourD) for(let j=0;j<8;j++) lines.push(Array.from({length:81},(_,i)=>surface(j*TAU/8,Math.PI/5,TAU*i/80,s)));
  return lines;
}
