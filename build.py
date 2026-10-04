#!/usr/bin/env python3
"""Build zero-dependency root URL plugin and Revenge Next ZIP."""
import hashlib, json, pathlib, zipfile

BASE = pathlib.Path(__file__).resolve().parent
core = (BASE / 'core.js').read_text()
legacy = '(function(){\n' + core + '\n' + (BASE / 'legacy.js').read_text() + '''
const instance = createServerTagInfo(legacyAdapter(vendetta));
return { onLoad: instance.start, onUnload: instance.stop, settings: instance.Settings };
})()
'''
nxt = '(function(){\n' + core + '\n' + (BASE / 'next.js').read_text() + '''
let instance;
return { default: plugin({
    start(api) { instance = createServerTagInfo(nextAdapter(api)); instance.start(); },
    stop() { if (instance) instance.stop(); instance = undefined; },
    SettingsComponent() { return instance ? instance.Settings() : null; }
}) };
})()
'''
(BASE / 'index.js').write_text(legacy)
(BASE / 'next-index.js').write_text(nxt)
manifest = {
    'name': 'ServerTagInfo', 'description': '只读取 Discord 已持有的服务器标签信息；不请求私人服务器资料。',
    'authors': [{'name': 'ServerTagInfo'}], 'main': 'index.js', 'version': '1.0.1',
    'hash': hashlib.sha256(legacy.encode()).hexdigest(), 'vendetta': {'icon': 'InformationCircleIcon'}
}
(BASE / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
next_manifest = {
    'format': 1, 'id': 'local.servertaginfo', 'name': 'ServerTagInfo',
    'description': manifest['description'], 'author': 'ServerTagInfo', 'version': '1.0.1',
    'dependencies': {'revenge.api': {'version': '>=1 <2'}, 'discord': {'version': '*'}},
    'dist': {'script': 'index.js'}
}
(BASE / 'next-manifest.json').write_text(json.dumps(next_manifest, ensure_ascii=False, indent=2) + '\n')
with zipfile.ZipFile(BASE / 'ServerTagInfo-Next-1.0.1.zip', 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('manifest.json', json.dumps(next_manifest, ensure_ascii=False, indent=2) + '\n')
    z.writestr('index.js', nxt)
with zipfile.ZipFile(BASE / 'ServerTagInfo-Source-1.0.1.zip', 'w', zipfile.ZIP_DEFLATED) as z:
    for name in ['core.js', 'legacy.js', 'next.js', 'test.js', 'build.py', 'README.md', 'RESEARCH.md', '.gitignore', 'index.js', 'manifest.json', 'next-index.js', 'next-manifest.json', 'ServerTagInfo-Next-1.0.1.zip']:
        z.write(BASE / name, name)
print('Built root URL plugin, Next ZIP and source archive.')
