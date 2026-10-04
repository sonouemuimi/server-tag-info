function legacyAdapter(vendetta) {
    const common = vendetta.metro.common, RN = common.ReactNative;
    const A = {
        name: 'Revenge/Vendetta', React: common.React, RN,
        dispatcher: common.FluxDispatcher,
        log: line => { const logger = vendetta.logger; if (logger && logger.info) logger.info(line); else console.log(line); },
        copy: text => { if (common.clipboard && common.clipboard.setString) common.clipboard.setString(text); else if (RN.Clipboard) RN.Clipboard.setString(text); },
        around: (parent, key, hook) => vendetta.patcher.instead(key, parent, hook),
        discoverUI(exports) {
            if (exports && exports.ActionSheet) A.actionSheet = exports.ActionSheet;
            if (exports && typeof exports.openLazy === 'function' && typeof exports.hideActionSheet === 'function') {
                A.openSheet = (Component, props) => exports.openLazy(Promise.resolve({ default: Component }), 'ServerTagInfo', props);
                A.closeSheet = () => exports.hideActionSheet();
            }
            if (!common.clipboard && exports && typeof exports.setString === 'function' && typeof exports.getString === 'function') A.copy = text => exports.setString(text);
        }
    };
    const initialized = new Set();
    function scan(inspect) {
        // Public module registry structure confirmed in revenge-bundle/src/metro/internals/modules.ts.
        const modules = vendetta.metro.modules || globalThis.modules || {};
        for (const id of Object.keys(modules)) {
            const record = modules[id];
            if (!record || !record.isInitialized || record.hasError || !record.publicModule) continue;
            if (initialized.has(id)) continue;
            initialized.add(id);
            try { inspect(record.publicModule.exports, id, record.__filePath); } catch (_) {}
        }
    }
    A.scan = inspect => { initialized.clear(); scan(inspect); };
    A.subscribe = inspect => {
        // Poll only initialized exports; do not require modules or intercept the app's loader.
        const timer = setInterval(() => scan(inspect), 1500);
        return () => { clearInterval(timer); initialized.clear(); A.actionSheet = A.openSheet = A.closeSheet = undefined; };
    };
    return A;
}
