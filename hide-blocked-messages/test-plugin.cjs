const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(process.env.PLUGIN_SOURCE || __dirname + '/index.js', 'utf8');
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('PASS ' + name); }
const msg = (id, author = 'good', extra = {}) => ({id, channel_id: 'channel', author: {id: author}, type: 0, content: 'body', ...extra});
function setup(options = {}, controls = {}) {
    const sent = [], logs = [], records = new Map(), members = new Map();
    const blocked = new Set(['bad']), ignored = new Set(['ignored']);
    const storage = {blocked: true, ignored: true, removeReplies: false, hideReplyPreview: true, ...options};
    class Messages {
        constructor(items) { this.items = items; }
        toArray() { return this.items; }
        lookup(id) { return this.items.find(m => m.id === id); }
    }
    let collection = new Messages([]);
    const store = {getMessages() { return collection; }, getMessage(channel, id) { return records.get(id); }};
    const relationships = {getRelationships() {}, isBlocked(id) { return blocked.has(id); }, isIgnored(id) { return ignored.has(id); }};
    if (controls.noIgnored) delete relationships.isIgnored;
    const dispatcher = {dispatch(e) {
        sent.push(e);
        if (e.type === 'LOAD_MESSAGES_SUCCESS') {
            collection = new Messages(e.messages.slice());
            e.messages.forEach(m => records.set(m.id, m));
        }
        if (e.type === 'MESSAGE_CREATE') {
            records.set(e.message.id, e.message);
            collection = new Messages([...collection.items, e.message]);
        }
        if (e.type === 'MESSAGE_UPDATE') {
            const merged = {...records.get(e.message.id), ...e.message};
            records.set(merged.id, merged);
            collection = new Messages(collection.items.map(m => m.id === merged.id ? merged : m));
        }
        // Separate store receives the SAME event as MessageStore, just as in Flux.
        const messages = e.messages || (e.message ? [e.message] : []);
        for (const message of messages) {
            if (message.member && message.author) members.set(message.author.id, message.member);
        }
        if (e.type === 'GUILD_MEMBER_UPDATE') members.set(e.user.id, e.member);
        return 'dispatched';
    }};
    const originalDispatch = dispatcher.dispatch, originalGetMessages = store.getMessages;
    function patch(kind, key, obj, cb) {
        const original = obj[key];
        obj[key] = function (...args) {
            if (kind === 'instead') return cb.call(this, args, original.bind(this));
            const ret = original.apply(this, args), next = cb.call(this, args, ret);
            return next == null ? ret : next;
        };
        return () => { obj[key] = original; };
    }
    const v = {
        plugin: {storage}, logger: {log: x => logs.push(x), warn: x => logs.push(x), error: x => logs.push(x)},
        metro: {common: {FluxDispatcher: dispatcher}, findByProps(...props) {
            return [controls.noRelationships ? {} : relationships, controls.noStore ? {} : store].find(x => props.every(p => p in x));
        }},
        patcher: {instead: (...a) => patch('instead', ...a), after: (...a) => patch('after', ...a)}
    };
    const plugin = vm.runInNewContext('(vendetta=>{return ' + source + '\n})', {})(v);
    assert.equal(typeof plugin.onLoad, 'function');
    plugin.onLoad();
    return {plugin, storage, sent, logs, blocked, ignored, store, members, records, dispatcher,
        originalDispatch, originalGetMessages, Messages,
        view() {return store.getMessages('channel').toArray();},
        cache(items) {collection = new Messages(items);items.forEach(m=>records.set(m.id,m));return collection;},
        setCollection(value) {collection=value;}
    };
}
const ids = items => Array.from(items, m => m.id);

