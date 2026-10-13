import {normalize,base64} from './core.js';
import {createPlatform} from './platform.js';
import {Downloader,exportJob} from './download.js';
export function createPlugin(v) {
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
