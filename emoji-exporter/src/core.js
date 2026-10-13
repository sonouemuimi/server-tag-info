// Pure functions: no Discord account state, networking, or native dependencies.
export const MAX_IMAGE = 2 * 1024 * 1024;
export const MAX_PART = 8 * 1024 * 1024;
export function safeName(s) {
  return String(s || 'unnamed').replace(/[\x00-\x1f\x7f/\\:*?"<>|]/g, '_').replace(/^\.+|[. ]+$/g, '').slice(0, 70) || 'unnamed';
}
export function emojiURL(e) {
  if (!/^\d{5,22}$/.test(e.id) || typeof e.animated !== 'boolean') throw Error('Invalid emoji metadata');
  return `https://cdn.discordapp.com/emojis/${e.id}.${e.animated ? 'gif' : 'png'}`;
}
export function normalize(raw, guildId) {
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
export function utf8(text) {
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
export function base64(bytes) {
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
export function crc32(bytes) {let c=0xffffffff;for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8);return(c^0xffffffff)>>>0;}
// ZIP STORE: no recompression, GIF bytes and animation stay untouched. UTF-8 filenames.
export function zip(entries) {
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
export function validateImage(data, animated) {
  const b = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (!b.length || b.length > MAX_IMAGE) throw Error('图片为空或超过 2 MiB 安全上限');
  const gif = b[0]===71 && b[1]===73 && b[2]===70 && b[3]===56 && (b[4]===55 || b[4]===57) && b[5]===97;
  const png = [137,80,78,71,13,10,26,10].every((v,i)=>b[i]===v);
  if (animated ? !gif : !png) throw Error('CDN 图片格式与 animated 属性不符，未猜测或转换格式');
  return b;
}
