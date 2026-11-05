import test from 'node:test';
import assert from 'node:assert/strict';
import {AudioEngine} from '../dist/audio-engine.js';

class FakeContext {
  constructor(){this.state='running';this.currentTime=0;this.destination={};this.sources=[];}
  createGain(){return {gain:{value:0,setTargetAtTime(){}},connect(){}};}
  createMediaStreamDestination(){return {stream:{}};}
  createBuffer(){return {copyToChannel(){}};}
  createBufferSource(){const source={connect(){},disconnect(){},start(){},stop(){}};this.sources.push(source);return source;}
  async resume(){this.state='running';}
}
globalThis.window={AudioContext:FakeContext};
function setup(){const e=new AudioEngine();e.setTrack([new Float32Array(1000)],1000);return e;}

test('transport pauses, resumes and seeks using the audio clock',async()=>{
  const e=setup();await e.play();e.context.currentTime=.4;assert.equal(e.time(),.4);
  e.pause();e.context.currentTime=10;assert.equal(e.time(),.4);
  await e.play();e.context.currentTime=10.2;assert.ok(Math.abs(e.time()-.6)<1e-8);
  await e.seek(.1);assert.ok(Math.abs(e.time()-.1)<1e-8);assert.equal(e.playing,true);
});
test('concurrent play requests start a single source and pause cancels a pending play',async()=>{
  const e=setup();await Promise.all([e.play(),e.play()]);assert.equal(e.context.sources.length,1);
  e.pause();const pending=e.play();e.pause();await pending;assert.equal(e.playing,false);
});
test('looping wraps time, retains position on toggle, and track replacement stops old audio',async()=>{
  const e=setup();e.setLoop(true);await e.play();e.context.currentTime=1.3;assert.ok(Math.abs(e.time()-.3)<1e-8);
  e.setLoop(false);assert.ok(Math.abs(e.time()-.3)<1e-8);
  e.setTrack([new Float32Array(2000)],1000);assert.equal(e.playing,false);assert.equal(e.time(),0);assert.equal(e.duration,2);
});
