// 把像素字体库（GameDigits.woff2）内嵌进 index.template.html 的 @font-face
// 用法：node tools/inject-font.mjs [woff2 路径]
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const woff2 = process.argv[2] || 'C:/Users/c\'c/WorkBuddy/des/pixel-font/GameDigits.woff2';
const tplPath = path.join(root, 'src', 'index.template.html');

const b64 = fs.readFileSync(woff2).toString('base64');
let tpl = fs.readFileSync(tplPath, 'utf8');
const re = /src:url\(data:font\/woff2;base64,[A-Za-z0-9+/=]+\) format\("woff2"\);/;
if (!re.test(tpl)) {
  console.error('未找到 @font-face 的 base64 数据');
  process.exit(1);
}
tpl = tpl.replace(re, `src:url(data:font/woff2;base64,${b64}) format("woff2");`);
fs.writeFileSync(tplPath, tpl, 'utf8');
console.log(`embedded ${woff2} -> ${b64.length} chars (${(fs.statSync(woff2).size / 1024).toFixed(1)} KB)`);
