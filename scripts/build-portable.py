from pathlib import Path
import re,json
project=Path(__file__).resolve().parents[1]
root=project/'dist'
out=project/'Resonance-Studio.html'
def source(name):
    text=(root/name).read_text()
    text=re.sub(r'^import .*?;\s*$', '', text, flags=re.M)
    text=re.sub(r'\bexport\s+(?=(?:const|function|class)\b)', '', text)
    return text
worker=source('dsp.js')+'\n'+source('audio-worker.js')
worker_literal=json.dumps(worker,ensure_ascii=False).replace('</','<\\/')
app=source('app.js').replace("new Worker('./audio-worker.js',{type:'module'})",'new Worker(analysisWorkerUrl)')
code='(()=>{\n'+ '\n'.join(source(x) for x in ['dsp.js','visuals.js','settings.js','audio-engine.js'])+'\nconst analysisWorkerUrl=URL.createObjectURL(new Blob(['+worker_literal+'],{type:"text/javascript"}));\n'+app+'\n})();'
html=(root/'index.html').read_text().replace('<link rel="stylesheet" href="./styles.css">','<style>\n'+(root/'styles.css').read_text()+'\n</style>')
html=html.replace('<script type="module" src="./app.js"></script>','<script>\n'+code+'\n</script>')
html=html.replace('<title>Resonance Studio · 共振视觉工作台</title>','<title>Resonance Studio · 本地直接打开版</title>').replace('href="./" aria-label="Resonance Studio 首页"','href="#" aria-label="Resonance Studio 首页"')
out.write_text(html)
print('Portable HTML:',out,'bytes:',out.stat().st_size)
assert 'src="./app.js"' not in html and 'href="./styles.css"' not in html
assert 'new Worker(analysisWorkerUrl)' in html
