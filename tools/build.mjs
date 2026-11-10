// 组装 index.html：模板 + 内联图片 + 种子数据 + 应用逻辑
// 用法:
//   node tools/build.mjs                                   # 种子 = assets/data/cards.json
//   node tools/build.mjs --seed none --out index.html      # 发布版：不含任何卡牌数据
//   node tools/build.mjs --seed assets/data/cards.json --out out/dev-index.html
// 版本号：环境变量 POTATO_VER（package.mjs / release.mjs 传入），直接构建为 dev
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const args = process.argv.slice(2);
const argOf = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const SEED = argOf('--seed', 'assets/data/cards.json');
const OUT = argOf('--out', 'index.html');

const tpl = read('src/index.template.html');
const part1 = read('src/app.part1.js');
const part2 = read('src/app.part2.js');
const imgJson = read('assets/data/img.json').trim();

// 种子：none / empty = 空卡库（发布版，数据由数据包提供）
const EMPTY_SEED = SEED === 'none' || SEED === 'empty';
const seedJson = EMPTY_SEED ? '{"cards":[]}' : read(SEED).trim();

// 校验 JSON 合法性
const imgs = JSON.parse(imgJson);
const seed = JSON.parse(seedJson);
console.log('images:', Object.keys(imgs).length, '| seed cards:', seed.cards.length,
  EMPTY_SEED ? '(空种子)' : '(' + SEED + ')');

const appJs = part1 + '\n\n' + part2;

// 注意：String.replace 的替换串会把 $$ 解释为字面 $，因此必须用函数式替换，
// 否则 app 代码里的 `function $$(...)` 会被改成 `function $(...)`，导致同名覆盖。
const APP_VER = process.env.POTATO_VER || 'dev';
let out = tpl
  .replace('__IMG_DATA__', () => imgJson)
  .replace('__SEED_DATA__', () => seedJson)
  .replaceAll('__APP_VER__', () => APP_VER)
  .replace('__APP_JS__', () => appJs);
console.log('app version:', APP_VER);

// 残留占位符检查（只检查我们自己的模板占位符）
// 注意：__APP_VER__ 的属性名 window.__APP_VER__ 是运行时合法代码，只检查字符串字面量残留
for (const ph of ['__IMG_DATA__', '__SEED_DATA__', '__APP_JS__']) {
  if (out.includes(ph)) throw new Error('未替换的占位符: ' + ph);
}
if (out.includes("= '__APP_VER__'")) throw new Error('版本号未注入');

const outPath = path.resolve(root, OUT);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, out, 'utf8');
console.log('wrote ' + path.relative(root, outPath), out.length, 'bytes');
