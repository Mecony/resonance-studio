import { analyzeAudio, synthesizeDemo } from './dsp.js';

self.onmessage = ({data}) => {
  try {
    const source = data.demo ? synthesizeDemo() : {samples: data.samples, sampleRate: data.sampleRate};
    const analysis = analyzeAudio(source.samples, source.sampleRate, value => self.postMessage({type:'progress',value}));
    const buffers = Object.values(analysis).filter(x => x instanceof Float32Array).map(x => x.buffer);
    const result = {type:'complete',analysis};
    if (data.demo) { result.samples = source.samples; result.sampleRate = source.sampleRate; buffers.push(source.samples.buffer); }
    self.postMessage(result,buffers);
  } catch (error) { self.postMessage({type:'error',message:error.message}); }
};
