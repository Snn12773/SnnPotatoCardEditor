#!/usr/bin/env node
/**
 * 一键发版：构建 → 更新清单 → 提交 → 打 tag → 推送
 *
 * 用法：
 *   node tools/release.mjs --ver 0.1.4 --notes "更新检测"
 *   node tools/release.mjs --ver 0.1.4 --notes "..." --no-push     # 只本地提交
 *   node tools/release.mjs --ver 0.1.4 --notes "..." --no-package  # 不生成 dist 分发目录
 *
 * 做的事：
 *   1. 用 POTATO_VER 构建 index.html（版本号注入）
 *   2. 写仓库根目录的 manifest.json / manifest.js（Pages & jsDelivr 的更新源）
 *   3. 生成 dist/ 分发包（package.mjs，含 README 与源文件）
 *   4. git add/commit/tag v<版本>，必要时 push --follow-tags
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const has = (n) => args.includes(n);
const getArg = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

const ver = getArg('--ver', '');
const notes = getArg('--notes', '');
if (!/^\d+\.\d+\.\d+$/.test(ver)) {
  console.error('用法: node tools/release.mjs --ver 0.1.4 --notes "本次更新内容" [--no-push] [--no-package]');
  process.exit(1);
}

const run = (cmd, cmdArgs, opts = {}) => {
  console.log('  $ ' + cmd + ' ' + cmdArgs.join(' '));
  return execFileSync(cmd, cmdArgs, { cwd: root, stdio: 'inherit', env: { ...process.env, ...(opts.env || {}) } });
};

console.log('\n[1/4] 构建 index.html（v' + ver + '，发布版不含卡牌数据）');
run(process.execPath, [path.join(root, 'tools', 'build.mjs'), '--seed', 'none', '--out', 'index.html'],
  { env: { POTATO_VER: ver } });

console.log('\n[2/4] 生成更新清单');
run(process.execPath, [path.join(root, 'tools', 'manifest.mjs'), '--ver', ver, '--notes', notes]);

if (!has('--no-package')) {
  console.log('\n[3/4] 生成分发包 dist/');
  run(process.execPath, [path.join(root, 'tools', 'package.mjs'), '--ver', ver, '--notes', notes]);
} else {
  console.log('\n[3/4] 跳过分发包（--no-package）');
}

// ---------- git ----------
const git = (gitArgs) => execFileSync('git', ['-c', 'core.quotepath=false', ...gitArgs], { cwd: root, stdio: 'inherit' });

const inRepo = (() => {
  try { execFileSync('git', ['rev-parse', '--git-dir'], { cwd: root, stdio: 'ignore' }); return true; }
  catch { return false; }
})();

if (!inRepo) {
  console.log('\n[4/4] 不是 git 仓库，跳过提交（先 git init 并配置 remote）');
  process.exit(0);
}

console.log('\n[4/4] 提交并打 tag');
git(['add', '-A']);
const staged = (() => {
  try { return execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: root, encoding: 'utf8' }).trim(); }
  catch { return ''; }
})();
if (staged) git(['commit', '-m', 'release v' + ver + (notes ? ': ' + notes : '')]);
else console.log('  没有文件变更，跳过提交');

const tag = 'v' + ver;
const tagExists = (() => {
  try { execFileSync('git', ['rev-parse', '-q', '--verify', 'refs/tags/' + tag], { cwd: root, stdio: 'ignore' }); return true; }
  catch { return false; }
})();
if (tagExists) console.log('  tag ' + tag + ' 已存在，跳过');
else git(['tag', '-a', tag, '-m', 'v' + ver + (notes ? ' ' + notes : '')]);

if (has('--no-push')) {
  console.log('\n完成（--no-push）。推送：git push --follow-tags');
} else {
  console.log('\n推送…');
  git(['push', '--follow-tags']);
  console.log('\n完成：v' + ver + ' 已推送。若 Pages 首次启用，请到仓库 Settings → Pages 选择 main 分支根目录。');
}
