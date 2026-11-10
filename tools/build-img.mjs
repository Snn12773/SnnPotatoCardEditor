// 把 assets/img/*.png 打包成 assets/data/img.json（base64 data URL）
// 用法: node tools/build-img.mjs
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const imgDir = path.join(root, 'assets', 'img');
const outFile = path.join(root, 'assets', 'data', 'img.json');

// 固定顺序，保证 img.json 的 diff 稳定
const ORDER = ['front_I', 'front_II', 'front_III', 'front_IV', 'derivative', 'test_potato', 'potato_temp'];

const imgs = {};
for (const name of ORDER) {
  const f = path.join(imgDir, name + '.png');
  if (!fs.existsSync(f)) { console.warn('跳过（缺失）:', name); continue; }
  imgs[name] = 'data:image/png;base64,' + fs.readFileSync(f).toString('base64');
}
fs.writeFileSync(outFile, JSON.stringify(imgs), 'utf8');
console.log('wrote', path.relative(root, outFile), '|', Object.keys(imgs).join(', '),
  '|', (fs.statSync(outFile).size / 1024).toFixed(1) + ' KB');
