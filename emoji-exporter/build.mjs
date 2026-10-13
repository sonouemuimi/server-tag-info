import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const names=['core','platform','download','index'];
let source='';
for(const name of names) source+=(await readFile(`src/${name}.js`,'utf8')).replace(/^import .*?;\n/gm,'').replace(/^export /gm,'')+'\n';
const bundle='(()=>{\n"use strict";\n'+source+'\nreturn createPlugin(vendetta);\n})()';
// Validate syntax as the same expression the Vendetta loader evaluates.
new Function('vendetta','return '+bundle);
const dir='dist/emoji-exporter';await mkdir(dir,{recursive:true});
await writeFile(dir+'/index.js',bundle);
const manifest=JSON.parse(await readFile('manifest.json','utf8'));
manifest.hash=createHash('sha256').update(bundle).digest('hex');
await writeFile(dir+'/manifest.json',JSON.stringify(manifest,null,2)+'\n');
console.log(`Built ${dir}: ${Buffer.byteLength(bundle)} bytes, sha256 ${manifest.hash}`);
