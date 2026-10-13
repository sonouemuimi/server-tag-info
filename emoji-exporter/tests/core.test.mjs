import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync,mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {safeName,normalize,zip,utf8,base64,emojiURL,validateImage,MAX_PART} from '../src/core.js';
import {Downloader,exportJob} from '../src/download.js';
import {createPlatform} from '../src/platform.js';
const e={id:'123456789012345678',name:'开心',animated:false};
const png=new Uint8Array([137,80,78,71,13,10,26,10,1,2,3]);
const gif=new Uint8Array([71,73,70,56,57,97,1,2,3]);
test('strict local metadata, guild isolation, dedup, no animation guessing',()=>{
 const cyc={};cyc.self=cyc;
 const result=normalize([[e,{...e,name:'latest'}, {...e,id:'222222',animated:undefined},{...e,id:'333333',guild_id:'other'},cyc]],'guild');
 assert.equal(result.emojis.length,1);assert.equal(result.emojis[0].name,'latest');assert.equal(result.unknown,1);
 assert.throws(()=>emojiURL({...e,id:'../api'}));assert.throws(()=>emojiURL({...e,animated:undefined}));
 assert.equal(emojiURL(e),'https://cdn.discordapp.com/emojis/123456789012345678.png');
});
test('safe paths, UTF8 and binary base64 are lossless',()=>{
 assert(!safeName('../../a\\b').includes('/'));assert(!safeName('..').includes('..'));
 const bytes=utf8('中文😀');assert.deepEqual(Buffer.from(bytes),Buffer.from('中文😀'));
 assert.equal(base64(bytes),Buffer.from(bytes).toString('base64'));
 for(let n=0;n<200;n++){const b=new Uint8Array(n).map((_,i)=>i%256);assert.equal(base64(b),Buffer.from(b).toString('base64'));}
});
test('ZIP readable by independent Python decoder, Unicode names, exact GIF bytes and CRC',()=>{
 const p=mkdtempSync(tmpdir()+'/emoji-test-')+'/test.zip';
 writeFileSync(p,zip([{name:'服务器/动态_123.gif',data:gif},{name:'服务器/manifest.json',data:utf8('{"ok":true}')}]));
 const out=execFileSync('python3',['-c',"import zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;assert z.read('服务器/动态_123.gif')==bytes([71,73,70,56,57,97,1,2,3]);print(len(z.namelist()))",p],{encoding:'utf8'});
 assert.equal(out.trim(),'2');
});
test('wrong formats and oversized payloads fail closed',()=>{
 assert.throws(()=>validateImage(png,true));assert.throws(()=>validateImage(gif,false));
 assert.throws(()=>validateImage(new Uint8Array(3*1024*1024),false));
 assert.deepEqual(validateImage(gif,true),gif);
});
class FakeXHR {
 static instances=[];
 constructor(){FakeXHR.instances.push(this);this.status=200;this.response=png.buffer;}
 open(...args){this.args=args;}
 send(body){this.body=body;queueMicrotask(()=>this.onload?.());}
 abort(){this.onabort?.();}
}
test('transport issues credential-free GET only and validates bytes',async()=>{
 const dl=new Downloader(FakeXHR);assert.deepEqual(await dl.image(e),png);
 const x=FakeXHR.instances.at(-1);assert.deepEqual(x.args,['GET',emojiURL(e),true]);assert.equal(x.withCredentials,false);assert.equal(x.body,null);assert.equal(x.timeout,30000);
});
test('cancel aborts pending XHR and prevents new requests',async()=>{
 class Pending extends FakeXHR {send(){}}
 const dl=new Downloader(Pending),p=dl.image(e);dl.cancel();await assert.rejects(p,/取消/);await assert.rejects(dl.image(e),/取消/);assert.equal(dl.active,null);
});
test('format, HTTP, size and unexpected final URL errors are contained',async()=>{
 for(const setup of [x=>x.status=403,x=>x.response=gif.buffer,x=>x.responseURL='https://example.com/a']){
  class Bad extends FakeXHR {constructor(){super();setup(this);}}
  await assert.rejects(new Downloader(Bad).image(e));
 }
 class Big extends FakeXHR {send(){this.onprogress({loaded:3*1024*1024});}}
 await assert.rejects(new Downloader(Big).image(e),/上限/);
});
test('export uses bounded independent ZIPs; counts only persisted successes',async()=>{
 const writes=[],states=[],data=new Uint8Array(2*1024*1024);
 data.set(png);const items=Array.from({length:6},(_,i)=>({...e,id:String(100000+i)}));
 const result=await exportJob({guild:{id:'111111',name:'测试'},emojis:items,downloader:{stopped:false,async image(){return data;}},platform:{async write(name,b64){writes.push({name,b64});return{path:'/private/'+name};}},update:s=>states.push(s)});
 assert.equal(result.success,6);assert.equal(writes.length,2);assert(writes.every(x=>Buffer.from(x.b64,'base64').length<MAX_PART+1024*1024));assert.equal(result.failed.length,0);
 assert(result.outputs[1].filename.endsWith('_part2.zip'));
});
test('failed downloads are retryable; write failure is not reported as saved',async()=>{
 let i=0;
 const result=await exportJob({guild:{id:'111111',name:'g'},emojis:[e,{...e,id:'222222'}],downloader:{stopped:false,async image(){if(i++===0)throw Error('offline');return png;}},platform:{async write(){throw Error('disk full');}},update(){}});
 assert.equal(result.failed.length,1);assert.equal(result.success,0);assert.match(result.error,/disk full/);
});
test('429 stops subsequent requests without automatic retries',async()=>{
 let calls=0;
 const result=await exportJob({guild:{id:'111111',name:'g'},emojis:[e,{...e,id:'222222'}],downloader:{stopped:false,async image(){calls++;throw Object.assign(Error('429'),{status:429});}},platform:{},update(){}});
 assert.equal(calls,1);assert.equal(result.failed.length,2);
});
test('cancel drops uncommitted part and retains written files only',async()=>{
 const dl={stopped:false,async image(){this.stopped=true;return png;}};
 const r=await exportJob({guild:{id:'111111',name:'g'},emojis:[e],downloader:dl,platform:{async write(){throw Error('must not write');}},update(){}});
 assert.equal(r.success,0);assert(r.cancelled);
});
test('store and native adapters work from capability mocks, diagnostics exclude records',async()=>{
 const stores={GuildStore:{getGuilds:()=>({'111111':{id:'111111',name:'secret name'}})},EmojiStore:{getGuilds:()=>({'111111':{emojis:[e]}})}};
 const p=createPlatform({metro:{common:{ReactNative:{NativeModules:{RTNFileManager:{async writeFile(dir,path,data,encoding){assert.equal(dir,'documents');assert.equal(encoding,'base64');return '/private/'+path;}}}}},findByStoreName:n=>stores[n]}});
 assert.equal(p.guilds().length,1);assert.equal(normalize(p.read('111111'),'111111').emojis.length,1);assert.throws(()=>p.read('999999'));
 assert(!(p.diagnostics().includes(e.name)));assert(!p.diagnostics().includes('secret name'));
 assert.equal((await p.write('a.zip','abc')).path,'/private/emoji-exporter/a.zip');assert.equal(p.canShare,false);
 await assert.rejects(p.shareFile('/private/a.zip','application/zip'),/桥接/);
});
test('built expression loads and unloads with Vendetta-compatible API',async()=>{
 const src=readFileSync(new URL('../dist/emoji-exporter/index.js',import.meta.url),'utf8');
 const R={Component:class{},createElement(){}};
 const plugin=new Function('vendetta','return '+src)({metro:{common:{React:R,ReactNative:{}}}});
 assert.equal(typeof plugin.settings,'function');plugin.onLoad();plugin.onUnload();
 assert(!src.includes('/users/@me/guilds'));assert(!src.includes('/guilds/'));
});
