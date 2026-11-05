import { clamp, seededRandom } from './dsp.js';

export const PALETTES = {
  amber: {name:'琥珀日落', colors:['#f5cf91','#de916b','#e6b6ae'], bg:'#141a1b'},
  sea: {name:'海盐蓝', colors:['#a2d6d2','#7ea6e0','#e1e8df'], bg:'#101c24'},
  rose: {name:'玫瑰雾', colors:['#edb8cc','#bdacd8','#efcfa8'], bg:'#201923'},
  moss: {name:'林间微光', colors:['#bdcf9e','#e6d5a7','#82aea0'], bg:'#141d19'}
};
export const THEMES = {
  bloom: {name:'花瓣粒子',en:'SONIC BLOOM',caption:'每一次起伏，都有绽放的形状。'},
  orbit: {name:'星环频谱',en:'ORBITAL ECHO',caption:'让频率，留下环绕的轨迹。'},
  geometry: {name:'几何律动',en:'FORM & FREQUENCY',caption:'把声音，折叠成有序的韵律。'}
};

function rgba(hex, alpha) {
  return `rgba(${parseInt(hex.slice(1,3),16)},${parseInt(hex.slice(3,5),16)},${parseInt(hex.slice(5,7),16)},${clamp(alpha)})`;
}

function petal(ctx,x,y,length,width,rotation,color,alpha) {
  ctx.save();ctx.translate(x,y);ctx.rotate(rotation);
  const grad=ctx.createLinearGradient(0,-length,0,length*.2);
  grad.addColorStop(0,rgba(color,alpha));grad.addColorStop(.65,rgba(color,alpha*.35));grad.addColorStop(1,rgba(color,.015));
  ctx.fillStyle=grad;ctx.strokeStyle=rgba(color,alpha*.65);ctx.lineWidth=.7;
  ctx.beginPath();ctx.moveTo(0,length*.16);
  ctx.bezierCurveTo(-width,-length*.18,-width*.66,-length*.8,0,-length);
  ctx.bezierCurveTo(width*.66,-length*.8,width,-length*.18,0,length*.16);
  ctx.fill();ctx.stroke();ctx.restore();
}

