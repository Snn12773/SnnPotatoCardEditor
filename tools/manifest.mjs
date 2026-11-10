#!/usr/bin/env node
/**
 * 生成托管用的更新清单：manifest.json + manifest.js（写到仓库根目录）
 *
 * 用法：
 *   node tools/manifest.mjs --ver 0.1.4 --notes "修复 xx"
 *
 * 说明：
 *   - manifest.json 供 http(s) 页面 fetch（GitHub Pages / jsDelivr 都读它）
 *   - manifest.js  是 JSONP 包装，给本地 file:// 副本用 <script> 加载（绕开 CORS）
 *   - 两者必须与 index.html 同目录（Pages 根目录即仓库根目录）
 */
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const getArg = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};

const ver = getArg('--ver', '');
if (!/^\d+\.\d+\.\d+$/.test(ver)) {
  console.error('版本号必须形如 0.1.4（收到：' + (ver || '空') + '）');
  process.exit(1);
}

const manifest = {
  version: ver,
  buildTime: new Date().toISOString(),
  notes: getArg('--notes', ''),
  file: 'index.html?v=' + ver
};

fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
fs.writeFileSync(path.join(root, 'manifest.js'),
  'window.__potatoManifest&&window.__potatoManifest(' + JSON.stringify(manifest) + ');\n', 'utf8');

console.log('已写入 manifest.json / manifest.js  →  v' + ver +
  (manifest.notes ? '  (' + manifest.notes + ')' : ''));
