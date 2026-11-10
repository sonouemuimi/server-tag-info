(function () {
/* HideBlockedAndIgnoredMessages — local fix 1.0.0-test1
 * Original plugin: Zykrah / シグマ siguma (CC0-1.0).
 * Rewritten message filtering; no placeholder rows or fabricated events.
 * This file is a Vendetta/Revenge plugin expression, not a Node module.
 */

    "use strict";
    const v = vendetta;
    const storage = v.plugin.storage;
    const patches = [];
    const authors = new Map();
    let views = new WeakMap();
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
        const changes = {
            referenced_message: null, referencedMessage: null,
            message_reference: null, messageReference: null
        };
        // Discord's REPLY message type. Keep an ordinary message body, attachments,
        // and mentions; only remove the automatic reply preview.
        if (message.type === 19) changes.type = 0;
        if (typeof message.merge === "function") return message.merge(changes);
        const descriptors = Object.getOwnPropertyDescriptors(message);
        for (const key of Object.keys(changes)) delete descriptors[key];
        const clone = Object.create(Object.getPrototypeOf(message), descriptors);
        for (const [key, value] of Object.entries(changes)) {
            Object.defineProperty(clone, key, { value, writable: true, enumerable: true, configurable: true });
        }
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

    function transformArray(messages, channelId) {
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
        return changed ? out : messages;
    }

    function collectionView(collection, channelId) {
        if (!collection || typeof collection !== "object") return collection;
        if (Array.isArray(collection)) return transformArray(collection, channelId);
        if (typeof collection.toArray !== "function") {
            if (!warnedCollection) {
                warnedCollection = true;
                v.logger.warn("[HideBlocked fix] Unknown message collection; cached rows may require channel reload.");
            }
            return collection;
        }
        if (views.has(collection)) return views.get(collection);
        // A view avoids deleting Discord's actual cache. Methods other than
        // toArray retain their native receiver and behavior.
        const methods = new Map();
        const view = new Proxy(collection, {
            get(target, key) {
                if (key === "toArray") {
                    if (!methods.has(key)) methods.set(key, (...args) =>
                        transformArray(target.toArray(...args), channelId));
                    return methods.get(key);
                }
                const value = Reflect.get(target, key, target);
                if (typeof value !== "function") return value;
                if (!methods.has(key) || methods.get(key).original !== value) {
                    const bound = value.bind(target);
                    bound.original = value;
                    methods.set(key, bound);
                }
                return methods.get(key);
            }
        });
        views.set(collection, view);
        return view;
    }

    function dispatchPatch(args, original) {
        const event = args[0];
        if (!active || !event || typeof event !== "object") return original(...args);
        let nextEvent = event;
        if (event.type === "LOAD_MESSAGES_SUCCESS" && Array.isArray(event.messages)) {
            const next = transformArray(event.messages, event.channelId || event.channel_id);
            if (next !== event.messages) nextEvent = { ...event, messages: next };
        } else if (event.type === "MESSAGE_CREATE" || event.type === "MESSAGE_UPDATE") {
            remember(event.message);
            const next = transform(event.message, event.channelId || event.channel_id);
            // Actually stop delivery. Altering channelId did not stop native
            // consumers which use message.channel_id.
            if (next === null) return undefined;
            if (next !== event.message) nextEvent = { ...event, message: next };
        }
        return original(nextEvent, ...args.slice(1));
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
        views = new WeakMap();
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
            const dispatcher = v.metro.common.FluxDispatcher;
            if (!relationships || typeof relationships.isBlocked !== "function" ||
                !dispatcher || typeof dispatcher.dispatch !== "function") {
                throw new Error("HideBlocked fix: 当前 Discord 缺少需要的接口，请关闭插件并反馈版本。");
            }
            active = true;
            try {
                patches.push(v.patcher.instead("dispatch", dispatcher, dispatchPatch));
                if (messageStore) {
                    patches.push(v.patcher.after("getMessages", messageStore,
                        ([channelId], result) => collectionView(result, channelId)));
                } else {
                    v.logger.warn("[HideBlocked fix] MessageStore not found; cached messages require a reload.");
                }
            } catch (error) {
                unload();
                throw error;
            }
            v.logger.log("[HideBlocked fix] 1.0.0-test1 loaded; no RowManager mutation or placeholder rows.");
        },
        onUnload: unload,
        settings: Settings
    };
})()
