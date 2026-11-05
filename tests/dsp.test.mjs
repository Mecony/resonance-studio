import test from 'node:test';
import assert from 'node:assert/strict';
import {fftMagnitude,analyzeAudio,featureAt,synthesizeDemo,encodeWav} from '../dist/dsp.js';
import {validateProject,DEFAULT_SETTINGS} from '../dist/settings.js';

const tone=(hz,duration=.6,amplitude=.5,rate=22050)=>Float32Array.from({length:Math.round(duration*rate)},(_,i)=>amplitude*Math.sin(2*Math.PI*hz*i/rate));
const mean=(x,start=5,end=x.length-5)=>x.slice(start,end).reduce((a,b)=>a+b,0)/Math.max(1,end-start);

test('FFT matches a direct DFT for a mixed non-bin-centered signal',()=>{
  const n=64,x=Float32Array.from({length:n},(_,i)=>.3*Math.sin(i*.41)+.7*Math.cos(i*.13));
  const actual=fftMagnitude(x);
  for(let k=0;k<=n/2;k++){
    let re=0,im=0;for(let i=0;i<n;i++){re+=x[i]*Math.cos(-2*Math.PI*i*k/n);im+=x[i]*Math.sin(-2*Math.PI*i*k/n);}
    assert.ok(Math.abs(actual[k]-Math.hypot(re,im)/n)<1e-6);
  }
  assert.throws(()=>fftMagnitude(new Float32Array(100)));
});
test('RMS of a known sine equals amplitude / sqrt(2)',()=>{
  const a=analyzeAudio(tone(1000),22050);
  assert.ok(Math.abs(mean(a.rawRms)-.5/Math.sqrt(2))<.002);
});
test('silence produces zero-valued finite features and no false motion energy',()=>{
  const a=analyzeAudio(new Float32Array(22050),22050);
  for(const key of ['rms','rawRms','low','mid','high','onset','spectrum','waveform'])assert.ok(a[key].every(x=>x===0));
});
test('low, mid and high tones concentrate in the expected raw spectral bands',()=>{
  for(const [hz,expected] of [[110,'low'],[1000,'mid'],[5000,'high']]){
    const x=tone(hz),n=2048,w=Float32Array.from({length:n},(_,i)=>x[i]*(.5-.5*Math.cos(2*Math.PI*i/(n-1))));
    const mags=fftMagnitude(w),power={low:0,mid:0,high:0};
    for(let k=1;k<mags.length;k++){const f=k*22050/n;if(f>=40&&f<250)power.low+=mags[k]**2;else if(f>=250&&f<2000)power.mid+=mags[k]**2;else if(f>=2000&&f<=10000)power.high+=mags[k]**2;}
    assert.ok(power[expected]/Object.values(power).reduce((a,b)=>a+b,0)>.99);
    const analyzed=analyzeAudio(x,22050);
    assert.ok(mean(analyzed[expected])>.9);
    for(const band of ['low','mid','high'].filter(b=>b!==expected))assert.ok(mean(analyzed[band])<.02);
  }
});
test('feature interpolation clamps time and is independent of playback history',()=>{
  const a=analyzeAudio(tone(440),22050);
  assert.deepEqual(featureAt(a,-2),featureAt(a,0));
  const first=featureAt(a,.2);featureAt(a,.5);assert.deepEqual(first,featureAt(a,.2));
  assert.ok(Object.entries(featureAt(a,100)).filter(([k])=>k!=='spectrum').every(([,v])=>Number.isFinite(v)));
});
test('original demo is deterministic, bounded, and contains changing audio energy',()=>{
  const a=synthesizeDemo(8000),b=synthesizeDemo(8000);
  assert.equal(a.samples.length,307200);assert.deepEqual(a.samples,b.samples);
  assert.ok(a.samples.every(x=>Number.isFinite(x)&&Math.abs(x)<=1));
  const analysis=analyzeAudio(a.samples,8000);assert.ok(Math.max(...analysis.onset)>.25);
});
test('WAV export has correct PCM header, size and signed sample clipping',()=>{
  const bytes=encodeWav(Float32Array.of(-2,0,2),22050),v=new DataView(bytes);
  assert.equal(bytes.byteLength,50);assert.equal(v.getUint32(24,true),22050);assert.equal(v.getUint32(40,true),6);
  assert.equal(v.getInt16(44,true),-32768);assert.equal(v.getInt16(48,true),32767);
});
test('project validation rejects unknown versions, invalid numbers, enums and oversized titles',()=>{
  const project={application:'resonance-studio',version:1,settings:{...DEFAULT_SETTINGS}};
  assert.deepEqual(validateProject(project).settings,DEFAULT_SETTINGS);
  for(const changes of [{sensitivity:NaN},{motion:Infinity},{density:100000},{theme:'<script>'},{ratio:'3:7'}])assert.throws(()=>validateProject({...project,settings:{...DEFAULT_SETTINGS,...changes}}));
  assert.throws(()=>validateProject({...project,version:2}));
  assert.equal(validateProject({...project,settings:{...DEFAULT_SETTINGS,title:'x'.repeat(100)}}).settings.title.length,42);
});
