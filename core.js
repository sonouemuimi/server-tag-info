/* ServerTagInfo 1.0.0 — no REST calls, no force-requiring Discord modules. */
function createServerTagInfo(A) {
    const React = A.React, RN = A.RN;
    const cleanup = [], stores = new Map(), roots = new Map(), snapshots = new Map();
    let patched = new WeakMap();
    const schemas = new Set(), logs = [];
    let active = false, tagHooks = 0, profileHooks = 0, sheetHooks = 0;
    const obj = v => v !== null && (typeof v === 'object' || typeof v === 'function');
    const norm = k => String(k).replace(/[_-]/g, '').toLowerCase();
    const idOf = v => typeof v === 'string' && /^\d{6,22}$/.test(v) ? v : undefined;
    const read = (v, k) => { try { return obj(v) ? v[k] : undefined; } catch (_) {} };
    const keys = v => { try { return obj(v) ? Object.keys(v).slice(0, 100) : []; } catch (_) { return []; } };
    function log(s) {
        const line = '[ServerTagInfo] ' + s;
        logs.push(line); if (logs.length > 250) logs.shift();
        try { A.log(line); } catch (_) {}
    }
    function field(v, n) {
        for (const k of keys(v)) if (norm(k) === n) return { key: k, value: read(v, k) };
        // User models may expose these known fields as prototype getters.
        const aliases = { primaryguild: ['primaryGuild', 'primary_guild'], identityguildid: ['identity_guild_id', 'identityGuildId'], identityenabled: ['identity_enabled', 'identityEnabled'] };
        for (const k of aliases[n] || []) {
            const value = read(v, k); if (value !== undefined) return { key: k, value };
        }
        return {};
    }
    function identity(root, origin) {
        // Shape-driven: names of containers are not required. No IDs converted to Number.
        const seen = new Set(), queue = [[root, origin || 'data', 0]];
        let count = 0;
        while (queue.length && count++ < 160) {
            const [v, path, depth] = queue.shift();
            if (!obj(v) || seen.has(v)) continue;
            seen.add(v);
            const f = field(v, 'identityguildid'), id = idOf(f.value);
            if (id) {
                const tag = field(v, 'tag').value, badge = field(v, 'badge').value;
                const enabled = field(v, 'identityenabled').value;
                const schema = path + ':' + keys(v).sort().join(',');
                if (!schemas.has(schema)) { schemas.add(schema); log('identity schema = ' + schema); }
                return { id, tag: typeof tag === 'string' ? tag : null,
                    badge: typeof badge === 'string' ? badge : null,
                    enabled: typeof enabled === 'boolean' ? enabled : null,
                    path, raw: v };
            }
            if (depth >= 4) continue;
            const pg = field(v, 'primaryguild');
            if (obj(pg.value)) queue.push([pg.value, path + '.' + pg.key, depth + 1]);
            for (const k of keys(v)) {
                // Do not traverse React fibers, stores, DOM/native refs, or message text.
                if (/^(children|ref|_owner|stateNode|return|alternate|memoizedProps|content|email|token|password)$/i.test(k)) continue;
                const child = read(v, k);
                if (obj(child) && typeof child !== 'function') queue.push([child, path + '.' + k, depth + 1]);
            }
        }
        return null;
    }
    function userId(props) {
        return idOf(read(props, 'userId')) || idOf(read(props, 'user_id')) ||
            idOf(read(read(props, 'user'), 'id')) || idOf(read(read(props, 'author'), 'id')) ||
            idOf(read(read(props, 'displayProfile'), 'userId'));
    }
    function call(store, method, id) {
        const fn = read(store, method);
        if (typeof fn !== 'function') return undefined;
        try { return fn.call(store, id); } catch (e) { log(method + ' read failed = ' + String(e)); }
    }
    function context(props) {
        const uid = userId(props), candidates = [[props, 'props']];
        if (uid) {
            candidates.push([call(stores.get('UserStore'), 'getUser', uid), 'UserStore.getUser']);
            candidates.push([call(stores.get('UserProfileStore'), 'getUserProfile', uid), 'UserProfileStore.getUserProfile']);
        }
        for (const [v, source] of candidates) {
            const item = identity(v, source);
            if (item) return { identity: item, candidates, userId: uid };
        }
        return null;
    }
    function guild(v, id) {
        if (!idOf(id)) return null;
        if (!obj(v) || typeof v === 'function') return null;
        const gid = idOf(read(v, 'id')) || idOf(field(v, 'guildid').value);
        if (gid !== id) return null;
        // A user, channel or tag payload with a matching id is not a guild.
        if (read(v, 'username') !== undefined || read(v, 'type') !== undefined) return null;
        const name = read(v, 'name'), icon = read(v, 'icon');
        const isGuild = typeof name === 'string' || typeof icon === 'string' || Array.isArray(read(v, 'features'));
        if (!isGuild) return null;
        return { id, name: typeof name === 'string' && name.length ? name : null,
            icon: typeof icon === 'string' ? icon : null,
            description: typeof read(v, 'description') === 'string' ? read(v, 'description') : null,
            features: Array.isArray(read(v, 'features')) ? read(v, 'features').filter(x => typeof x === 'string').slice(0, 40) : [],
            memberCount: Number.isFinite(field(v, 'membercount').value) ? field(v, 'membercount').value : null,
            raw: v };
    }
    function findGuild(root, id, allowRoot) {
        if (allowRoot) { const direct = guild(root, id); if (direct) return direct; }
        const seen = new Set(), queue = [[root, 0, false]];
        let count = 0;
        while (queue.length && count++ < 250) {
            const [v, depth, trusted] = queue.shift();
            if (!obj(v) || seen.has(v)) continue;
            seen.add(v);
            if (trusted) { const g = guild(v, id); if (g) return g; }
            if (depth >= 5) continue;
            // Only actual guild containers; never infer a guild from a profile's username/name.
            for (const k of keys(v)) {
                const n = norm(k), c = read(v, k);
                if (/^(guild|guilds|guildprofile|guildprofiles|guildpreview|guildpreviews|primaryguild|clan)$/.test(n)) {
                    queue.push([c, depth + 1, true]);
                    const entry = c instanceof Map ? c.get(id) : read(c, id);
                    if (obj(entry)) queue.push([entry, depth + 1, true]);
                } else if (/^(user|author|profile|userprofile|data|body|props|default|cache|state)$/.test(n)) {
                    queue.push([c, depth + 1, false]);
                }
            }
        }
        return null;
    }
    function remember(g, source) {
        if (!g) return;
        // Session memory only. Nothing is written to disk or sent anywhere.
        const old = snapshots.get(g.id);
        snapshots.delete(g.id);
        snapshots.set(g.id, { ...g, name: g.name || (old && old.name) || null,
            source, observed: Date.now() });
        while (snapshots.size > 250) snapshots.delete(snapshots.keys().next().value);
    }
    function resolve(ctx) {
        const id = ctx.identity.id;
        let selected = null, icon = null;
        function consider(g, source) {
            if (!g) return;
            if (!selected || (!selected.name && g.name)) selected = { ...g, source };
            if (!icon && g.icon) icon = g.icon;
        }
        const current = guild(call(stores.get('GuildStore'), 'getGuild', id), id);
        log('guild cache result = ' + JSON.stringify(current ? { id, name: current.name, icon: current.icon, source: 'GuildStore' } : { id, source: 'GuildStore', hit: false }));
        consider(current, 'GuildStore'); remember(current, 'GuildStore');
        // Only already-exported data objects. No fetch methods or private profile endpoints.
        for (const [key, root] of roots) consider(findGuild(root, id, false), 'loaded module ' + key);
        // Discord secondary stores: only inspect data containers that already exist.
        for (const [name, store] of stores) {
            if (/Guild.*(?:Store|Cache)/i.test(name) && name !== 'GuildStore')
                consider(findGuild(store, id, false), name);
        }
        const old = snapshots.get(id);
        if (old) consider(old, 'session cache (' + old.source + ')');
        for (const [root, source] of ctx.candidates || []) consider(findGuild(root, id, false), source);
        consider(guild(ctx.identity.raw, id), ctx.identity.path);
        if (!selected) selected = { id, name: null, icon: null, source: '客户端未提供' };
        selected.icon = selected.icon || icon;
        log('guild name = ' + (selected.name || '客户端未提供'));
        return { ...selected, identity: ctx.identity };
    }
    const textStyle = dark => ({ color: dark ? '#f2f3f5' : '#202127', fontSize: 15, lineHeight: 23 });
    function darkTheme() { try { return !RN.Appearance || RN.Appearance.getColorScheme() !== 'light'; } catch (_) { return true; } }
    function infoText(info) {
        const i = info.identity;
        return ['服务器名称：' + (info.name || '客户端未提供'), '服务器标签：' + (i.tag || '客户端未提供'),
            '服务器 ID：' + info.id, '图标哈希：' + (info.icon || '客户端未提供'),
            '标签徽章哈希：' + (i.badge || '客户端未提供'),
            '标签启用：' + (i.enabled === null ? '客户端未提供' : (i.enabled ? '是' : '否')),
            '数据来源：' + info.source,
            ...(info.description ? ['简介：' + info.description] : []),
            ...(info.memberCount !== null && info.memberCount !== undefined ? ['成员数（缓存）：' + info.memberCount] : []),
            ...(info.features && info.features.length ? ['功能：' + info.features.join(', ')] : [])].join('\n');
    }
    function copy(text) {
        if (A.copy) A.copy(text);
        else RN.Alert.alert('复制不可用', '当前客户端没有提供剪贴板模块。');
    }
    function Button({ label, onPress }) {
        const dark = darkTheme();
        return React.createElement(RN.TouchableOpacity, { onPress, accessibilityRole: 'button',
            style: { padding: 13, marginVertical: 5, borderRadius: 10, backgroundColor: dark ? '#383a43' : '#e3e5e8' } },
            React.createElement(RN.Text, { style: { ...textStyle(dark), fontWeight: '600', textAlign: 'center' } }, label));
    }
    function CachedIcon({ info }) {
        // Android Image cache flags cannot guarantee no download. Use local image URIs only.
        const local = value => typeof value === 'string' && /^(?:data:image\/|file:\/\/|content:\/\/)/.test(value);
        let uri = local(info.icon) ? info.icon : null;
        for (const key of keys(info.raw)) {
            if (!/^icon(?:uri|url|source)$/i.test(norm(key))) continue;
            const value = read(info.raw, key), candidate = obj(value) ? read(value, 'uri') : value;
            if (local(candidate)) { uri = candidate; break; }
        }
        return uri ? React.createElement(RN.Image, { source: { uri },
            style: { width: 64, height: 64, borderRadius: 16, marginBottom: 12 } }) : null;
    }
    function InfoSheet({ info, original, close }) {
        const dark = darkTheme(), body = infoText(info);
        const inner = React.createElement(RN.View, { style: { padding: 18, backgroundColor: dark ? '#202127' : '#fff', borderRadius: 14 } },
            React.createElement(RN.Text, { style: { ...textStyle(dark), fontSize: 20, fontWeight: '700', marginBottom: 12 } }, '服务器标签 · 本地信息'),
            React.createElement(RN.ScrollView, { style: { maxHeight: 430 } },
                React.createElement(CachedIcon, { info }),
                React.createElement(RN.Text, { selectable: true, style: textStyle(dark) }, body)),
            React.createElement(Button, { label: '复制信息', onPress: () => copy(body) }),
            original ? React.createElement(Button, { label: '打开 Discord 原服务器资料', onPress: () => { close(); setTimeout(() => { if (active) original(); }, 200); } }) : null,
            React.createElement(Button, { label: '关闭', onPress: close }));
        return A.actionSheet ? React.createElement(A.actionSheet, null, inner) : inner;
    }
    function show(ctx, original, clicked) {
        if (!active || !ctx) return false;
        if (clicked) log('tag clicked');
        else log('local information opened');
        log('identity_guild_id = ' + ctx.identity.id);
        const info = resolve(ctx);
        if (A.openSheet && A.actionSheet) {
            try { A.openSheet(InfoSheet, { info, original, close: A.closeSheet }); return true; }
            catch (e) { log('sheet fallback = ' + String(e)); }
        }
        RN.Alert.alert('服务器标签 · 本地信息', infoText(info), [
            { text: '关闭', style: 'cancel' }, { text: '复制', onPress: () => copy(infoText(info)) },
            ...(original ? [{ text: '原服务器资料', onPress: original }] : [])]);
        return true;
    }
    function clonePressTree(tree, ctx) {
        let changed = false;
        function visit(node, depth) {
            if (Array.isArray(node)) return node.map(n => visit(n, depth));
            if (!React.isValidElement(node) || depth > 12) return node;
            const p = node.props || {}, updates = {};
            if (typeof p.onPress === 'function' && !changed) {
                changed = true;
                const original = p.onPress;
                updates.onPress = function (...args) {
                    if (!active) return original.apply(this, args);
                    const self = this;
                    return show(ctx, () => original.apply(self, args), true);
                };
            }
            if (p.children) updates.children = visit(p.children, depth + 1);
            return keys(updates).length ? React.cloneElement(node, updates) : node;
        }
        const result = visit(tree, 0);
        return result;
    }
    function appendSheetButton(tree, ctx) {
        let attached = false;
        function visit(node, depth) {
            if (Array.isArray(node)) return node.map(v => visit(v, depth));
            if (!React.isValidElement(node) || depth > 12) return node;
            if (!attached && A.actionSheet && node.type === A.actionSheet) {
                attached = true;
                return React.cloneElement(node, {}, node.props.children,
                    React.createElement(Button, { label: '查看本地信息', onPress: () => show(ctx) }));
            }
            return node.props.children ? React.cloneElement(node, {}, visit(node.props.children, depth + 1)) : node;
        }
        return visit(tree, 0);
    }
    function patch(parent, key, callback, label) {
        if (!obj(parent) || typeof read(parent, key) !== 'function') return false;
        let set = patched.get(parent); if (!set) patched.set(parent, set = new Set());
        if (set.has(key)) return false;
        try {
            const unpatch = A.around(parent, key, function (args, original) {
                const result = original.apply(this, args);
                if (!active) return result;
                try { return callback(args, result); }
                catch (e) { log('hook failed (' + label + ') = ' + String(e)); return result; }
            });
            set.add(key); cleanup.push(unpatch); log('hook installed = ' + label); return true;
        } catch (e) { log('hook unavailable (' + label + ') = ' + String(e)); return false; }
    }
    function component(parent, key, name, path) {
        const tag = /(?:Guild|Server|Clan)(?:Identity)?Tag(?:Badge|Pill|Chip|Button)?$/i.test(name) ||
            /(?:guild|server|clan)[_-]?tag(?:\/|\.|$)/i.test(path || '');
        // Verified mobile plugin anchors; only add an entry when actual identity data exists.
        const profile = /^(?:UserProfileBio|UserProfileAboutMeCard|SimplifiedUserProfileAboutMeCard|YouAboutMeCard)$/.test(name);
        const sheet = /^(?:Guild|Server|Clan)(?:Profile|Identity)(?:Action)?Sheet$/.test(name);
        if (!tag && !profile && !sheet) return;
        if (patch(parent, key, (args, ret) => {
            const props = args[0] || {}, ctx = context(props);
            if (tag) return ctx ? clonePressTree(ret, ctx) : ret;
            if (profile) return ctx ? React.createElement(React.Fragment, null, ret,
                React.createElement(Button, { label: '查看服务器标签本地信息', onPress: () => show(ctx) })) : ret;
            // No use of the latest clicked user's data: require the sheet's own guild id.
            const sid = idOf(read(props, 'guildId')) || idOf(read(read(props, 'guild'), 'id'));
            const localCtx = ctx || (sid ? { identity: { id: sid, tag: read(props, 'tag') || null, badge: null, enabled: null, path: name, raw: {} }, candidates: [[props, name]] } : null);
            return localCtx ? appendSheetButton(ret, localCtx) : ret;
        }, name + (path ? ' [' + path + ']' : ''))) {
            if (tag) tagHooks++; else if (profile) profileHooks++; else sheetHooks++;
        }
    }
    function registerStore(v) {
        const getName = read(v, 'getName');
        if (typeof getName !== 'function' || getName.length !== 0) return;
        let name; try { name = getName.call(v); } catch (_) { return; }
        if (typeof name !== 'string' || !/(?:User|Guild|Profile).*Store/.test(name)) return;
        if (!stores.has(name)) log('store found = ' + name);
        stores.set(name, v);
        if (/Guild.*(?:Store|Cache)/.test(name)) {
            for (const method of ['getGuild', 'getGuildProfile', 'getGuildPreview']) {
                if (typeof read(v, method) !== 'function') continue;
                // Observe only calls Discord already makes. Never invoke secondary getters ourselves.
                patch(v, method, (args, ret) => {
                    const id = idOf(args[0]);
                    remember(guild(ret, id) || findGuild(ret, id, true), name + '.' + method);
                    return ret;
                }, name + '.' + method + ' (observe only)');
            }
        }
    }
    function inspect(exports, moduleId, path) {
        if (!active || !obj(exports)) return;
        registerStore(exports); registerStore(read(exports, 'default'));
        // Retain bounded references to existing data exports only, not arbitrary module graphs.
        if ([exports, read(exports, 'default')].some(v => keys(v).some(k => /^(guilds?|guildprofiles?|guildpreviews?|cache)$/i.test(k)))) {
            roots.set(moduleId, exports);
            while (roots.size > 300) roots.delete(roots.keys().next().value);
        }
        for (const key of keys(exports)) {
            const value = read(exports, key);
            if (typeof value === 'function') component(exports, key, value.displayName || value.name || key, path);
            else if (obj(value)) {
                for (const sub of ['type', 'render']) {
                    const fn = read(value, sub);
                    if (typeof fn === 'function') component(value, sub, value.displayName || fn.displayName || fn.name || key, path);
                }
            }
        }
        A.discoverUI(exports);
    }
    function diagnostic() {
        const status = 'tag hooks=' + tagHooks + ', profile hooks=' + profileHooks + ', sheet hooks=' + sheetHooks + ', stores=' + [...stores.keys()].join(', ');
        log('coverage = ' + status);
        return status;
    }
    function Settings() {
        const [uid, setUid] = React.useState(''), [status, setStatus] = React.useState('');
        const dark = darkTheme();
        return React.createElement(RN.ScrollView, { contentContainerStyle: { padding: 16 } },
            React.createElement(RN.Text, { style: textStyle(dark) }, 'ServerTagInfo 1.0.0\n只读本地数据。名称缺失时显示“客户端未提供”。\n点击标签可查看；如果点击没有匹配，可从资料页入口或下方用户 ID 查看。'),
            React.createElement(RN.TextInput, { value: uid, onChangeText: setUid, placeholder: '输入目标用户 ID（不是服务器 ID）',
                placeholderTextColor: dark ? '#999' : '#666', keyboardType: 'number-pad', style: { ...textStyle(dark), borderWidth: 1, borderColor: '#777', padding: 12, marginVertical: 12, borderRadius: 8 } }),
            React.createElement(Button, { label: '读取已缓存用户的服务器标签', onPress: () => {
                const ctx = context({ userId: uid.trim() });
                if (ctx) show(ctx); else RN.Alert.alert('本地暂无标签数据', '请先打开该用户资料，再重试。插件不会额外请求用户或服务器资料。');
            } }),
            React.createElement(Button, { label: '刷新模块匹配', onPress: () => { A.scan(inspect); setStatus(diagnostic()); } }),
            React.createElement(RN.Text, { selectable: true, style: textStyle(dark) }, status),
            React.createElement(Button, { label: '复制调试日志', onPress: () => { diagnostic(); copy(logs.join('\n')); } }),
            React.createElement(Button, { label: '清空会话缓存和日志', onPress: () => { snapshots.clear(); logs.length = 0; schemas.clear(); setStatus('已清空'); } }));
    }
    function start() {
        if (active) return;
        active = true;
        log('loaded = 1.0.0; adapter=' + A.name + '; network=none');
        A.scan(inspect);
        const unsub = A.subscribe(inspect); if (unsub) cleanup.push(unsub);
        // Flux observe only: preserve dispatch and do not request anything.
        if (A.dispatcher && typeof read(A.dispatcher, 'dispatch') === 'function') {
            patch(A.dispatcher, 'dispatch', (args, ret) => {
                const event = args[0];
                if (read(event, 'type') === 'LOGOUT') { snapshots.clear(); roots.clear(); schemas.clear(); logs.length = 0; }
                if (read(event, 'type') === 'GUILD_CREATE') {
                    const v = read(event, 'guild'), id = idOf(read(v, 'id')); remember(guild(v, id), 'GUILD_CREATE');
                }
                return ret;
            }, 'FluxDispatcher.dispatch (observe only)');
        }
        diagnostic();
    }
    function stop() {
        active = false;
        while (cleanup.length) { try { cleanup.pop()(); } catch (_) {} }
        patched = new WeakMap(); stores.clear(); roots.clear(); snapshots.clear(); schemas.clear(); logs.length = 0;
        tagHooks = profileHooks = sheetHooks = 0;
    }
    return { start, stop, Settings, inspect, context, resolve, identity, findGuild, show, infoText, diagnostic };
}
