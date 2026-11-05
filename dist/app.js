import { clamp, featureAt, encodeWav, synthesizeDemo } from './dsp.js';
import { renderVisual, THEMES, PALETTES } from './visuals.js';
import { DEFAULT_SETTINGS, validateProject } from './settings.js';
import { AudioEngine } from './audio-engine.js';

const $=id=>document.getElementById(id);
const state={settings:{...DEFAULT_SETTINGS},analysis:null,track:null,loading:true,revision:0,worker:null,recording:false};
const canvas=$('visual-canvas'),ctx=canvas.getContext('2d'),wave=$('waveform'),waveCtx=wave.getContext('2d');
const silent={rms:0,rawRms:0,low:0,mid:0,high:0,onset:0,spectrum:new Float32Array(64)};
const preview={rms:.45,rawRms:.1,low:.5,mid:.4,high:.3,onset:.05,spectrum:Float32Array.from({length:64},(_,i)=>.3+.2*Math.sin(i*.7))};
const engine=new AudioEngine(()=>{if(state.recording)stopRecording();syncPlayButtons();});
let toastTimer,recorder,recordTimer,recordVideoStream;

function toast(text) {$('toast').textContent=text;$('toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('visible'),4500);}
const formatTime=t=>`${String(Math.floor(Math.max(0,t)/60)).padStart(2,'0')}:${String(Math.floor(Math.max(0,t)%60)).padStart(2,'0')}`;
function download(blob,name) {const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
function syncPlayButtons() {
  $('play-button').classList.toggle('is-playing',engine.playing);
  $('play-button').setAttribute('aria-label',engine.playing?'暂停':'播放');
  $('play-button').querySelector('use').setAttribute('href',engine.playing?'#i-pause':'#i-play');
  $('stage-play').hidden=engine.playing||state.loading;
}
function setLoading(loading,title='正在分析这段声音') {
  state.loading=loading;$('loading').hidden=!loading;$('loading-title').textContent=title;
  for(const id of ['play-button','stage-play','seek','snapshot-button','record-button','save-project','restart-button'])$(id).disabled=loading||!state.analysis;
  syncPlayButtons();
}
function resizeCanvas() {
  const sizes={'16:9':[1280,720],'1:1':[1080,1080],'9:16':[720,1280]};
  [canvas.width,canvas.height]=sizes[state.settings.ratio];
  const stage=$('stage'),rect=stage.getBoundingClientRect(),ratio=canvas.width/canvas.height;
  const width=Math.min(rect.width,rect.height*ratio);
  canvas.style.width=`${width}px`;canvas.style.height=`${width/ratio}px`;
}

function syncSettings() {
  const s=state.settings;
  document.querySelectorAll('[data-theme]').forEach(button=>{const yes=button.dataset.theme===s.theme;button.classList.toggle('selected',yes);button.setAttribute('aria-pressed',String(yes));});
  document.querySelectorAll('[data-ratio]').forEach(button=>{const yes=button.dataset.ratio===s.ratio;button.classList.toggle('active',yes);button.setAttribute('aria-pressed',String(yes));});
  document.querySelectorAll('[data-palette]').forEach(button=>{const yes=button.dataset.palette===s.palette;button.classList.toggle('selected',yes);button.setAttribute('aria-pressed',String(yes));});
  for(const name of ['sensitivity','motion','density','glow']) {
    $(name).value=s[name];$(`${name}-value`).textContent=name==='density'?String(s[name]):name==='glow'?`${Math.round(s[name]*100)}%`:`${s[name].toFixed(2)}×`;
  }
  $('palette-name').textContent=PALETTES[s.palette].name;$('theme-name').textContent=THEMES[s.theme].name;
  $('visual-caption').textContent=THEMES[s.theme].caption;$('artwork-title').value=s.title;
  resizeCanvas();renderThumbnails();
}
function renderThumbnails() {
  for(const button of document.querySelectorAll('[data-theme]')) {
    const thumbnail=button.querySelector('canvas');
    renderVisual(thumbnail.getContext('2d'),thumbnail.width,thumbnail.height,4,preview,{...state.settings,theme:button.dataset.theme,density:75},{title:''});
  }
}

function analyze(samples,sampleRate,demo,revision) {
  return new Promise((resolve,reject)=>{
    const worker=new Worker('./audio-worker.js',{type:'module'});state.worker=worker;
    worker.onmessage=({data})=>{
      if(revision!==state.revision){worker.terminate();return;}
      if(data.type==='progress')$('loading-detail').textContent=`分析音色与能量… ${Math.round(data.value*100)}%`;
      else {worker.terminate();state.worker=null;data.type==='error'?reject(new Error(data.message)):resolve(data);}
    };
    worker.onerror=()=>{worker.terminate();state.worker=null;reject(new Error('音频分析失败，请刷新页面后重试'));};
    worker.postMessage(demo?{demo:true}:{samples,sampleRate},demo?[]:[samples.buffer]);
  });
}

async function loadAudio(file=null) {
  if(state.recording){toast('请先停止录制，再更换音乐');return;}
  if(file&&file.size>32*1024*1024){toast('请选择小于 32 MB 的音频文件');return;}
  const revision=++state.revision;state.worker?.terminate();engine.pause();
  setLoading(true,file?'正在打开你的音乐':'正在准备原创示例');$('loading-detail').textContent=file?'解码音频文件…':'生成 Amber & Air…';
  try {
    let channels,sampleRate,result;
    if(file) {
      const DecodeContext=window.OfflineAudioContext||window.webkitOfflineAudioContext;
      if(!DecodeContext)throw new Error('当前浏览器无法解码音频，请换用新版浏览器');
      const decoder=new DecodeContext(2,1,44100);
      let decoded;
      try{decoded=await decoder.decodeAudioData(await file.arrayBuffer());}catch{throw new Error('无法读取这个音频，请尝试 WAV 或 MP3 格式');}
      if(revision!==state.revision)return;
      if(decoded.duration>180)throw new Error('第一版支持最长 3 分钟的音乐，请先截取需要的片段');
      if(decoded.duration<.1)throw new Error('音频太短，请选择至少 0.1 秒的声音');
      sampleRate=decoded.sampleRate;channels=Array.from({length:decoded.numberOfChannels},(_,i)=>decoded.getChannelData(i).slice());
      const mono=new Float32Array(decoded.length);
      for(const channel of channels)for(let i=0;i<mono.length;i++)mono[i]+=channel[i]/channels.length;
      result=await analyze(mono,sampleRate,false,revision);
    } else {
      result=await analyze(null,0,true,revision);channels=[result.samples];sampleRate=result.sampleRate;
    }
    if(revision!==state.revision)return;
    engine.setTrack(channels,sampleRate);state.analysis=result.analysis;
    state.track={name:file?file.name:'Amber & Air',demo:!file,duration:engine.duration,sampleRate};
    $('track-title').textContent=state.track.name;
    $('track-meta').textContent=`${file?'本地音频':'原创合成示例'} · ${(sampleRate/1000).toFixed(2)} kHz · ${formatTime(engine.duration)}`;
    $('total-time').textContent=formatTime(engine.duration);$('seek').max=engine.duration;$('seek').value=0;
    $('demo-button').classList.toggle('active',!file);$('artwork-title').value=state.settings.title=file?file.name.replace(/\.[^.]+$/,'').slice(0,42):'AMBER & AIR';
    setLoading(false);
    if(file)toast('音乐已载入。选择视觉主题，然后点击播放');
  } catch(error) {
    if(revision!==state.revision)return;
    setLoading(false);toast(error.message);
    if(!state.analysis){$('loading').hidden=false;$('loading-title').textContent='暂时无法载入';$('loading-detail').textContent='请点击左侧示例重试，或导入一段音频';}
  }
}

async function togglePlay() {
  if(state.loading||!state.analysis)return;
  if(state.recording){stopRecording();return;}
  try{if(engine.playing)engine.pause();else await engine.play();syncPlayButtons();}catch(error){toast(error.message);}
}
function drawWaveform(time) {
  const w=wave.width,h=wave.height,values=state.analysis?.waveform;
  waveCtx.clearRect(0,0,w,h);if(!values)return;
  const position=time/(engine.duration||1),step=w/values.length;
  for(let i=0;i<values.length;i++){
    const height=Math.max(3,values[i]*(h-9));waveCtx.fillStyle=i/values.length<position?'#7a8f62':'#d3dac5';
    waveCtx.fillRect(i*step,h/2-height/2,Math.max(1,step-1.6),height);
  }
  waveCtx.fillStyle='#7a8f62';waveCtx.fillRect(position*w,0,2,h);
}
let previousUiTime=-1;
function animate() {
  const time=engine.time(),features=state.analysis?featureAt(state.analysis,time):silent;
  renderVisual(ctx,canvas.width,canvas.height,time,features,state.settings,{title:state.settings.title});
  if(Math.abs(time-previousUiTime)>.03||!engine.playing) {
    $('current-time').textContent=formatTime(time);$('seek').value=time;
    $('seek').setAttribute('aria-valuetext',`${formatTime(time)}，共 ${formatTime(engine.duration||0)}`);
    drawWaveform(time);
    for(const band of ['low','mid','high'])$(`meter-${band}`).style.width=`${features[band]*100}%`;
    $('rms-value').textContent=features.rawRms>1e-8?`${(20*Math.log10(features.rawRms)).toFixed(1)} dBFS`:'−∞ dBFS';
    previousUiTime=time;
  }
  requestAnimationFrame(animate);
}

function getRecordingType(){if(!window.MediaRecorder||!canvas.captureStream)return '';return ['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm','video/mp4'].find(type=>MediaRecorder.isTypeSupported(type))||'';}
async function startRecording() {
  if(state.recording){stopRecording();return;}
  if(state.loading||!state.analysis)return;
  const mime=getRecordingType();if(!mime){toast('此浏览器不支持有声画布录制，仍可导出 PNG；建议使用新版 Chrome 或 Edge');return;}
  try {
    await engine.ensureContext();
    if(engine.time()>=engine.duration-.1)await engine.seek(0);
    recordVideoStream=canvas.captureStream(30);
    const videoStream=recordVideoStream;
    const stream=new MediaStream([...videoStream.getVideoTracks(),...engine.recordDestination.stream.getAudioTracks()]);
    const chunks=[],extension=mime.includes('mp4')?'mp4':'webm';
    recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:5000000});
    recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
    recorder.onstop=()=>{
      videoStream.getTracks().forEach(track=>track.stop());if(recordVideoStream===videoStream)recordVideoStream=null;
      if(chunks.length){download(new Blob(chunks,{type:mime}),`resonance-${Date.now()}.${extension}`);toast('短片已导出，请播放文件检查音画效果');}
      else toast('录制没有产生数据，请尝试播放一段更长的片段');
    };
    recorder.onerror=()=>{stopRecording();toast('录制失败，请尝试较低负载下重新录制');};
    state.recording=true;recorder.start(250);setRecordingUi(true);
    if(!engine.playing)await engine.play();syncPlayButtons();
    recordTimer=setTimeout(stopRecording,30000);toast('正在实时录制，最长 30 秒。点击「停止录制」结束');
  }catch(error){stopRecording();toast(`无法开始录制：${error.message}`);}
}
function setRecordingUi(yes) {
  $('record-button').classList.toggle('recording',yes);$('recording-badge').hidden=!yes;
  $('record-button').innerHTML=yes?'<svg><use href="#i-film"/></svg>停止录制<span>■</span>':'<svg><use href="#i-film"/></svg>录制短片<span>最长 30s</span>';
  for(const selector of ['[data-ratio]','#audio-file','#upload-button','#demo-button','#import-project','#reset-button','#seek','#restart-button','#loop-button'])document.querySelectorAll(selector).forEach(element=>element.disabled=yes);
}
function stopRecording() {
  clearTimeout(recordTimer);state.recording=false;setRecordingUi(false);
  if(recorder&&recorder.state!=='inactive')recorder.stop();
}

$('upload-button').onclick=()=>$('audio-file').click();
$('audio-file').onchange=e=>{const file=e.target.files[0];if(file)loadAudio(file);e.target.value='';};
$('demo-button').onclick=()=>loadAudio();
for(const event of ['dragenter','dragover'])document.addEventListener(event,e=>{if(e.dataTransfer?.types.includes('Files')){e.preventDefault();document.body.classList.add('drag-over');}});
document.addEventListener('dragleave',e=>{if(!e.relatedTarget)document.body.classList.remove('drag-over');});
document.addEventListener('drop',e=>{e.preventDefault();document.body.classList.remove('drag-over');const file=e.dataTransfer.files[0];if(file)loadAudio(file);});
$('play-button').onclick=togglePlay;$('stage-play').onclick=togglePlay;
$('restart-button').onclick=async()=>{try{await engine.seek(0);syncPlayButtons();}catch(error){toast(error.message);}};
$('loop-button').onclick=()=>{engine.setLoop(!engine.loop);$('loop-button').setAttribute('aria-pressed',String(engine.loop));toast(engine.loop?'循环播放已开启':'循环播放已关闭');};
$('volume').oninput=e=>engine.setVolume(Number(e.target.value));
$('seek').oninput=async e=>{if(!state.recording)try{await engine.seek(Number(e.target.value));syncPlayButtons();}catch(error){toast(error.message);}};
document.addEventListener('keydown',e=>{if(e.code==='Space'&&!['INPUT','TEXTAREA','SELECT','BUTTON'].includes(document.activeElement.tagName)&&!$('help-dialog').open){e.preventDefault();togglePlay();}});
document.querySelectorAll('[data-theme]').forEach(button=>button.onclick=()=>{state.settings.theme=button.dataset.theme;syncSettings();});
document.querySelectorAll('[data-palette]').forEach(button=>button.onclick=()=>{state.settings.palette=button.dataset.palette;syncSettings();});
document.querySelectorAll('[data-ratio]').forEach(button=>button.onclick=()=>{state.settings.ratio=button.dataset.ratio;syncSettings();});
for(const name of ['sensitivity','motion','density','glow'])$(name).oninput=e=>{state.settings[name]=Number(e.target.value);$(`${name}-value`).textContent=name==='density'?e.target.value:name==='glow'?`${Math.round(state.settings[name]*100)}%`:`${state.settings[name].toFixed(2)}×`;};
$('artwork-title').oninput=e=>state.settings.title=e.target.value;
$('reset-button').onclick=()=>{const title=state.settings.title;state.settings={...DEFAULT_SETTINGS,title};syncSettings();toast('视觉参数已恢复默认');};
$('fullscreen-button').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await $('stage').requestFullscreen();}catch{toast('当前浏览器无法进入全屏，可放大浏览器窗口预览');}};
window.addEventListener('resize',resizeCanvas);document.addEventListener('fullscreenchange',()=>setTimeout(resizeCanvas,50));new ResizeObserver(resizeCanvas).observe($('stage'));
$('snapshot-button').onclick=()=>canvas.toBlob(blob=>{if(blob){download(blob,`resonance-${state.settings.theme}-${Date.now()}.png`);toast(`画面已导出 · ${canvas.width} × ${canvas.height}`);}},'image/png');
$('record-button').onclick=startRecording;
$('save-project').onclick=()=>{const project={application:'resonance-studio',version:1,settings:{...state.settings},audio:state.track};download(new Blob([JSON.stringify(project,null,2)],{type:'application/json'}),'resonance-project.json');toast('方案已保存。音频文件不包含在 JSON 中');};
$('import-project').onclick=()=>$('project-file').click();
$('project-file').onchange=async e=>{
  const file=e.target.files[0];e.target.value='';if(!file)return;
  if(file.size>100000){toast('方案文件过大，请选择导出的 JSON 文件');return;}
  try{
    const result=validateProject(JSON.parse(await file.text()));state.settings=result.settings;syncSettings();
    if(result.audio&&(result.audio.name!==state.track?.name||Math.abs(result.audio.duration-(state.track?.duration||0))>.1))toast(`方案已打开，请重新导入对应音频：${String(result.audio.name||'原音频').slice(0,80)}`);
    else toast('创作方案已恢复');
  }catch(error){toast(error instanceof SyntaxError?'无法解析这个 JSON 文件':error.message);}
};
$('download-demo').onclick=()=>{const {samples,sampleRate}=synthesizeDemo();download(new Blob([encodeWav(samples,sampleRate)],{type:'audio/wav'}),'Amber-and-Air-original-demo.wav');toast('原创示例音频已下载，可用于测试和项目演示');};
$('help-button').onclick=()=>$('help-dialog').showModal();$('close-help').onclick=()=>$('help-dialog').close();$('help-start').onclick=()=>$('help-dialog').close();
document.addEventListener('visibilitychange',()=>{if(document.hidden&&state.recording){stopRecording();toast('页面进入后台，已结束录制以避免缺帧');}});
if(!getRecordingType())$('record-help').textContent='此浏览器可能不支持录制；PNG 可用';
syncSettings();setLoading(true);requestAnimationFrame(animate);loadAudio();