/** All drawing state derives from audio time, fixed seed and precomputed features. */
export function renderVisual(ctx,w,h,time,features,settings,metadata={}) {
  const palette=PALETTES[settings.palette] || PALETTES.amber;
  const theme=THEMES[settings.theme] || THEMES.bloom;
  const rng=seededRandom(settings.seed || 1738);
  const scale=Math.min(w,h), gain=settings.sensitivity;
  const energy=clamp(features.rms*gain),low=clamp(features.low*gain),high=clamp(features.high*gain);
  const hit=clamp(features.onset*gain),motion=settings.motion;
  ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,w,h);ctx.fillStyle=palette.bg;ctx.fillRect(0,0,w,h);
  const vignette=ctx.createRadialGradient(w*.5,h*.49,0,w*.5,h*.5,scale*.85);
  vignette.addColorStop(0,rgba(palette.colors[0],.065+.055*energy*settings.glow));vignette.addColorStop(1,'rgba(0,0,0,.3)');
  ctx.fillStyle=vignette;ctx.fillRect(0,0,w,h);
  const dots=Math.floor(settings.density*.8);
  for(let i=0;i<dots;i++) {
    const x0=rng(),y0=rng(),speed=.3+rng(),phase=rng()*6.28;
    const x=(x0*w+Math.sin(time*.12*motion+phase)*scale*.025+w)%w;
    const y=(y0*h-time*speed*motion*1.7+h*100)%h;
    ctx.fillStyle=rgba(palette.colors[i%3],.12+high*.2*(.5+.5*Math.sin(time+phase)));
    ctx.beginPath();ctx.arc(x,y,(.5+rng())*scale/600,0,Math.PI*2);ctx.fill();
  }
  const cx=w*.5,cy=h*.49;
  ctx.save();ctx.translate(cx,cy);
  if(settings.theme==='bloom') {
    const base=scale*(.135+.026*low),rotation=time*.055*motion;
    const count=Math.round(settings.density/5);
    for(let layer=3;layer>=0;layer--) {
      const n=count+layer*3;
      for(let i=0;i<n;i++) {
        const a=i/n*Math.PI*2+rotation*(layer%2?-1:1)+layer*.22;
        const band=features.spectrum[(i*3+layer*7)%features.spectrum.length]||0;
        const length=base*(1.05+layer*.28)*(1+band*.14*gain+hit*.08);
        petal(ctx,Math.sin(a)*scale*.007,Math.cos(a)*scale*.007,length,length*(.23+layer*.025),a,palette.colors[layer%3],(.24+energy*.15)*(1-layer*.08));
      }
    }
    ctx.strokeStyle=rgba(palette.colors[0],.45);ctx.lineWidth=.8;
    for(let i=0;i<3;i++){ctx.beginPath();ctx.arc(0,0,scale*(.027+i*.009)+low*scale*.006,0,Math.PI*2);ctx.stroke();}
    ctx.fillStyle=rgba(palette.colors[0],.8);ctx.beginPath();ctx.arc(0,0,scale*.005*(1+hit),0,Math.PI*2);ctx.fill();
  } else if(settings.theme==='orbit') {
    const radius=scale*(.18+.016*low), bins=features.spectrum;
    ctx.rotate(time*.025*motion);
    for(let ring=0;ring<3;ring++) {
      ctx.save();ctx.rotate(ring*.8+time*.08*motion*(ring%2?1:-1));ctx.scale(1,.42+ring*.14);
      ctx.strokeStyle=rgba(palette.colors[ring],.3+energy*.2);ctx.lineWidth=scale*.0011;
      ctx.beginPath();ctx.arc(0,0,radius*(1.15+ring*.3),0,Math.PI*2);ctx.stroke();ctx.restore();
    }
    const count=Math.min(128,Math.round(settings.density));
    for(let i=0;i<count;i++) {
      const a=i/count*Math.PI*2,v=bins[Math.floor(i/count*bins.length)]||0;
      const r=radius*(.98+Math.sin(a*4+time*.5*motion)*.02);
      const end=r+scale*(.008+v*.095*gain);
      ctx.strokeStyle=rgba(palette.colors[Math.floor(i/count*3)],.35+v*.55);ctx.lineWidth=scale*.0025;
      ctx.beginPath();ctx.moveTo(Math.cos(a)*r,Math.sin(a)*r);ctx.lineTo(Math.cos(a)*end,Math.sin(a)*end);ctx.stroke();
    }
    ctx.fillStyle=rgba(palette.colors[0],.65);ctx.font=`${scale*.021}px Georgia,serif`;ctx.textAlign='center';ctx.fillText('RESONANCE',0,scale*.006);
  } else {
    const rows=5,cols=Math.max(5,Math.min(11,Math.round(settings.density/16))),spacing=scale*.075;
    for(let row=0;row<rows;row++)for(let col=0;col<cols;col++) {
      const idx=row*cols+col,v=features.spectrum[idx%features.spectrum.length]||0;
      const x=(col-(cols-1)/2)*spacing,y=(row-2)*spacing;
      const s=spacing*(.22+v*.42*gain),a=time*.1*motion+(row+col)*.17+hit*.12;
      ctx.save();ctx.translate(x,y);ctx.rotate(a);ctx.strokeStyle=rgba(palette.colors[(row+col)%3],.3+v*.5);
      ctx.fillStyle=rgba(palette.colors[(row+col)%3],.025+v*.09);ctx.lineWidth=scale*.0011;
      ctx.beginPath();ctx.moveTo(0,-s);ctx.lineTo(s,0);ctx.lineTo(0,s);ctx.lineTo(-s,0);ctx.closePath();ctx.fill();ctx.stroke();ctx.restore();
    }
  }
  ctx.restore();
  if(settings.glow>.1) {
    const halo=ctx.createRadialGradient(cx,cy,0,cx,cy,scale*.24);
    halo.addColorStop(0,rgba(palette.colors[0],energy*.025*settings.glow));halo.addColorStop(1,'transparent');
    ctx.fillStyle=halo;ctx.fillRect(0,0,w,h);
  }
  const margin=scale*.068;
  ctx.textAlign='left';ctx.fillStyle=rgba(palette.colors[0],.55);ctx.font=`${scale*.017}px ui-monospace,monospace`;
  ctx.fillText(theme.en,margin,margin);
  ctx.fillStyle='rgba(239,236,227,.4)';ctx.font=`${scale*.016}px sans-serif`;ctx.fillText('A STUDY IN SOUND & MOTION',margin,h-margin);
  ctx.textAlign='right';ctx.font=`${scale*.017}px ui-monospace,monospace`;ctx.fillText(`${String(Math.floor(time/60)).padStart(2,'0')}:${(time%60).toFixed(1).padStart(4,'0')}`,w-margin,h-margin);
  ctx.fillStyle='rgba(239,236,227,.27)';ctx.font=`${scale*.015}px sans-serif`;ctx.fillText(metadata.title||'RESONANCE STUDIO',w-margin,margin);
}
