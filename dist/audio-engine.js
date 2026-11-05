/** AudioContext.currentTime is the transport clock; rendering never advances it. */
export class AudioEngine {
  constructor(onEnded) { this.offset=0;this.playing=false;this.loop=false;this.volume=.65;this.onEnded=onEnded;this.playToken=0; }
  setTrack(channels,sampleRate) {
    this.pause();this.offset=0;this.channels=channels;this.sampleRate=sampleRate;
    this.duration=channels[0].length/sampleRate;this.buffer=null;
  }
  async ensureContext() {
    if(!this.context) {
      const AudioContextClass=window.AudioContext||window.webkitAudioContext;
      if(!AudioContextClass) throw new Error('当前浏览器不支持 Web Audio，请使用新版 Chrome、Edge 或 Firefox');
      this.context=new AudioContextClass();this.gain=this.context.createGain();this.gain.gain.value=this.volume;
      this.gain.connect(this.context.destination);
      this.recordDestination=this.context.createMediaStreamDestination();this.gain.connect(this.recordDestination);
    }
    if(!this.buffer&&this.channels) {
      this.buffer=this.context.createBuffer(this.channels.length,this.channels[0].length,this.sampleRate);
      this.channels.forEach((channel,i)=>this.buffer.copyToChannel(channel,i));
    }
    if(this.context.state!=='running') await this.context.resume();
  }
  async play() {
    if(!this.channels) return;
    const token=++this.playToken;
    await this.ensureContext();
    if(token!==this.playToken||this.playing) return;
    if(this.offset>=this.duration-.001)this.offset=0;
    const source=this.context.createBufferSource();source.buffer=this.buffer;source.loop=this.loop;source.connect(this.gain);
    this.source=source;this.startedAt=this.context.currentTime-this.offset;this.playing=true;
    source.onended=()=>{source.disconnect();if(this.source===source&&this.playing){this.playing=false;this.offset=this.duration;this.source=null;this.onEnded?.();}};
    source.start(0,this.offset);
  }
  time() {
    if(!this.playing)return this.offset;
    const t=Math.max(0,this.context.currentTime-this.startedAt);
    return this.loop?t%this.duration:Math.min(t,this.duration);
  }
  pause() {
    this.playToken++;
    if(!this.playing)return;
    this.offset=this.time();this.playing=false;
    const source=this.source;this.source=null;
    if(source){source.onended=null;try{source.stop();}catch{}source.disconnect();}
  }
  async seek(time) {const playing=this.playing;this.pause();this.offset=Math.max(0,Math.min(time,this.duration||0));if(playing)await this.play();}
  setLoop(loop) {this.offset=this.time();if(this.playing)this.startedAt=this.context.currentTime-this.offset;this.loop=loop;if(this.source)this.source.loop=loop;}
  setVolume(value) {this.volume=value;if(this.gain)this.gain.gain.setTargetAtTime(value,this.context.currentTime,.015);}
}
