const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(__dirname + '/index.js', 'utf8');
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('PASS ' + name); }
function setup(options = {}, controls = {}) {
    const sent = [], logs = [], blocked = new Set(['bad']), ignored = new Set(['ignored']);
    const storage = {blocked: true, ignored: true, removeReplies: false, hideReplyPreview: true, ...options};
    const records = new Map();
    class Messages {
        constructor(items) { this.items = items; }
        toArray() { return this.items; }
        lookup(id) { return this.items.find(m => m.id === id); }
    }
    let collection = new Messages([]);
    const store = {getMessages() { return collection; }, getMessage(channel, id) { return records.get(id); }};
    const relationships = {getRelationships() {}, isBlocked(id) { return blocked.has(id); }, isIgnored(id) { return ignored.has(id); }};
    if (controls.noIgnored) delete relationships.isIgnored;
    const dispatcher = {dispatch(e) { sent.push(e); return 'dispatched'; }};
    function patch(kind, key, obj, cb) {
        const original = obj[key];
        obj[key] = function (...args) {
            if (kind === 'instead') return cb(args, original.bind(this));
            const ret = original.apply(this, args), next = cb(args, ret);
            return next === undefined ? ret : next;
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
    return {plugin, storage, sent, logs, blocked, ignored, store, records, dispatcher,
        cache(items) {collection = new Messages(items); items.forEach(m => records.set(m.id, m)); return collection; }};
}
const msg = (id, author = 'good', extra = {}) => ({id, channel_id: 'channel', author: {id: author}, type: 0, content: 'body', ...extra});

test('real-time blocked/ignored events are stopped, normal events pass without mutation', () => {
    const x = setup();
    const blockedEvent = Object.freeze({type: 'MESSAGE_CREATE', message: Object.freeze(msg('1','bad'))});
    assert.equal(x.dispatcher.dispatch(blockedEvent), undefined);
    x.dispatcher.dispatch({type: 'MESSAGE_CREATE', message: msg('2','ignored')});
    const normal = {type:'MESSAGE_CREATE',message:msg('3')};
    assert.equal(x.dispatcher.dispatch(normal), 'dispatched');
    assert.deepEqual(x.sent, [normal]);
    assert.equal(blockedEvent.message.content, 'body');
});
test('history removes rows without mutating input or pagination metadata', () => {
    const x = setup();
    const list = Object.freeze([Object.freeze(msg('1','bad')),Object.freeze(msg('2'))]);
    const e = Object.freeze({type:'LOAD_MESSAGES_SUCCESS', messages:list, hasMoreBefore:true, channelId:'channel'});
    x.dispatcher.dispatch(e);
    assert.deepEqual(Array.from(x.sent[0].messages, m => m.id), ['2']);
    assert.equal(list.length, 2);
    assert.equal(x.sent[0].hasMoreBefore, true);
});
test('camelCase reply reference retains body and removes preview with frozen record', () => {
    const x = setup();
    const reply = Object.freeze(msg('r','good', {type:19, referencedMessage:msg('b','bad'), messageReference:{messageId:'b', channelId:'channel'}}));
    x.dispatcher.dispatch({type:'MESSAGE_CREATE',message:reply});
    const actual = x.sent[0].message;
    assert.equal(actual.content, 'body'); assert.equal(actual.type, 0);
    assert.equal(actual.referencedMessage, null); assert.equal(actual.messageReference, null);
    assert.equal(reply.type, 19); assert.equal(reply.referencedMessage.author.id, 'bad');
});
test('reference-only reply is resolved regardless of order in a page', () => {
    const x = setup({removeReplies:true});
    x.dispatcher.dispatch({type:'LOAD_MESSAGES_SUCCESS',messages:[msg('r','good',{message_reference:{message_id:'b'}}),msg('b','bad'),msg('g')]});
    assert.deepEqual(Array.from(x.sent[0].messages,m=>m.id), ['g']);
});
test('reference-only cached target is resolved for real-time replies', () => {
    const x=setup({removeReplies:true}); x.cache([msg('b','bad')]);
    x.dispatcher.dispatch({type:'MESSAGE_CREATE', message:msg('r','good',{messageReference:{messageId:'b'}})});
    assert.equal(x.sent.length,0);
});
test('unknown/deleted replies and ordinary mentions are left intact', () => {
    const x=setup({removeReplies:true});
    const unknown=msg('r','good',{referenced_message:null,message_reference:{message_id:'missing'},mentions:[{id:'bad'}]});
    x.dispatcher.dispatch({type:'MESSAGE_CREATE',message:unknown});
    assert.equal(x.sent[0].message,unknown);
});
test('partial update without author is blocked using cache', () => {
    const x=setup(); x.cache([msg('b','bad')]);
    x.dispatcher.dispatch({type:'MESSAGE_UPDATE',message:{id:'b',channel_id:'channel',content:'edit'}});
    assert.equal(x.sent.length,0);
});
test('partial update without author is blocked using observed history', () => {
    const x=setup();
    x.dispatcher.dispatch({type:'LOAD_MESSAGES_SUCCESS',messages:[msg('b','bad')]});
    x.dispatcher.dispatch({type:'MESSAGE_UPDATE',message:{id:'b',content:'edit'}});
    assert.equal(x.sent.length,1);
});
test('cached toArray hides newly blocked authors, preserves underlying records', () => {
    const x=setup(); const original=x.cache([msg('1'),msg('2','bad')]);
    const view=x.store.getMessages('channel');
    assert.deepEqual(Array.from(view.toArray(),m=>m.id),['1']);
    assert.equal(original.toArray().length,2);
    assert.equal(view.lookup('1').id,'1');
    x.blocked.add('good'); assert.equal(view.toArray().length,0);
    x.blocked.clear(); assert.equal(view.toArray().length,2);
    assert.equal(x.store.getMessages('channel'),view);
});
test('disable switches, unload, and reload restore normal behavior', () => {
    const x=setup({blocked:false,ignored:false});
    x.dispatcher.dispatch({type:'MESSAGE_CREATE',message:msg('1','bad')}); assert.equal(x.sent.length,1);
    x.storage.blocked=true; const original=x.cache([msg('2','bad')]); const view=x.store.getMessages('channel');
    assert.equal(view.toArray().length,0);
    x.plugin.onUnload(); assert.equal(view.toArray().length,1); assert.equal(x.store.getMessages('channel'),original);
    x.dispatcher.dispatch({type:'MESSAGE_CREATE',message:msg('3','bad')}); assert.equal(x.sent.length,2);
    x.plugin.onLoad(); x.dispatcher.dispatch({type:'MESSAGE_CREATE',message:msg('4','bad')}); assert.equal(x.sent.length,2);
});
test('normal replies and other Flux events retain object identity and behavior', () => {
    const x=setup(); const m=msg('r','good',{referenced_message:msg('g')});
    x.dispatcher.dispatch({type:'MESSAGE_CREATE',message:m}); assert.equal(x.sent[0].message,m);
    const e={type:'MESSAGE_DELETE',id:'g'};x.dispatcher.dispatch(e);assert.equal(x.sent[1],e);
    assert.equal(x.sent.length,2); // No fake events at startup.
});
test('preserves record class and methods while hiding reference', () => {
    const x=setup(); class Record { constructor(){Object.assign(this,msg('r','good',{type:19,referenced_message:msg('b','bad')}));} label(){return this.content;} }
    const m=Object.freeze(new Record());x.dispatcher.dispatch({type:'MESSAGE_CREATE',message:m});
    assert.ok(x.sent[0].message instanceof Record); assert.equal(x.sent[0].message.label(),'body');
});
test('missing ignored API does not prevent blocked filtering', () => {
    const x=setup({}, {noIgnored:true});
    x.dispatcher.dispatch({type:'MESSAGE_CREATE',message:msg('b','bad')});
    x.dispatcher.dispatch({type:'MESSAGE_CREATE',message:msg('i','ignored')});
    assert.equal(x.sent.length,1); assert.equal(x.sent[0].message.id,'i');
});
test('missing required API aborts instead of silently claiming success', () => {
    assert.throws(() => setup({}, {noRelationships:true}), /缺少需要的接口/);
});
test('fallback without MessageStore still filters live events', () => {
    const x=setup({}, {noStore:true});
    x.dispatcher.dispatch({type:'MESSAGE_CREATE',message:msg('b','bad')});
    assert.equal(x.sent.length,0);
    assert.ok(x.logs.some(s=>s.includes('MessageStore not found')));
});
console.log(`${passed} scenarios passed. These are mock integration checks, not Android UI validation.`);
