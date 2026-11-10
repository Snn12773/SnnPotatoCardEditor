// 把 8×8 像素图标（assets/icons/{day_mode,night_mode}）内嵌为 CSS 变量
// 用法：node tools/inject-icons.mjs
// 说明：白天/黑夜各一套；缺失的同形图标互相回退（保存↔下载、查看↔查找）。
//      升序/降序已按点阵核对：升序.png 的柱子自上而下由短变长（1→4），降序.png 由长变短（4→1），
//      文件名与语义一致，直接用即可。
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'assets', 'icons');
const TPL = path.join(ROOT, 'src', 'index.template.html');

// key: [白天文件, 黑夜文件]
const MAP = {
  new: ['新建.png', '新建.png'],
  edit: ['编辑.png', '编辑.png'],
  del: ['删除.png', '删除.png'],
  copy: ['复制.png', '复制.png'],
  download: ['下载.png', '保存.png'],
  save: ['下载.png', '保存.png'],
  search: ['查找.png', '查看.png'],
  list: ['列表.png', '列表.png'],
  grid: ['网格.png', '网格.png'],
  asc: ['升序.png', '升序.png'],
  desc: ['降序.png', '降序.png'],
  close: ['关闭.png', '关闭.png'],
  moon: ['夜间模式.png', '夜间模式.png'],
  sun: ['白天模式.png', '白天模式.png']
};

function dataUri(mode, file) {
  const p = path.join(SRC, mode, file);
  if (!fs.existsSync(p)) {
    // 白天缺 保存/查看，黑夜缺 下载/查找 —— 用同形的另一套顶上
    const alt = mode === 'day_mode' ? 'night_mode' : 'day_mode';
    const p2 = path.join(SRC, alt, file);
    if (!fs.existsSync(p2)) throw new Error('缺少图标: ' + p);
    return 'url("data:image/png;base64,' + fs.readFileSync(p2).toString('base64') + '")';
  }
  return 'url("data:image/png;base64,' + fs.readFileSync(p).toString('base64') + '")';
}

const lines = (mode) => Object.entries(MAP)
  .map(([k, v]) => `  --ic-${k}:${dataUri(mode, mode === 'day_mode' ? v[0] : v[1])};`)
  .join('\n');

const css = [
  '/* ICONS:BEGIN —— 由 tools/inject-icons.mjs 生成，勿手改 */',
  ':root{',
  lines('day_mode'),
  '}',
  'html[data-theme="dark"]{',
  lines('night_mode'),
  '}',
  '/* ICONS:END */'
].join('\n');

let tpl = fs.readFileSync(TPL, 'utf8');
const re = /\/\* ICONS:BEGIN[\s\S]*?\/\* ICONS:END \*\//;
if (!re.test(tpl)) throw new Error('模板里没有 /* ICONS:BEGIN */ 标记');
tpl = tpl.replace(re, css);
fs.writeFileSync(TPL, tpl, 'utf8');
console.log('icons injected:', Object.keys(MAP).length, 'keys × 2 modes, css', css.length, 'chars');
