import {MAX_IMAGE,MAX_PART,emojiURL,validateImage,base64,safeName,zip,utf8} from './core.js';
// One XHR at a time (including user-triggered previews). Never Discord's REST client.
export class Downloader {
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
export async function exportJob({guild,emojis,platform,downloader,update,single=false}) {
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
