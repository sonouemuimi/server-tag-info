const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const base = __dirname;
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('PASS ' + name); }
const React = {
    Fragment: 'Fragment',
    createElement(type, props, ...children) { return { _react: true, type, props: { ...props, ...(children.length ? { children: children.length === 1 ? children[0] : children } : {}) } }; },
    isValidElement(e) { return !!e && e._react === true; },
    cloneElement(e, props, ...children) { return { ...e, props: { ...e.props, ...props, ...(children.length ? { children: children.length === 1 ? children[0] : children } : {}) } }; },
    useState(value) { return [value, () => {}]; }, useEffect() {}
};
const G = '1234647491267808778', U = '80351110224678912';
const RAW = { id: U, username: 'person', primary_guild: { identity_guild_id: G, identity_enabled: true, tag: 'DISC', badge: 'abc123' } };
const sandbox = { console, setTimeout, clearTimeout, setInterval, clearInterval,
    fetch() { throw Error('Forbidden network'); }, XMLHttpRequest() { throw Error('Forbidden network'); } };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(base, 'core.js'), 'utf8'), sandbox);
const alerts = [], messages = [], patches = [];
const RN = { Alert: { alert(...args) { alerts.push(args); } }, Appearance: { getColorScheme: () => 'dark' },
    View: 'View', Text: 'Text', Image: 'Image', ScrollView: 'ScrollView', TextInput: 'TextInput', TouchableOpacity: 'TouchableOpacity' };
function around(parent, key, fn) {
    const orig = parent[key]; parent[key] = function (...args) { return fn.call(this, args, orig); };
    const undo = () => { parent[key] = orig; }; patches.push(undo); return undo;
}
let cache = { [G]: { id: G, name: 'Joined Server', icon: 'abcdef', features: ['COMMUNITY'] } };
const guildStore = { getName: () => 'GuildStore', getGuild(id) { return cache[id]; } };
const userStore = { getName: () => 'UserStore', getUser: id => id === U ? RAW : undefined };
const registry = [[{ default: guildStore }, 1], [{ default: userStore }, 2]];
let observer;
const A = { name: 'Test', React, RN, log: s => messages.push(s), around, copy: () => {}, discoverUI() {},
    scan: inspect => registry.forEach(([e, id]) => inspect(e, id)),
    subscribe: inspect => { observer = inspect; return () => { observer = null; }; } };
