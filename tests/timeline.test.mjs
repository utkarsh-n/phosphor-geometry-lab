import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const compile = file => ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const moduleURL = code => 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
const geometryURL = moduleURL(compile('../app/geometry.ts'));
const { defaults, distance } = await import(geometryURL);
const { createRecorder, recordAt, forecast, pointsAt, recordedAt, splitSegments, motionKey } = await import(moduleURL(compile('../app/timeline.ts').replace("'./geometry'", JSON.stringify(geometryURL))));
const near = (a,b) => assert.ok(Math.abs(a-b)<1e-9, `${a} vs ${b}`);
const run = (rec,s,end,dt=1/60) => { for(let t=0;t<end-1e-9;t+=dt) recordAt(rec,t,s);recordAt(rec,end,s); };
test('past snapshots stay immutable when controls and forecasts change',()=>{
 const s={...defaults(),fourD:true,morph:1},rec=createRecorder();run(rec,s,10);
 const before=JSON.stringify(rec.samples);
 const edited={...s,radius:.5,xw:90,yw:45,zw:-30,channels:s.channels.map(c=>({...c,motion:'Lissajous',speed:2,frequency:.8,amplitude:.3,phase:19}))};
 recordAt(rec,10,edited);forecast(10,8,edited);
 assert.equal(JSON.stringify(rec.samples),before);
 assert.ok(distance(forecast(10,1,s)[20].points[0],forecast(10,1,edited)[20].points[0])>.1);
});
test('forecasts converge to subsequently recorded motion for every mode in 3D and 4D',()=>{
 for(const fourD of [false,true])for(const motion of ['Orbit','Pendulum','Precession','Lissajous','Breathing']){
  const s={...defaults(),fourD,morph:1,xw:38,yw:-71,zw:63};s.channels=s.channels.map(c=>({...c,motion}));
  const rec=createRecorder();recordAt(rec,2,s);const predicted=forecast(2,5,s);
  for(let i=1;i<=300;i++)recordAt(rec,2+i/60,s);
  for(const k of [1,30,60,300])predicted[k].points.forEach((p,i)=>near(distance(p,rec.samples[k].points[i]),0));
 }
});
test('parameter changes start a new segment, with no false bridge',()=>{
 const s=defaults(),rec=createRecorder();run(rec,s,2);const old=JSON.stringify(rec.samples);
 const edited={...s,channels:s.channels.map(c=>({...c,speed:2.2}))};
 recordAt(rec,2,edited);recordAt(rec,2.01,edited);
 assert.equal(JSON.stringify(rec.samples.slice(0,-1)),old);
 const segments=splitSegments(rec.samples);assert.equal(segments.length,2);assert.equal(segments[1].length,1);
 near(distance(segments[1][0].points[0],pointsAt(2.01,edited)[0]),0);
});
test('paused edits leave time, history and coordinates intact',()=>{
 const s=defaults(),rec=createRecorder();run(rec,s,3);const old=JSON.stringify(rec.samples);
 for(let i=0;i<20;i++)recordAt(rec,3,{...s,radius:1+i*.05});
 assert.equal(rec.lastTime,3);assert.equal(JSON.stringify(rec.samples),old);
});
test('recording is independent of frame rate and irregular frame increments',()=>{
 const s=defaults(),a=createRecorder(),b=createRecorder(),c=createRecorder();run(a,s,5,1/60);run(b,s,5,1/30);
 for(let t=0,i=0;t<5;t+= [.011,.023,.019,.047][i++%4])recordAt(c,t,s);recordAt(c,5,s);
 for(const rec of [b,c]){assert.equal(rec.samples.length,a.samples.length);rec.samples.forEach((sample,i)=>{near(sample.t,a.samples[i].t);near(distance(sample.points[0],a.samples[i].points[0]),0);});}
});
test('history retention is bounded and preserves the fixed time grid',()=>{
 const rec=createRecorder();run(rec,defaults(),35);assert.equal(rec.samples.length,1801);near(rec.samples[0].t,5);near(rec.samples.at(-1).t,35);
});
test('view-only changes do not create physical history breaks',()=>{
 const s=defaults(),edited={...s,yaw:45,pitch:20,glow:.1,persistence:8,trails:false,mesh:false,axes:false};assert.equal(motionKey(s),motionKey(edited));
 const rec=createRecorder();run(rec,s,2);recordAt(rec,2,edited);recordAt(rec,2.1,edited);assert.equal(splitSegments(rec.samples).length,1);
});
test('history lookups never invent pre-start data or interpolate across a perturbation',()=>{
 const rec=createRecorder(),s=defaults();recordAt(rec,4,s);recordAt(rec,4.1,s);
 assert.equal(recordedAt(rec.samples,3.9),null);assert.equal(recordedAt(rec.samples,4.045),rec.samples[2]);
});
test('clear history preserves time; reset removes all older samples',()=>{
 const s=defaults();let rec=createRecorder();run(rec,s,8);rec=createRecorder();recordAt(rec,8,s);assert.equal(rec.samples.length,1);near(rec.samples[0].t,8);
 recordAt(rec,0,s);assert.equal(rec.samples.length,1);near(rec.samples[0].t,0);
});
