export const DEFAULT_SETTINGS = Object.freeze({theme:'bloom',palette:'amber',ratio:'16:9',sensitivity:1,motion:.7,density:100,glow:.6,seed:1738,title:'AMBER & AIR'});
const bounds = {sensitivity:[.3,2],motion:[0,1.5],density:[40,180],glow:[0,1],seed:[0,4294967295]};
export function validateProject(value) {
  if (!value || value.application !== 'resonance-studio' || value.version !== 1 || !value.settings || typeof value.settings !== 'object') throw new Error('这不是支持的 Resonance Studio 方案');
  const source=value.settings, settings={...DEFAULT_SETTINGS};
  for(const [key, allowed] of Object.entries({theme:['bloom','orbit','geometry'],palette:['amber','sea','rose','moss'],ratio:['16:9','1:1','9:16']})) {
    if(!allowed.includes(source[key])) throw new Error('方案中的主题、配色或比例无效');
    settings[key]=source[key];
  }
  for(const [key,[min,max]] of Object.entries(bounds)) {
    if(typeof source[key]!=='number'||!Number.isFinite(source[key])||source[key]<min||source[key]>max) throw new Error('方案参数超出支持范围');
    settings[key]=key==='density'||key==='seed'?Math.round(source[key]):source[key];
  }
  settings.title=typeof source.title==='string'?source.title.slice(0,42):'';
  return {settings,audio:value.audio&&typeof value.audio==='object'?value.audio:null};
}