const p = sandbox.createServerTagInfo(A); p.start();
test('official primary_guild data and exact snowflake', () => {
    const ctx = p.context({ userId: U }); assert.equal(ctx.identity.id, G); assert.equal(ctx.identity.tag, 'DISC');
    assert.equal(ctx.identity.enabled, true); assert.equal(ctx.identity.path, 'UserStore.getUser.primary_guild');
});
test('runtime camelCase structure in an unknown container', () => {
    const item = p.identity({ futureContainer: { identityGuildId: G, identityEnabled: false, tag: 'TEST' } });
    assert.equal(item.id, G); assert.equal(item.enabled, false);
});
test('unsafe numeric snowflakes are rejected', () => {
    assert.equal(p.identity({ identity_guild_id: Number(G) }), null);
});
test('GuildStore has priority over embedded profile guild', () => {
    const ctx = p.context({ user: RAW, guild: { id: G, name: 'Older Name' } });
    const info = p.resolve(ctx); assert.equal(info.name, 'Joined Server'); assert.equal(info.source, 'GuildStore');
});
test('another server or a user name cannot be mistaken for target guild', () => {
    assert.equal(p.findGuild({ guild: { id: '999999999999999999', name: 'Wrong' } }, G), null);
    assert.equal(p.findGuild({ user: { id: G, username: 'Wrong', name: 'Not a guild' } }, G), null);
    assert.equal(p.findGuild({ guild: { name: 'Missing ID' } }, undefined), null);
});
test('previously observed guild survives cache eviction during this session', () => {
    guildStore.getGuild(G); cache = {};
    const info = p.resolve(p.context({ user: RAW })); assert.equal(info.name, 'Joined Server'); assert.match(info.source, /session cache/);
});
test('unavailable server name is a normal, explicit result', () => {
    const other = { primary_guild: { identity_guild_id: '888888888888888888', tag: 'PRIV' } };
    const ctx = p.context(other), info = p.resolve(ctx);
    assert.equal(info.name, null); assert.match(p.infoText(info), /服务器名称：客户端未提供/);
    assert.match(p.infoText(info), /服务器 ID：888888888888888888/);
});
test('already-exported guild object is readable without fetching', () => {
    observer({ cache: { guilds: { '888888888888888888': { id: '888888888888888888', name: 'Loaded Name' } } } }, 3);
    const ctx = p.context({ primary_guild: { identity_guild_id: '888888888888888888', tag: 'CACH' } });
    assert.equal(p.resolve(ctx).name, 'Loaded Name');
});
let originalCalls = 0;
const originalClick = function () { assert.equal(this.mark, 'receiver'); originalCalls++; };
const tagModule = { default: function GuildTag(props) {
    return React.createElement(RN.TouchableOpacity, { onPress: originalClick }, React.createElement(RN.Text, null, props.user.primary_guild.tag));
} };
const originalTag = tagModule.default;
registry.push([tagModule, 4]); observer(tagModule, 4);
test('tag click logs and opens local info; original click remains available', () => {
    const ret = tagModule.default({ user: RAW }); ret.props.onPress.call({ mark: 'receiver' });
    assert.equal(originalCalls, 0);
    const buttons = alerts.at(-1)[2]; buttons.find(x => x.text === '原服务器资料').onPress(); assert.equal(originalCalls, 1);
    for (const s of ['tag clicked', 'identity_guild_id = ' + G, 'guild cache result =', 'guild name =']) assert.ok(messages.some(x => x.includes('[ServerTagInfo] ' + s)));
});
test('matching component without real tag data remains unchanged', () => {
    const before = alerts.length;
    const ret = tagModule.default({ user: { primary_guild: { tag: 'NONE' } } });
    ret.props.onPress.call({ mark: 'receiver' }); assert.equal(alerts.length, before); assert.equal(originalCalls, 2);
});
test('late-loaded profile gets a local entry only for a user with identity', () => {
    const profile = { default: function UserProfileBio() { return React.createElement(RN.View); } };
    observer(profile, 5);
    const ret = profile.default({ userId: U }); assert.equal(ret.type, 'Fragment');
    assert.equal(ret.props.children[1].props.label, '查看服务器标签本地信息');
    assert.equal(profile.default({ userId: '777777777777777777' }).type, RN.View);
});
test('actual guild_tag utility and badge paths are not component hooks', () => {
    const cases = [
        [{ ensureUserPrimaryGuild: function ensureUserPrimaryGuild() { return RAW.primary_guild; } }, 'modules/guild_tag/PrimaryGuildUtils.tsx'],
        [{ getGuildTagBadgeUrl: function getGuildTagBadgeUrl() { return 'unchanged'; } }, 'modules/guild_tag/GuildTagUtils.tsx'],
        [{ GuildTagBadge: function GuildTagBadge() { return React.createElement(RN.View); } }, 'modules/guild_tag/native/GuildTag.tsx'],
        [{ GuildBadgeSword: function GuildBadgeSword() { return React.createElement(RN.View); } }, 'modules/guild_tag/native/badges/GuildBadgeSword.tsx']
    ];
    for (const [exports, modulePath] of cases) {
        const functions = { ...exports }; p.inspect(exports, modulePath, modulePath);
        for (const key of Object.keys(functions)) assert.equal(exports[key], functions[key]);
    }
});
test('device-native default and minified memo chiplet are hooked', () => {
    const native = { default: function n(props) { return React.createElement(RN.TouchableOpacity, { onPress() {} }); },
        BaseGuildTagChiplet: { type: function x(props) { return React.createElement(RN.TouchableOpacity, { onPress() {} }); } } };
    const before = [native.default, native.BaseGuildTagChiplet.type];
    p.inspect(native, 99, 'modules/guild_tag/native/GuildTag.tsx');
    assert.notEqual(native.default, before[0]); assert.notEqual(native.BaseGuildTagChiplet.type, before[1]);
    const count = alerts.length;
    native.default({ user: RAW }).props.onPress();
    native.BaseGuildTagChiplet.type({ user: RAW }).props.onPress();
    assert.equal(alerts.length, count + 2);
});
test('cross-realm Map and underscored guild containers are readable', () => {
    const id = '555555555555555555';
    observer({ _guilds: new Map([[id, { id, name: 'Map Cached Guild' }]]) }, 100);
    assert.equal(p.resolve(p.context({ identityGuildId: id })).name, 'Map Cached Guild');
});
test('direct cache requires matching embedded guild id', () => {
    const id = '444444444444444444';
    observer({ cache: { [id]: { id, name: 'Direct Cached Guild' } } }, 101);
    assert.equal(p.resolve(p.context({ identityGuildId: id })).name, 'Direct Cached Guild');
    assert.equal(p.findGuild({ cache: { [id]: { id: U, name: 'Wrong ID' } } }, id), null);
});
test('missing-name diagnostics report cache surfaces without calling unverified getters', () => {
    let calls = 0;
    const store = { getName: () => 'GuildProfileStore', getProfile() { calls++; throw Error('must not call'); } };
    observer({ default: store }, 102);
    const info = p.resolve(p.context({ identityGuildId: '333333333333333333' }));
    assert.equal(info.name, null); assert.equal(calls, 0);
    assert.ok(messages.some(s => s.includes('cache surface =') && s.includes('getProfile')));
    assert.ok(messages.some(s => s.includes('cache stages =')));
    assert.ok(messages.some(s => s.includes('guild resolution =') && s.includes('hasName')));
});
test('unload removes hooks, clears snapshots; restart reinstalls', () => {
    p.stop(); assert.equal(tagModule.default, originalTag); assert.equal(observer, null);
    p.start(); assert.notEqual(tagModule.default, originalTag);
    const info = p.resolve(p.context({ user: RAW })); assert.equal(info.name, null);
    p.stop(); assert.equal(tagModule.default, originalTag);
});
test('legacy loader expression loads without imports or forced requires', () => {
    const seen = [], modules = { 1: { isInitialized: true, publicModule: { exports: { default: userStore } } },
        2: { isInitialized: false, publicModule: { get exports() { throw Error('Uninitialized module read'); } } } };
    sandbox.vendetta = { metro: { modules, common: { React, ReactNative: RN, clipboard: { setString() {} } } },
        patcher: { instead: (key, parent, hook) => around(parent, key, hook) }, logger: { info: s => seen.push(s) } };
    const loaded = vm.runInContext(fs.readFileSync(path.join(base, 'index.js'), 'utf8'), sandbox);
    assert.equal(typeof loaded.onLoad, 'function'); assert.equal(typeof loaded.settings, 'function');
    loaded.onLoad(); assert.ok(seen.some(s => s.includes('UserStore'))); loaded.onUnload();
});
test('Next loader expression returns lifecycle object', () => {
    sandbox.plugin = opts => opts;
    const loaded = vm.runInContext(fs.readFileSync(path.join(base, 'next-index.js'), 'utf8'), sandbox);
    assert.equal(typeof loaded.default.start, 'function'); assert.equal(typeof loaded.default.SettingsComponent, 'function');
    const filters = { FilterScopes: { Initialized: 4 }, createFilterGenerator: () => () => ({}) };
    const Uapi = { react: { React, ReactNative: RN }, patcher: { instead: around }, modules: {
        finders: { filters, lookupModules: () => registry.map(([e, id]) => [e, id]) },
        metro: { onAnyModuleInitialized: () => () => {} } } };
    loaded.default.start({ unscoped: Uapi }); loaded.default.stop();
});
console.log(passed + ' tests passed (mock integration; no Android device test).');
