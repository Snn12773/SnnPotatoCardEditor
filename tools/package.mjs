#!/usr/bin/env node
/**
 * 土豆牌卡牌工作台 · 打包脚本
 *
 * 用法：
 *   node tools/package.mjs                     # 用 assets/data/cards.json
 *   node tools/package.mjs --data out/live-full.json   # 用导出的全量 JSON
 *   node tools/package.mjs --ver 1.0.0         # 指定版本号
 *
 * 产物：dist/土豆牌卡牌工作台-v<版本>/
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const getArg = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};

const VERSION = getArg('--ver', '1.0.0');
const dataPath = getArg('--data', 'assets/data/cards.json');

// ---------- 1. 读取并校验数据 ----------
function loadCards(p) {
  const abs = path.resolve(root, p);
  if (!fs.existsSync(abs)) throw new Error('找不到数据文件: ' + abs);
  const raw = JSON.parse(fs.readFileSync(abs, 'utf8'));

  // 兼容两种形态：裸 cards.json 或 全量信封
  let cards, revisions = [];
  if (Array.isArray(raw.cards)) {
    cards = raw.cards;
    revisions = Array.isArray(raw.revisions) ? raw.revisions : [];
    if (raw.kind && raw.kind !== 'potato-card-editor') throw new Error('kind 不符: ' + raw.kind);
  } else {
    throw new Error('数据格式不认识：缺少 cards 数组');
  }
  return { cards, revisions, source: abs };
}

const { cards, revisions, source } = loadCards(dataPath);
console.log(`数据源: ${path.relative(root, source)}`);
console.log(`卡牌 ${cards.length} 张，变更记录 ${revisions.length} 条`);

// 校验
const errors = [];
const ids = new Set();
for (const c of cards) {
  if (!c.id) errors.push('缺 id: ' + JSON.stringify(c).slice(0, 60));
  else if (ids.has(c.id)) errors.push('id 重复: ' + c.id);
  else ids.add(c.id);
  if (!c.name) errors.push('缺名称: ' + c.id);
  if (!['I', 'II', 'III', 'IV', '衍生物'].includes(c.level)) errors.push('等级非法: ' + c.name + ' = ' + c.level);
  if (!['攻击', '防御', '辅助', '衍生物'].includes(c.type)) errors.push('类型非法: ' + c.name + ' = ' + c.type);
  // 范围标记校验
  for (const m of String(c.text || '').matchAll(/\[\[r:([01]{9})\]\]/g)) {
    if (m[1][4] !== '0') errors.push('范围中心位应为 0: ' + c.name + ' ' + m[1]);
  }
}
if (errors.length) {
  console.error('\n数据校验失败：');
  for (const e of errors) console.error('  ✗ ' + e);
  process.exit(1);
}
console.log('数据校验通过');

// ---------- 2. 组装分发目录并构建 index.html（注入版本号 + 数据） ----------
const distRoot = path.join(root, 'dist');
const pkgName = `土豆牌卡牌工作台-v${VERSION}`;
const pkgDir = path.join(distRoot, pkgName);

if (fs.existsSync(pkgDir)) fs.rmSync(pkgDir, { recursive: true, force: true });
fs.mkdirSync(pkgDir, { recursive: true });

// 注意：分发包直接构建到 pkgDir，仓库根目录的 index.html（发布版、无卡牌数据）不受影响
console.log('\n构建 index.html ...');
execFileSync(process.execPath, [
  path.join(root, 'tools', 'build.mjs'),
  '--seed', source,
  '--out', path.join(pkgDir, 'index.html')
], {
  stdio: 'inherit', cwd: root,
  env: { ...process.env, POTATO_VER: VERSION }
});

// ---------- 3. 复制运行期资源 ---------- ----------
const copy = (src, destRel) => {
  const from = path.join(root, src);
  if (!fs.existsSync(from)) return false;
  const to = path.join(pkgDir, destRel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  return true;
};

// 运行时（index.html 已在上面直接构建进 pkgDir）
for (const f of ['front_I', 'front_II', 'front_III', 'front_IV', 'derivative', 'test_potato', 'potato_temp']) {
  copy(`assets/img/${f}.png`, `assets/img/${f}.png`);
}
copy('assets/data/cards.json', 'assets/data/cards.json');

// 文档
const docMap = {
  'docs/卡牌编辑器-使用说明.md': '使用说明.md',
  'docs/土豆牌-卡牌库-v1.md': '卡牌库.md',
  'docs/土豆牌-设计总结-交接用.md': '设计总结.md',
  'docs/土豆牌-设计梳理-v0.2.md': '规则设计-v0.2.md',
  'docs/待定数值清单.md': '待定数值清单.md'
};
const copiedDocs = [];
for (const [src, dest] of Object.entries(docMap)) {
  if (copy(src, dest)) copiedDocs.push(dest);
}

// 源码与工具（可选，便于二次开发）
copy('src/index.template.html', 'src/index.template.html');
copy('src/app.part1.js', 'src/app.part1.js');
copy('src/app.part2.js', 'src/app.part2.js');
copy('tools/build.mjs', 'tools/build.mjs');
copy('assets/data/img.json', 'assets/data/img.json');

// ---------- 4. 生成说明文件 ----------
const readme = `# 土豆牌 · 卡牌工作台 v${VERSION}

## 快速开始

双击 **index.html**，用 Chrome 或 Edge 打开即可使用。
无需安装、无需联网、无需服务器。

## 这是什么

一个用于《土豆牌》卡牌设计、查看与团队协作的网页工具：

- 三栏工作台：左侧筛选列表 / 中间卡牌网格 / 右侧检视器
- 卡面按真实卡框渲染（I–IV 四级背景 + 衍生物简化卡面），显示卡图、卡名、攻击力 / 血量 / 价值
- 卡名使用黑体族（Adobe 黑体 Std → 思源黑体 → 微软雅黑 回退），数值使用像素字体 GameDigits（只对纯数字生效）
- 卡图可上传：编辑时点卡面卡图或属性页「上传图片」，任意尺寸自动等比缩放居中裁切为 32×32
- 牌效与设计思路支持富文本（加粗 / 斜体 / 下划线 / 5 种颜色 / 清除格式），名称等文字同样支持富文本显示
- 衍生物等级的卡牌使用专用卡框（derivative），卡面只显示名称、卡图与三个数值
- 选中卡牌即在右侧显示描述与设计思路
- 支持编辑、新建、复制、删除，改动自动保存到浏览器本地
- **数据包导出 / 导入**：卡牌数据与卡图一起打包成单个 `.pcard` 文件，便于整体分发与备份
- **增量导出 / 导入**：只交换修改过的卡牌，冲突时逐条裁决
- **范围图形**：在牌效文本中插入 3×3 示意图，代替文字描述方位

## 文件说明

| 文件 | 说明 |
| --- | --- |
| \`index.html\` | 应用本体（单文件，含全部代码与图片） |
| \`manifest.json\` / \`manifest.js\` | 更新清单（应用内「检查更新」读取；托管时必须与 index.html 同目录） |
| \`assets/data/cards.json\` | 卡牌数据（${cards.length} 张） |
| \`使用说明.md\` | 完整操作手册 |
| \`卡牌库.md\` | 卡牌设计文档 |
| \`设计总结.md\` | 规则与机制总结 |
| \`规则设计-v0.2.md\` | 规则定案版 |
| \`待定数值清单.md\` | 尚未确定的数值项 |
| \`src/\` | 源码（模板 + 逻辑），配合 \`tools/build.mjs\` 可重新构建 |
| \`assets/img/\` | 卡框与卡图源文件 |

## 数据存放位置

使用时的改动保存在**浏览器本地存储**中（不写磁盘）。
要交换或备份数据，请用顶栏的「数据」菜单导出 JSON。

## 重新构建

若修改了 \`src/\` 或 \`assets/data/cards.json\`：

\`\`\`bash
node tools/build.mjs
\`\`\`

需要 Node.js 环境。

## 卡牌数据概况

- 总计 **${cards.length}** 张
- 等级：I ${cards.filter((c) => c.level === 'I').length} · II ${cards.filter((c) => c.level === 'II').length} · III ${cards.filter((c) => c.level === 'III').length} · IV ${cards.filter((c) => c.level === 'IV').length} · 衍生物 ${cards.filter((c) => c.level === '衍生物').length}
- 类型：攻击 ${cards.filter((c) => c.type === '攻击').length} · 防御 ${cards.filter((c) => c.type === '防御').length} · 辅助 ${cards.filter((c) => c.type === '辅助').length} · 衍生物 ${cards.filter((c) => c.type === '衍生物').length}

## 已知限制

- 所有卡牌目前共用同一张卡图（\`potato_temp.png\` 占位图；「普通土豆」用 \`test_potato.png\`）
- 不支持多人实时协作，依靠手动导出/导入同步
- 数据保存在浏览器，清除浏览器数据会丢失（请及时导出备份）

---

打包时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}
数据来源：${path.relative(root, source)}
`;

fs.writeFileSync(path.join(pkgDir, 'README.md'), readme, 'utf8');

// 版本信息
fs.writeFileSync(path.join(pkgDir, 'VERSION.json'), JSON.stringify({
  name: '土豆牌卡牌工作台',
  version: VERSION,
  packagedAt: new Date().toISOString(),
  cardCount: cards.length,
  dataSource: path.relative(root, source)
}, null, 2), 'utf8');

// ---------- 4.5 更新清单 ----------
// manifest.json 供在线 fetch（http/https 页面）；manifest.js 为 JSONP 包装，
// 供本地 file:// 副本用 <script> 标签检查更新（绕开 CORS）。
const manifest = {
  version: VERSION,
  buildTime: new Date().toISOString(),
  notes: getArg('--notes', ''),
  file: `index.html?v=${VERSION}`
};
fs.writeFileSync(path.join(pkgDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
fs.writeFileSync(path.join(pkgDir, 'manifest.js'),
  'window.__potatoManifest&&window.__potatoManifest(' + JSON.stringify(manifest) + ');', 'utf8');
console.log('\n更新清单已生成：manifest.json / manifest.js (v' + VERSION + ')');

// ---------- 5. 统计 ----------
function dirSize(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    total += entry.isDirectory() ? dirSize(p) : fs.statSync(p).size;
  }
  return total;
}
const size = dirSize(pkgDir);

console.log('\n打包完成：');
console.log('  目录: ' + path.relative(root, pkgDir));
console.log('  大小: ' + (size / 1024).toFixed(0) + ' KB');
console.log('  文档: ' + copiedDocs.join(', '));
console.log('\n用浏览器打开：' + path.join(path.relative(root, pkgDir), 'index.html'));
