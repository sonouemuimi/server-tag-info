export function createPlatform(v) {
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
