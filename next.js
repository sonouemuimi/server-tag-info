function nextAdapter(api) {
    const U = api.unscoped;
    const A = {
        name: 'Revenge Next', React: U.react.React, RN: U.react.ReactNative,
        log: line => console.log(line),
        around: (parent, key, hook) => U.patcher.instead(parent, key, hook),
        discoverUI(exports) {
            if (exports && exports.ActionSheet) A.actionSheet = exports.ActionSheet;
            if (exports && typeof exports.openLazy === 'function' && typeof exports.hideActionSheet === 'function') {
                A.openSheet = (Component, props) => exports.openLazy(Promise.resolve({ default: Component }), 'ServerTagInfo', props);
                A.closeSheet = () => exports.hideActionSheet();
            }
            if (exports && typeof exports.setString === 'function' && typeof exports.getString === 'function') A.copy = text => exports.setString(text);
            if (exports && typeof exports.dispatch === 'function' && typeof exports.subscribe === 'function') A.dispatcher = exports;
        }
    };
    A.scan = inspect => {
        const finders = U.modules.finders, filters = finders.filters;
        const generator = filters.createFilterGenerator(
            (_args, _id, exports) => !!exports,
            () => 'ServerTagInfo.initialized', filters.FilterScopes.Initialized);
        for (const [exports, id] of finders.lookupModules(generator(), { initialize: false, cached: false })) inspect(exports, id);
    };
    A.subscribe = inspect => U.modules.metro.onAnyModuleInitialized((id, exports) => inspect(exports, id));
    return A;
}
