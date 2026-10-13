(()=>{
"use strict";
// Pure functions: no Discord account state, networking, or native dependencies.
const MAX_IMAGE = 2 * 1024 * 1024;
const MAX_PART = 8 * 1024 * 1024;
function safeName(s) {
  return String(s || 'unnamed').replace(/[\x00-\x1f\x7f/\\:*?"<>|]/g, '_').replace(/^\.+|[. ]+$/g, '').slice(0, 70) || 'unnamed';
}
function emojiURL(e) {
  if (!/^\d{5,22}$/.test(e.id) || typeof e.animated !== 'boolean') throw Error('Invalid emoji metadata');
  return `https://cdn.discordapp.com/emojis/${e.id}.${e.animated ? 'gif' : 'png'}`;
}
function normalize(raw, guildId) {
  const found = new Map(); let unknown = 0; const seen = new Set();
  function visit(value, depth) {
    if (!value || typeof value !== 'object' || seen.has(value) || depth > 5) return;
    seen.add(value);
    if (value.id != null) {
      const id = String(value.id), gid = value.guildId ?? value.guild_id;
      if (!/^\d{5,22}$/.test(id) || typeof value.name !== 'string' || (gid != null && String(gid) !== guildId)) return;
      if (typeof value.animated !== 'boolean') { unknown++; return; }
      found.set(id, {id, name: value.name, animated: value.animated}); return;
    }
    if (value instanceof Map) for (const v of value.values()) visit(v, depth + 1);
    else if (Array.isArray(value)) for (const v of value) visit(v, depth + 1);
    else if (value.emojis) visit(value.emojis, depth + 1);
    else for (const k of Object.keys(value).slice(0, 5000)) visit(value[k], depth + 1);
  }
  visit(raw, 0);
  return {emojis: [...found.values()].sort((a,b)=>a.name.localeCompare(b.name)), unknown};
}
function utf8(text) {
  const bytes = [];
  for (const ch of String(text)) {
    const c = ch.codePointAt(0);
    if (c < 128) bytes.push(c);
    else if (c < 2048) bytes.push(192 | c >> 6, 128 | c & 63);
    else if (c < 65536) bytes.push(224 | c >> 12, 128 | c >> 6 & 63, 128 | c & 63);
    else bytes.push(240 | c >> 18, 128 | c >> 12 & 63, 128 | c >> 6 & 63, 128 | c & 63);
  }
  return new Uint8Array(bytes);
}
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function base64(bytes) {
  const parts = []; let s = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = bytes[i] * 65536 + (bytes[i+1] || 0) * 256 + (bytes[i+2] || 0);
    s += alphabet[n >>> 18] + alphabet[n >>> 12 & 63] + (i+1 < bytes.length ? alphabet[n >>> 6 & 63] : '=') + (i+2 < bytes.length ? alphabet[n & 63] : '=');
    if (s.length >= 16384) {parts.push(s); s = '';}
  }
  parts.push(s); return parts.join('');
}
const crcTable = new Uint32Array(256);
for (let i=0;i<256;i++) {let c=i;for(let j=0;j<8;j++)c=c&1?0xedb88320^(c>>>1):c>>>1;crcTable[i]=c;}
function crc32(bytes) {let c=0xffffffff;for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8);return(c^0xffffffff)>>>0;}
// ZIP STORE: no recompression, GIF bytes and animation stay untouched. UTF-8 filenames.
function zip(entries) {
  if (entries.length > 60000) throw Error('Too many ZIP entries');
  const files = entries.map(e=>({...e, encoded:utf8(e.name), crc:crc32(e.data)}));
  const size = files.reduce((n,e)=>n+76+e.encoded.length*2+e.data.length,22);
  if(size > MAX_PART + 2*1024*1024) throw Error('ZIP memory budget exceeded');
  const out=new Uint8Array(size), view=new DataView(out.buffer); let p=0;
  const u16=n=>{view.setUint16(p,n,true);p+=2;}, u32=n=>{view.setUint32(p,n,true);p+=4;};
  const put=b=>{out.set(b,p);p+=b.length;};
  for(const e of files) {
    e.offset=p;u32(0x04034b50);u16(20);u16(0x800);u16(0);u16(0);u16(33);u32(e.crc);u32(e.data.length);u32(e.data.length);u16(e.encoded.length);u16(0);put(e.encoded);put(e.data);
  }
  const start=p;
  for(const e of files) {
    u32(0x02014b50);u16(20);u16(20);u16(0x800);u16(0);u16(0);u16(33);u32(e.crc);u32(e.data.length);u32(e.data.length);u16(e.encoded.length);u16(0);u16(0);u16(0);u16(0);u32(0);u32(e.offset);put(e.encoded);
  }
  const end=p;u32(0x06054b50);u16(0);u16(0);u16(files.length);u16(files.length);u32(end-start);u32(start);u16(0);return out;
}
function validateImage(data, animated) {
  const b = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (!b.length || b.length > MAX_IMAGE) throw Error('图片为空或超过 2 MiB 安全上限');
  const gif = b[0]===71 && b[1]===73 && b[2]===70 && b[3]===56 && (b[4]===55 || b[4]===57) && b[5]===97;
  const png = [137,80,78,71,13,10,26,10].every((v,i)=>b[i]===v);
  if (animated ? !gif : !png) throw Error('CDN 图片格式与 animated 属性不符，未猜测或转换格式');
  return b;
}

function createPlatform(v) {
  const metro=v.metro, RN=metro.common.ReactNative;
  const notes=[];
  const store=name=>{try{return metro.findByStoreName(name);}catch{return null;}};
  const guildStore=store('GuildStore');
  const emojiStores=['EmojiStore','GuildEmojiStore'].map(name=>({name, value:store(name)})).filter(x=>x.value);
  function native(names) {
    for(const n of names) {
      try { const m=globalThis.__turboModuleProxy?.(n) || globalThis.nativeModuleProxy?.[n] || RN.NativeModules?.[n]; if(m)return m; } catch {}
    }
  }
  const fs=native(['NativeFileModule','RTNFileManager','DCDFileManager']);
  const share=native(['RNShare']);
  function guilds() {
    if(!guildStore?.getGuilds)throw Error('未找到可用 GuildStore；请打开服务器后重试');
    return Object.values(guildStore.getGuilds() || {}).filter(g=>g && /^\d{5,22}$/.test(String(g.id)) && !g.unavailable).map(g=>({id:String(g.id),name:String(g.name || g.id),icon:g.icon}));
  }
  function read(id) {
    if (!guilds().some(g=>g.id===id)) throw Error('服务器已不在可用的本地服务器列表中');
    const records=[];notes.length=0;
    for(const {name,value:s} of emojiStores) {
      // Only read established store getter shapes. Never use action / REST modules.
      try {
        if(typeof s.getGuilds==='function') {
          const group=s.getGuilds()?.[id];
          if(group?.emojis) {records.push(group.emojis);notes.push(name+'.getGuilds()[id].emojis');}
        }
      }catch{notes.push(name+': getter failed');}
      try {
        if(typeof s.getGuildEmoji==='function') {const result=s.getGuildEmoji(id);if(result){records.push(result);notes.push(name+'.getGuildEmoji(id)');}}
      }catch{notes.push(name+': guild getter failed');}
    }
    // Guild objects may carry gateway emoji records in certain builds.
    try {const g=guildStore.getGuild?.(id);if(g?.emojis){records.push(g.emojis);notes.push('GuildStore.getGuild(id).emojis');}}catch{}
    return records;
  }
  async function write(filename, data) {
    if(!fs?.writeFile)throw Error('此客户端没有可用的原生文件写入桥接');
    const relative='emoji-exporter/'+filename;
    const path=await fs.writeFile('documents',relative,data,'base64');
    if(typeof path!=='string' || !path) throw Error('原生写入未返回保存路径');
    return {path,relative};
  }
  async function shareFile(path, mime) {
    if(!share?.open) throw Error('未检测到 RNShare 文件分享桥接。文件保存在 Discord 私有目录；可用 root 文件管理器复制。请复制兼容性诊断反馈。');
    return share.open({url:path.startsWith('file:') || path.startsWith('content:') ? path : 'file://'+path,type:mime,failOnCancel:false});
  }
  function diagnostics() {
    const methods=['getGuilds','getGuildEmoji'];
    return JSON.stringify({version:'1.0.0',runtime:'Vendetta compatibility',guildStore:!!guildStore,emojiStores:emojiStores.map(({name,value})=>({name,methods:methods.filter(m=>typeof value[m]==='function')})),fileWrite:!!fs?.writeFile,fileShare:!!share?.open,systemSavePicker:false,sources:notes,completeness:'unverified'},null,2);
  }
  return {guilds,read,write,shareFile,diagnostics,canWrite:!!fs?.writeFile,canShare:!!share?.open};
}

// One XHR at a time (including user-triggered previews). Never Discord's REST client.
class Downloader {
  constructor(XHR=globalThis.XMLHttpRequest) {this.XHR=XHR;this.active=null;this.stopped=false;}
  cancel(){this.stopped=true;this.active?.abort();}
  async image(e) {
    if(this.stopped)throw Error('已取消');
    if(this.active)throw Error('已有图片请求进行中，请稍后再试');
    return new Promise((resolve,reject)=>{
      const x=new this.XHR(); this.active=x;let settled=false;
      const finish=(err,bytes)=>{if(settled)return;settled=true;this.active=null;x.onload=x.onerror=x.onabort=x.ontimeout=x.onprogress=null;err?reject(err):resolve(bytes);};
      try {
        x.open('GET',emojiURL(e),true);x.withCredentials=false;x.responseType='arraybuffer';x.timeout=30000;
        x.onprogress=ev=>{if(ev.loaded>MAX_IMAGE || (ev.lengthComputable && ev.total>MAX_IMAGE)){finish(Error('图片超过 2 MiB 安全上限'));x.abort();}};
        x.onload=()=>{
          try {
            if(x.status!==200){const err=Error('CDN HTTP '+x.status);err.status=x.status;throw err;}
            if(x.responseURL && !/^https:\/\/cdn\.discordapp\.com\/emojis\/\d+\.(png|gif)(\?|$)/.test(x.responseURL))throw Error('CDN 返回了非预期地址');
            if(this.stopped)throw Error('已取消');
            finish(null,validateImage(x.response,e.animated));
          }catch(err){finish(err);}
        };
        x.onerror=()=>finish(Error('CDN 网络错误'));x.ontimeout=()=>finish(Error('CDN 下载超时'));
        x.onabort=()=>finish(Error('已取消'));x.send(null);
      }catch(err){finish(err);}
    });
  }
}
async function exportJob({guild,emojis,platform,downloader,update,single=false}) {
  const state={total:emojis.length,done:0,success:0,failed:[],outputs:[],cancelled:false,status:'正在下载'};
  const emit=()=>update({...state,failed:[...state.failed],outputs:[...state.outputs]});
  let entries=[],items=[],bytes=0,part=0;
  const folder=safeName(guild.name),session=Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,7);
  async function flush() {
    if(!entries.length)return;
    if(downloader.stopped)return;
    state.status='正在写入 ZIP';emit();
    const manifest={schemaVersion:1,guild:{id:guild.id,name:guild.name},createdAt:new Date().toISOString(),completeness:'unverified-loaded-cache-only',part:part+1,selectedCount:emojis.length,emojis:items};
    const out=zip([...entries,{name:folder+'/manifest.json',data:utf8(JSON.stringify(manifest,null,2))}]);
    const filename=folder+'_emojis'+(part?'_part'+(part+1):'')+'.zip';
    const saved=await platform.write(session+'/'+filename,base64(out));
    state.outputs.push({...saved,filename,mime:'application/zip',count:items.length});
    state.success+=items.length;part++;entries=[];items=[];bytes=0;emit();
  }
  emit();
  try {
    for(const e of emojis) {
      if(downloader.stopped)break;
      let data;
      state.status='正在下载：'+e.name;emit();
      try {data=await downloader.image(e);}catch(err){
        if(downloader.stopped)break;
        state.failed.push({...e,error:String(err.message || err)});state.done++;
        if(err.status===429){for(const pending of emojis.slice(state.done))state.failed.push({...pending,error:'CDN 限流，未发起请求；请稍后手动重试'});emit();break;}
        emit();continue;
      }
      const filename=safeName(e.name)+'_'+e.id+(e.animated?'.gif':'.png');
      if(single) {
        const saved=await platform.write(session+'/'+filename,base64(data));
        state.outputs.push({...saved,filename,mime:e.animated?'image/gif':'image/png',count:1});state.success++;
      } else {
        if(bytes+data.length>MAX_PART || entries.length>=500)await flush();
        if(downloader.stopped)break;
        entries.push({name:folder+'/'+filename,data});items.push({...e,filename});bytes+=data.length;
      }
      state.done++;emit();
      // Give Hermes / the UI time between downloads and ZIP parts.
      await new Promise(r=>setTimeout(r,0));
    }
    if(!downloader.stopped && !single)await flush();
    state.cancelled=downloader.stopped;
    state.status=state.cancelled?'已取消；保留已写入的文件，未写入的当前分包已丢弃':state.failed.length?'完成（有失败项）':'完成';
  }catch(err){state.status='导出失败：'+String(err.message || err);state.error=state.status;}
  finally {entries=[];items=[];emit();}
  return state;
}

function createPlugin(v) {
  const R=v.metro.common.React, RN=v.metro.common.ReactNative, h=R.createElement;
  let platform,enabled=true,current=null;const listeners=new Set();
  const notify=()=>{for(const f of listeners)f();};
  const getPlatform=()=>platform||(platform=createPlatform(v));
  const safeError=e=>String(e?.message || e).slice(0,500);
  function Settings() {
    const [guilds,setGuilds]=R.useState([]),[guild,setGuild]=R.useState(null),[emojis,setEmojis]=R.useState([]);
    const [selected,setSelected]=R.useState(new Set()),[query,setQuery]=R.useState(''),[message,setMessage]=R.useState('');
    const [progress,setProgress]=R.useState(null),[busy,setBusy]=R.useState(false),[preview,setPreview]=R.useState({});
    const [unknown,setUnknown]=R.useState(0),[off,setOff]=R.useState(!enabled);
    const systemTheme=RN.useColorScheme?.();
    let clientTheme;try{clientTheme=v.metro.findByStoreName('ThemeStore')?.theme;}catch{}
    const dark=(clientTheme || systemTheme)!=='light';
    const c=dark?{bg:'#1e1f22',panel:'#2b2d31',text:'#f2f3f5',muted:'#b5bac1',accent:'#5865f2'}:{bg:'#fff',panel:'#f2f3f5',text:'#313338',muted:'#5c5e66',accent:'#4752c4'};
    const alive=R.useRef(true);
    R.useEffect(()=>{
      alive.current=true;
      const f=()=>{setOff(!enabled);if(!enabled){setPreview({});setEmojis([]);setGuilds([]);setSelected(new Set());setProgress(null);setGuild(null);}};listeners.add(f);
      try{setGuilds(getPlatform().guilds());}catch(e){setMessage(safeError(e));}
      return()=>{alive.current=false;listeners.delete(f);current?.cancel();};
    },[]);
    function report(e){if(alive.current)setMessage(safeError(e));v.logger?.error?.('[EmojiExporter] '+safeError(e));}
    const text=(s,extra={})=>h(RN.Text,{style:{color:c.text,fontSize:15,marginVertical:5,...extra}},s);
    function button(label,action,disabled=false) {
      return h(RN.Pressable,{accessibilityRole:'button',accessibilityState:{disabled:disabled||off},disabled:disabled||off,onPress:()=>{try{Promise.resolve(action()).catch(report);}catch(e){report(e);}},style:{backgroundColor:c.accent,opacity:(disabled||off)?0.4:1,padding:10,borderRadius:8,margin:3}},text(label,{color:'#fff',marginVertical:0,fontSize:14}));
    }
    function choose(g) {
      platform=createPlatform(v);const p=getPlatform(),snapshot=normalize(p.read(g.id),g.id);
      setGuild(g);setEmojis(snapshot.emojis);setUnknown(snapshot.unknown);setSelected(new Set());setQuery('');setPreview({});setProgress(null);
      setMessage(snapshot.emojis.length?'数据来自本地缓存，完整性未验证。若数量不足，请先打开该服务器原生表情面板，再回来刷新。':'没有可用的已加载表情。请打开该服务器原生表情面板后刷新，或复制诊断。');
    }
    function selectWhere(fn){setSelected(new Set(emojis.filter(fn).map(e=>e.id)));}
    async function start(list,single=false) {
      if(busy || current || off || !list.length)return;
      // Revalidate each item against current local membership/cache before any request.
      const fresh=normalize(getPlatform().read(guild.id),guild.id).emojis;
      const valid=new Set(fresh.map(e=>e.id+':'+e.animated));
      if(list.some(e=>!valid.has(e.id+':'+e.animated)))throw Error('缓存已变化，请刷新列表后重新选择');
      if(!getPlatform().canWrite)throw Error('当前环境缺少原生文件写入功能');
      const dl=current=new Downloader();setBusy(true);setMessage('');
      try{await exportJob({guild,emojis:list,platform:getPlatform(),downloader:dl,single,update:s=>{if(alive.current)setProgress(s);}});}
      finally{if(current===dl)current=null;if(alive.current)setBusy(false);}
    }
    async function showPreview(e) {
      if(current || off)return;
      const dl=current=new Downloader();setBusy(true);
      try{
        getPlatform().read(guild.id);
        const data=await dl.image(e);
        if(alive.current)setPreview({[e.id]:'data:image/'+(e.animated?'gif':'png')+';base64,'+base64(data)});
      }finally{if(current===dl)current=null;if(alive.current)setBusy(false);}
    }
    const header=h(RN.View,{style:{padding:12}},
      text('Emoji Exporter',{fontSize:22,fontWeight:'700'}),
      off?text('插件已停用，请退出此页面。'):null,
      text('只读取已加载的服务器缓存。预览和下载均需主动点击；不请求账号 API。',{color:c.muted}),
      button('复制兼容性诊断',()=>{v.metro.common.clipboard.setString(getPlatform().diagnostics());setMessage('诊断已复制，不包含表情列表或账号信息');}),
      guild?button('‹ 返回服务器',()=>{setGuild(null);setQuery('');setPreview({});setMessage('');},busy):button('刷新本地服务器列表',()=>{platform=createPlatform(v);setGuilds(getPlatform().guilds());},busy),
      guild?text('◉ '+guild.name,{fontSize:19,fontWeight:'600'}):null,
      guild?text(`已加载 ${emojis.length} · 静态 ${emojis.filter(e=>!e.animated).length} · 动态 ${emojis.filter(e=>e.animated).length}`):null,
      guild?text('完整性未验证'+(unknown?`；另有 ${unknown} 条缺少 animated 属性，已跳过`:''),{color:c.muted}):null,
      guild?button('重新读取缓存',()=>choose(guild),busy):null,
      text(message,{color:c.muted}),
      h(RN.TextInput,{value:query,onChangeText:setQuery,editable:!busy,placeholder:guild?'搜索表情名称':'搜索服务器名称',placeholderTextColor:c.muted,style:{color:c.text,backgroundColor:c.panel,padding:12,borderRadius:8}}),
      guild?h(RN.View,{style:{flexDirection:'row',flexWrap:'wrap'}},
        button('全选',()=>selectWhere(()=>true),busy),button('取消全选',()=>selectWhere(()=>false),busy),
        button('仅选静态',()=>selectWhere(e=>!e.animated),busy),button('仅选动态',()=>selectWhere(e=>e.animated),busy)):null,
      guild?text('选择操作作用于整个已加载列表，不受搜索过滤影响。',{fontSize:12,color:c.muted}):null,
      guild?button(`导出选中 ${selected.size} 项（ZIP）`,()=>start(emojis.filter(e=>selected.has(e.id))),busy||!selected.size):null,
      guild?button('导出全部已加载表情（ZIP）',()=>start(emojis),busy||!emojis.length):null,
      guild?text('每包最多 8 MiB 图片，超出后生成多个独立 ZIP；不会重新压缩图片。',{fontSize:12,color:c.muted}):null,
      guild&&!getPlatform().canShare?text('当前未检测到文件分享桥接：只能写入 Discord 私有目录，需要 root 文件管理器取出。',{color:c.muted}):null,
      busy?button('取消任务',()=>current?.cancel()):null,
      progress?h(RN.View,{style:{padding:10,backgroundColor:c.panel,borderRadius:8}},
        text(`${progress.status}\n已处理 ${progress.done} / ${progress.total}\n已保存 ${progress.success} · 下载失败 ${progress.failed.length}`),
        !busy&&progress.failed.length?button('仅重试失败项',()=>start(progress.failed)):null,
        ...progress.outputs.map(o=>h(RN.View,{key:o.path},text(o.filename),text(o.path,{fontSize:11,color:c.muted}),
          button('分享文件 / 选择保存应用',()=>getPlatform().shareFile(o.path,o.mime),busy||!getPlatform().canShare),
          button('复制保存路径',()=>v.metro.common.clipboard.setString(o.path)))),
        ...progress.failed.slice(0,20).map(e=>text(e.name+'：'+e.error,{fontSize:12}))):null
    );
    const data=guild?emojis.filter(e=>e.name.toLowerCase().includes(query.toLowerCase())):guilds.filter(g=>g.name.toLowerCase().includes(query.toLowerCase()));
    return h(RN.FlatList,{style:{flex:1,backgroundColor:c.bg},contentContainerStyle:{paddingBottom:40},data,keyExtractor:e=>e.id,ListHeaderComponent:header,keyboardShouldPersistTaps:'handled',initialNumToRender:12,maxToRenderPerBatch:12,windowSize:5,
      renderItem:({item:e})=>guild?h(RN.View,{style:{marginHorizontal:12,marginVertical:3,padding:10,backgroundColor:c.panel,borderRadius:8}},
        h(RN.Pressable,{disabled:busy||off,accessibilityRole:'checkbox',accessibilityState:{checked:selected.has(e.id)},onPress:()=>setSelected(prev=>{const next=new Set(prev);next.has(e.id)?next.delete(e.id):next.add(e.id);return next;}),style:{flexDirection:'row',alignItems:'center'}},
          text(selected.has(e.id)?'☑  ':'☐  ',{fontSize:22}),preview[e.id]?h(RN.Image,{source:{uri:preview[e.id]},style:{width:42,height:42,marginRight:8}}):null,
          text(e.name+(e.animated?'  GIF':'  PNG'),{flexShrink:1})),
        h(RN.View,{style:{flexDirection:'row'}},button('预览',()=>showPreview(e),busy),button('下载单张',()=>start([e],true),busy))):
        h(RN.View,{style:{marginHorizontal:12}},button(e.name,()=>choose(e),busy))});
  }
  class Boundary extends R.Component {
    constructor(props){super(props);this.state={error:null};}
    static getDerivedStateFromError(error){return{error:safeError(error)};}
    render(){return this.state.error?h(RN.View,{style:{padding:20}},h(RN.Text,{style:{color:'#e78284'}},'Emoji Exporter 兼容性错误：'+this.state.error)):h(Settings);}
  }
  return {onLoad(){enabled=true;},onUnload(){enabled=false;current?.cancel();notify();listeners.clear();platform=null;},settings:Boundary};
}


return createPlugin(vendetta);
})()