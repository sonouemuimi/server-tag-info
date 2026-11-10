(function () {
/* HideBlockedAndIgnoredMessages — local fix 1.0.0-test3
 * Original plugin: Zykrah / シグマ siguma (CC0-1.0).
 * Rewritten message filtering; no placeholder rows or fabricated events.
 * This file is a Vendetta/Revenge plugin expression, not a Node module.
 */

    "use strict";
    const v = vendetta;
    const storage = v.plugin.storage;
    const patches = [];
    const authors = new Map();
    let collections = new WeakMap();
    let patchedOwners = new WeakSet();
    let patchedHandlers = new WeakSet();
    let arrayViews = new WeakMap();
    let strippedMessages = new WeakMap();
    let relationships, messageStore, active = false;
    let warnedCollection = false;
    const MAX_AUTHORS = 10000;

    function remember(message) {
        if (!message || typeof message !== "object") return;
        const author = message.author && message.author.id;
        if (message.id && author) {
            const key = String(message.id);
            authors.delete(key);
            authors.set(key, String(author));
            if (authors.size > MAX_AUTHORS) authors.delete(authors.keys().next().value);
        }
        const ref = referenced(message);
        if (ref && ref !== message && ref.id && ref.author && ref.author.id) {
            const key = String(ref.id);
            authors.delete(key);
            authors.set(key, String(ref.author.id));
            if (authors.size > MAX_AUTHORS) authors.delete(authors.keys().next().value);
        }
    }

    function referenced(message) {
        const ref = message && (message.referenced_message || message.referencedMessage);
        return ref && (ref.message || ref);
    }

    function blockedUser(id) {
        if (!id) return false;
        return !!((storage.blocked && relationships.isBlocked(String(id))) ||
            (storage.ignored && typeof relationships.isIgnored === "function" &&
                relationships.isIgnored(String(id))));
    }

    function ownAuthor(message, channelId) {
        if (!message) return null;
        if (message.author && message.author.id) return message.author.id;
        if (message.id && authors.has(String(message.id))) return authors.get(String(message.id));
        if (message.id && messageStore && typeof messageStore.getMessage === "function") {
            const cached = messageStore.getMessage(message.channel_id || message.channelId || channelId, message.id);
            if (cached && cached.author) return cached.author.id;
        }
        return null;
    }

    function blockedReference(message, channelId) {
        if (!message) return false;
        const nested = referenced(message);
        if (nested && blockedUser(ownAuthor(nested, channelId))) return true;
        const ref = message.message_reference || message.messageReference;
        const id = (ref && (ref.message_id || ref.messageId)) || (nested && nested.id);
        if (!id) return false;
        if (blockedUser(authors.get(String(id)))) return true;
        if (messageStore && typeof messageStore.getMessage === "function") {
            const channel = (ref && (ref.channel_id || ref.channelId)) ||
                message.channel_id || message.channelId || channelId;
            const cached = messageStore.getMessage(channel, id);
            return !!(cached && blockedUser(cached.author && cached.author.id));
        }
        // Missing reference information is not proof that somebody is blocked.
        return false;
    }

    function stripReference(message) {
        const fields = Object.keys(message);
        const cached = strippedMessages.get(message);
        if (cached && cached.fields.length === fields.length &&
            fields.every((key, i) => cached.fields[i] === key && cached.values[i] === message[key])) {
            return cached.value;
        }
        const changes = {
            referenced_message: null, referencedMessage: null,
            message_reference: null, messageReference: null
        };
        // Discord's REPLY message type. Keep an ordinary message body, attachments,
        // and mentions; only remove the automatic reply preview.
        if (message.type === 19) changes.type = 0;
        let clone;
        if (typeof message.merge === "function") clone = message.merge(changes);
        else {
            const descriptors = Object.getOwnPropertyDescriptors(message);
            for (const key of Object.keys(changes)) delete descriptors[key];
            clone = Object.create(Object.getPrototypeOf(message), descriptors);
            for (const [key, value] of Object.entries(changes)) {
                Object.defineProperty(clone, key, { value, writable: true, enumerable: true, configurable: true });
            }
        }
        strippedMessages.set(message, { fields, values: fields.map(key => message[key]), value: clone });
        return clone;
    }

    function transform(message, channelId) {
        if (!active || !message || typeof message !== "object") return message;
        if (blockedUser(ownAuthor(message, channelId))) return null;
        if (blockedReference(message, channelId)) {
            if (storage.removeReplies) return null;
            if (storage.hideReplyPreview) return stripReference(message);
        }
        return message;
    }

    function transformArray(messages, channelId, cacheKey = messages) {
        if (!Array.isArray(messages) || !active) return messages;
        // Learn authors before removing anything: the referenced message may be
        // later in the same page, or may itself be removed by this filter.
        messages.forEach(remember);
        let changed = false;
        const out = [];
        for (const message of messages) {
            const next = transform(message, channelId);
            if (next !== message) changed = true;
            if (next !== null) out.push(next);
        }
        if (!changed) return messages;
        const previous = arrayViews.get(cacheKey);
        if (previous && previous.length === out.length && out.every((item, i) => item === previous[i])) {
            return previous;
        }
        arrayViews.set(cacheKey, out);
        return out;
    }

    function registerCollection(collection, channelId) {
        if (!collection || typeof collection !== "object") return collection;
        if (Array.isArray(collection)) return transformArray(collection, channelId);
        // Keep the original collection object, including identity, methods, and
        // internal receivers. Only its toArray() result is filtered for display.
        if (typeof collection.toArray !== "function") {
            if (!warnedCollection) {
                warnedCollection = true;
                v.logger.warn("[HideBlocked fix] Unknown collection shape; cached-list fallback unavailable; MessageStore event filtering remains active.");
            }
            return collection;
        }
        collections.set(collection, channelId);
        let owner = collection;
        while (owner && !Object.prototype.hasOwnProperty.call(owner, "toArray")) {
            owner = Object.getPrototypeOf(owner);
        }
        // Do not patch general-purpose built-in prototypes or attach a hook to
        // every immutable collection instance (which would retain all of them).
        if (!owner || owner === collection || owner === Object.prototype || owner === Array.prototype) {
            if (!warnedCollection) {
                warnedCollection = true;
                v.logger.warn("[HideBlocked fix] Unsupported toArray owner; MessageStore event filtering remains active.");
            }
            return collection;
        }
        if (!patchedOwners.has(owner)) {
            try {
                patches.push(v.patcher.after("toArray", owner, function (_args, result) {
                    if (!active || !collections.has(this)) return result;
                    return transformArray(result, collections.get(this), this);
                }));
                patchedOwners.add(owner);
            } catch (error) {
                if (!warnedCollection) {
                    warnedCollection = true;
                    v.logger.warn("[HideBlocked fix] Unable to hook collection.toArray; " + String(error));
                }
            }
        }
        return collection;
    }

    // Only MessageStore receives the filtered event. Never edit the shared Flux
    // event: GuildMemberStore/UserStore must receive the original member payload.
    function filterStoreEvent(event) {
        if (!event || !active) return event;
        if (event.type === "LOAD_MESSAGES_SUCCESS" && Array.isArray(event.messages)) {
            const messages = transformArray(event.messages, event.channelId || event.channel_id);
            return messages === event.messages ? event : { ...event, messages };
        }
        if ((event.type === "MESSAGE_CREATE" || event.type === "MESSAGE_UPDATE") && event.message) {
            remember(event.message);
            const message = transform(event.message, event.channelId || event.channel_id);
            if (message === null) return null;
            return message === event.message ? event : { ...event, message };
        }
        return event;
    }

    function installStoreHandlers() {
        const dispatcher = v.metro.common.FluxDispatcher;
        const handlers = dispatcher && dispatcher._actionHandlers;
        if (!handlers || typeof handlers._computeOrderedActionHandlers !== "function") {
            throw new Error("HideBlocked fix: 找不到 MessageStore 事件入口，请关闭插件并反馈日志。");
        }
        const types = new Set(["LOAD_MESSAGES_SUCCESS", "MESSAGE_CREATE", "MESSAGE_UPDATE"]);
        function patchEntries(type, entries) {
            if (!types.has(type) || !Array.isArray(entries)) return 0;
            let found = 0;
            for (const entry of entries) {
                if (entry.name !== "MessageStore" || typeof entry.actionHandler !== "function") continue;
                found++;
                if (patchedHandlers.has(entry)) continue;
                patches.push(v.patcher.instead("actionHandler", entry, (args, original) => {
                    if (!active) return original(...args);
                    const next = filterStoreEvent(args[0]);
                    if (next === null) return false; // No change to MessageStore; other stores still run.
                    if (next === args[0]) return original(...args);
                    return original(next, ...args.slice(1));
                }));
                patchedHandlers.add(entry);
            }
            return found;
        }
        // The mobile Flux implementation caches ordered entries. Patch both the
        // existing entries and replacements after its dependency cache rebuilds.
        patches.push(v.patcher.after("_computeOrderedActionHandlers", handlers, ([type], result) => {
            if (active) patchEntries(type, result);
        }));
        for (const type of types) {
            if (!patchEntries(type, handlers._computeOrderedActionHandlers(type))) {
                throw new Error("HideBlocked fix: 缺少 MessageStore " + type + " 入口，已撤销补丁。");
            }
        }
    }

    function Settings() {
        v.storage.useProxy(storage);
        const { React, ReactNative } = v.metro.common;
        const { FormSwitchRow } = v.ui.components.Forms;
        const switches = [
            ["blocked", "隐藏被屏蔽用户的消息", "过滤消息，不显示占位提示。"],
            ["ignored", "隐藏被忽略用户的消息", "仅在 Discord 提供忽略状态接口时生效。"],
            ["removeReplies", "同时隐藏其他人回复他们的整条消息", "关闭后保留其他人的回复正文。"],
            ["hideReplyPreview", "保留回复时隐藏被屏蔽者的引用", "上一项关闭时生效；修改开关后强行停止并重新打开 Discord。"]
        ];
        return React.createElement(ReactNative.ScrollView, null,
            ...switches.map(([key, label, note]) => React.createElement(FormSwitchRow, {
                key, label, note, value: !!storage[key],
                onValueChange: value => { storage[key] = value; }
            })));
    }

    function unload() {
        active = false;
        for (const unpatch of patches.splice(0).reverse()) {
            try { unpatch(); } catch (error) { v.logger.error(error); }
        }
        authors.clear();
        collections = new WeakMap();
        patchedOwners = new WeakSet();
        patchedHandlers = new WeakSet();
        arrayViews = new WeakMap();
        strippedMessages = new WeakMap();
        warnedCollection = false;
    }

    return {
        onLoad() {
            if (active) return;
            storage.blocked ??= true;
            storage.ignored ??= true;
            storage.removeReplies ??= true;
            storage.hideReplyPreview ??= true;
            relationships = v.metro.findByProps("getRelationships", "isBlocked") ||
                v.metro.findByProps("isBlocked");
            messageStore = v.metro.findByProps("getMessages", "getMessage");
            if (!relationships || typeof relationships.isBlocked !== "function" ||
                !messageStore || typeof messageStore.getMessages !== "function") {
                throw new Error("HideBlocked fix: 当前 Discord 缺少需要的接口，请关闭插件并反馈版本。");
            }
            active = true;
            try {
                installStoreHandlers();
                patches.push(v.patcher.after("getMessages", messageStore,
                    ([channelId], result) => registerCollection(result, channelId)));
            } catch (error) {
                unload();
                throw error;
            }
            v.logger.log("[HideBlocked fix] 1.0.0-test3 loaded; MessageStore-only event filtering; original events preserved for member and other stores.");
        },
        onUnload: unload,
        settings: Settings
    };
})()