test('member profile metadata survives a hidden reply and updates normally', () => {
    const x=setup({removeReplies:true});
    const member=Object.freeze({nick:'server nickname',roles:['yellow'],avatar:'guild-avatar'});
    const reply=Object.freeze(msg('r','normal-user',{referenced_message:msg('b','bad'),member}));
    const e=Object.freeze({type:'MESSAGE_CREATE',message:reply});
    assert.equal(x.dispatcher.dispatch(e),'dispatched');
    assert.equal(x.sent[0],e);
    assert.equal(x.members.get('normal-user'),member);
    assert.deepEqual(ids(x.view()),[]);
    x.dispatcher.dispatch({type:'MESSAGE_CREATE',message:msg('n','normal-user')});
    assert.deepEqual(ids(x.view()),['n']);
    assert.equal(x.members.get(x.view()[0].author.id).nick,'server nickname');
    const updated={nick:'new nickname',roles:['cyan']};
    x.dispatcher.dispatch({type:'GUILD_MEMBER_UPDATE',user:{id:'normal-user'},member:updated});
    assert.equal(x.members.get('normal-user'),updated);
});
test('global dispatcher remains untouched; blocked events reach all data stores', () => {
    const x=setup();assert.equal(x.dispatcher.dispatch,x.originalDispatch);
    const e=Object.freeze({type:'MESSAGE_CREATE',message:Object.freeze(msg('b','bad'))});
    assert.equal(x.dispatcher.dispatch(e),'dispatched');assert.equal(x.sent[0],e);
    assert.equal(x.records.get('b'),e.message);assert.deepEqual(ids(x.view()),[]);
    assert.equal(e.message.content,'body');
});
test('history retains full original events and pagination but filters displayed rows', () => {
    const x=setup();const list=Object.freeze([Object.freeze(msg('b','bad')),Object.freeze(msg('g'))]);
    const e=Object.freeze({type:'LOAD_MESSAGES_SUCCESS',messages:list,hasMoreBefore:true,channelId:'channel'});
    x.dispatcher.dispatch(e);assert.equal(x.sent[0],e);assert.equal(x.sent[0].messages,list);
    assert.equal(x.sent[0].hasMoreBefore,true);assert.deepEqual(ids(x.view()),['g']);
    assert.equal(x.records.size,2);
});
test('original collection identity, methods and raw lookup are preserved', () => {
    const x=setup();const c=x.cache([msg('b','bad'),msg('g')]);const lookup=c.lookup;
    assert.equal(x.store.getMessages('channel'),c);assert.equal(c.lookup,lookup);
    assert.equal(c.lookup('b').author.id,'bad');assert.equal(c.items.length,2);
    assert.deepEqual(ids(c.toArray()),['g']);
    const sibling=new x.Messages([msg('b','bad')]);assert.equal(sibling.toArray().length,1);
});
test('filtered array identity is stable across unchanged reads and new native arrays', () => {
    const x=setup();const c=x.cache([msg('b','bad'),msg('g')]);
    const first=x.view();assert.equal(x.view(),first);
    c.items=c.items.slice();assert.equal(x.view(),first);
    c.items=[msg('new')];assert.deepEqual(ids(x.view()),['new']);
});
test('unfiltered arrays and normal records keep native identity', () => {
    const x=setup();const a=[msg('g')];x.cache(a);assert.equal(x.view(),a);assert.equal(x.view()[0],a[0]);
});
test('camelCase blocked reply preview is stripped without changing member info or stored record', () => {
    const x=setup();const member={nick:'colorful',roles:['green']};
    const reply=Object.freeze(msg('r','good',{type:19,member,referencedMessage:msg('b','bad'),messageReference:{messageId:'b'}}));
    x.dispatcher.dispatch({type:'MESSAGE_CREATE',message:reply});const actual=x.view()[0];
    assert.equal(actual.content,'body');assert.equal(actual.type,0);assert.equal(actual.member,member);
    assert.equal(actual.referencedMessage,null);assert.equal(actual.messageReference,null);
    assert.equal(reply.type,19);assert.equal(x.records.get('r'),reply);
    assert.equal(x.view()[0],actual);assert.equal(x.view(),x.view());
});
test('snake_case reference-only replies resolve regardless of order in a page', () => {
    const x=setup({removeReplies:true});x.cache([msg('r','good',{message_reference:{message_id:'b'}}),msg('b','bad'),msg('g')]);
    assert.deepEqual(ids(x.view()),['g']);
});
test('reference target outside the current list is resolved from raw MessageStore', () => {
    const x=setup({removeReplies:true});x.records.set('b',msg('b','bad'));
    x.cache([msg('r','good',{messageReference:{messageId:'b'}})]);assert.equal(x.view().length,0);
});
test('unknown/deleted references, ordinary mentions and normal replies remain unchanged', () => {
    const x=setup({removeReplies:true});const unknown=msg('u','good',{referenced_message:null,message_reference:{message_id:'missing'},mentions:[{id:'bad'}]});
    const reply=msg('r','good',{referenced_message:msg('g')});x.cache([unknown,reply]);
    assert.equal(x.view()[0],unknown);assert.equal(x.view()[1],reply);
});
test('partial live update reaches stores and remains hidden from display', () => {
    const x=setup();x.dispatcher.dispatch({type:'MESSAGE_CREATE',message:msg('b','bad')});
    const e={type:'MESSAGE_UPDATE',message:{id:'b',content:'edited'}};x.dispatcher.dispatch(e);
    assert.equal(x.sent[1],e);assert.equal(x.records.get('b').content,'edited');assert.equal(x.view().length,0);
});
test('block/unblock and option changes work without refetching raw cached records', () => {
    const x=setup();x.cache([msg('g'),msg('b','bad')]);assert.deepEqual(ids(x.view()),['g']);
    x.blocked.add('good');assert.equal(x.view().length,0);
    x.blocked.clear();assert.deepEqual(ids(x.view()),['g','b']);
    x.blocked.add('bad');x.storage.blocked=false;assert.deepEqual(ids(x.view()),['g','b']);
});
test('unload restores hooks and records, reload reinstates filtering', () => {
    const x=setup();const c=x.cache([msg('b','bad')]), nativeToArray=c.toArray;
    assert.equal(x.view().length,0);x.plugin.onUnload();
    assert.equal(x.store.getMessages,x.originalGetMessages);assert.equal(c.toArray,nativeToArray);
    assert.equal(c.toArray().length,1);x.plugin.onLoad();assert.equal(x.view().length,0);
});
test('record class and methods survive reply stripping', () => {
    const x=setup();class Record {constructor(){Object.assign(this,msg('r','good',{type:19,referenced_message:msg('b','bad')}));}label(){return this.content;}}
    const original=Object.freeze(new Record());x.cache([original]);assert.ok(x.view()[0] instanceof Record);assert.equal(x.view()[0].label(),'body');
});
test('in-place body changes invalidate stripped message memoization', () => {
    const x=setup();const original=msg('r','good',{type:19,referenced_message:msg('b','bad')});x.cache([original]);
    const first=x.view()[0];original.content='edited in place';const second=x.view()[0];
    assert.notEqual(first,second);assert.equal(second.content,'edited in place');
});
test('missing ignored API still filters blocked users', () => {
    const x=setup({}, {noIgnored:true});x.cache([msg('b','bad'),msg('i','ignored')]);assert.deepEqual(ids(x.view()),['i']);
});
test('missing required interfaces abort; no global-event fallback', () => {
    assert.throws(()=>setup({}, {noRelationships:true}),/缺少需要的接口/);
    assert.throws(()=>setup({}, {noStore:true}),/缺少需要的接口/);
});
test('unsupported collection shape is preserved and logged once', () => {
    const x=setup();const unsupported={items:[msg('b','bad')]};x.setCollection(unsupported);
    assert.equal(x.store.getMessages('channel'),unsupported);assert.equal(x.store.getMessages('channel'),unsupported);
    assert.equal(x.logs.filter(s=>s.includes('Unknown collection')).length,1);
    assert.equal(x.dispatcher.dispatch,x.originalDispatch);
});
console.log(`${passed} scenarios passed. Mock integration checks only, not Android UI validation.`);
