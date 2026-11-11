/* ============================================================
   第二部分：导入 / 导出 / 事件绑定 / 启动
   ============================================================ */
(function () {
  'use strict';
  // 与 part1 共享同一个作用域不可行（立即执行），因此通过全局桥接
  var A = window.__POTATO__;
  if (!A) return;

  var $ = A.$, $$ = A.$$, clone = A.clone, esc = A.esc, nowIso = A.nowIso, stamp = A.stamp;
  var toast = A.toast, Store = A.Store, UI = A.UI;
  var renderAll = A.renderAll, current = A.current, selectCard = A.selectCard;
  var frameHTML = A.frameHTML, uid = A.uid, todayStr = A.todayStr, parseTags = A.parseTags;
  var LEVELS = A.LEVELS, TYPES = A.TYPES;
  var APP_VER = A.APP_VER;

  /* ---------- 移动端判定（方案A三视图只在窄屏生效） ---------- */
  var MQ = window.matchMedia ? window.matchMedia('(max-width:980px)') : null;
  function isMobile() { return !!(MQ && MQ.matches); }

  /* ---------- 下载 / 读取文件 ---------- */
  // 手机端兼容的导出：
  //   1) 优先 Web Share API（系统分享面板，可直接分享到微信聊天 / 存到文件）
  //   2) 回退 Blob + a[download] 下载
  //   3) 微信内置浏览器会拦截下载 → 弹提示引导「在浏览器打开」或「复制 JSON」
  function isWeChat() { return /MicroMessenger/i.test(navigator.userAgent); }
  function anchorDownload(filename, blob) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
  }
  function download(filename, text, mime) {
    var type = (mime || 'application/json');
    var blob = new Blob([text], { type: type + ';charset=utf-8' });
    try {
      var file = new File([blob], filename, { type: type });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file], title: filename })
          .catch(function () { anchorDownload(filename, blob); });
        return;
      }
    } catch (e) { /* 忽略，走下载 */ }
    anchorDownload(filename, blob);
    if (isWeChat()) weChatExportHint();
  }
  function weChatExportHint() {
    $('#modal').classList.remove('wide');
    $('#modalBody').innerHTML = '<div class="hintline" style="line-height:1.9;font-size:12px">' +
      '微信内置浏览器通常会拦截文件下载。可以：<br>' +
      '1. 点右上角「···」→「在浏览器打开」，再重新导出；<br>' +
      '2. 或用「复制数据」，把 JSON 粘贴到微信聊天直接发给队友。</div>';
    $('#modalFoot').innerHTML =
      '<button class="btn" id="wxCopy">复制数据</button><span style="flex:1"></span>' +
      '<button class="btn solid" id="wxClose">知道了</button>';
    showModal('微信内导出提示');
    $('#wxCopy').onclick = function () { copyExport(); };
    $('#wxClose').onclick = closeModal;
  }
  function copyExport() {
    var text = JSON.stringify(makePackage());
    copyText(text).then(function (ok) {
      closeModal();
      toast(ok ? '已复制数据包，可粘贴到微信发送' : '复制失败，请改用浏览器导出');
    });
  }
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; })
        .catch(function () { return legacyCopy(text); });
    }
    return Promise.resolve(legacyCopy(text));
  }
  function legacyCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus(); ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { /* 忽略 */ }
    document.body.removeChild(ta);
    return ok;
  }
  function pickFile(accept) {
    return new Promise(function (resolve) {
      var inp = document.createElement('input');
      inp.type = 'file';
      // 移动端（Android/iOS）的系统文件选择器不认识 .pcard 这类自定义扩展名，
      // 会把它过滤成「不可选」甚至不显示；移动端干脆不设 accept，展示全部文件
      var mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
        || navigator.maxTouchPoints > 1;
      if (!mobile) inp.accept = accept || '.json,application/json';
      inp.onchange = function () {
        var f = inp.files && inp.files[0];
        if (!f) { resolve(null); return; }
        var fr = new FileReader();
        fr.onload = function () { resolve({ name: f.name, text: String(fr.result) }); };
        fr.onerror = function () { resolve(null); };
        fr.readAsText(f, 'utf-8');
      };
      inp.click();
    });
  }

  /* ---------- 导出文件夹（File System Access API，桌面 Chromium） ---------- */
  // 网页本身无法直接写磁盘；桌面 Edge/Chrome 支持「选择一次文件夹后记住」（句柄存
  // IndexedDB），之后每次导出静默写进「<所选文件夹>/导出/」。移动端浏览器不支持
  // 选择器，exportToFile 返回 null，调用方回退到 分享 / 下载。
  function idbFs() {
    return new Promise(function (res) {
      try {
        var req = indexedDB.open('potato-fs', 1);
        req.onupgradeneeded = function () { req.result.createObjectStore('fs'); };
        req.onsuccess = function () { res(req.result); };
        req.onerror = function () { res(null); };
      } catch (e) { res(null); }
    });
  }
  function idbGet(key) {
    return idbFs().then(function (db) {
      if (!db) return null;
      return new Promise(function (res) {
        try {
          var tx = db.transaction('fs').objectStore('fs').get(key);
          tx.onsuccess = function () { res(tx.result || null); };
          tx.onerror = function () { res(null); };
        } catch (e) { res(null); }
      });
    });
  }
  function idbSet(key, val) {
    return idbFs().then(function (db) {
      if (!db) return false;
      return new Promise(function (res) {
        try {
          var tx = db.transaction('fs', 'readwrite').objectStore('fs').put(val, key);
          tx.onsuccess = function () { res(true); };
          tx.onerror = function () { res(false); };
        } catch (e) { res(false); }
      });
    });
  }
  var FS_EXPORT = (typeof window.showDirectoryPicker === 'function');
  async function exportToFile(filename, text) {
    if (!FS_EXPORT) return null;                     // 浏览器不支持 → 调用方走分享/下载
    try {
      var dir = await idbGet('exportDir');
      if (dir) {
        try {
          if (await dir.queryPermission({ mode: 'readwrite' }) !== 'granted') {
            if (await dir.requestPermission({ mode: 'readwrite' }) !== 'granted') dir = null;
          }
        } catch (e) { dir = null; }                  // 句柄失效（目录被删/移动）→ 重新选
      }
      if (!dir) dir = await window.showDirectoryPicker({ mode: 'readwrite', id: 'potato-export' });
      await idbSet('exportDir', dir);
      var sub = await dir.getDirectoryHandle('导出', { create: true });
      var fh = await sub.getFileHandle(filename, { create: true });
      var w = await fh.createWritable();
      await w.write(new Blob([text], { type: 'application/json;charset=utf-8' }));
      await w.close();
      return { ok: true, where: (dir.name || '所选文件夹') + '/导出/' + filename };
    } catch (e) {
      if (e && e.name === 'AbortError') return { ok: false, cancel: true };
      return null;                                   // 其它失败 → 回退下载
    }
  }
  function resetExportDir() { return idbSet('exportDir', null); }

  /* ---------- 信封构造 ---------- */
  function makeFullEnvelope() {
    return {
      kind: 'potato-card-editor', format: 'full', version: '1.0',
      exportedAt: nowIso(),
      base: UI && Store.baseRevision ? { revision: Store.baseRevision } : null,
      cards: clone(Store.cards),
      revisions: clone(Store.revisions),
      hashes: Store.cards.reduce(function (m, c) { m[c.id] = A.hashCard(c); return m; }, {})
    };
  }
  function makeDeltaEnvelope(baselineIds) {
    // 收集自基线以来的变更，按 cardId 归并成净变更
    var changed = {};
    Store.revisions.forEach(function (r) {
      if (!r.cardId) return;
      if (baselineIds && baselineIds[r.cardId] && false) return;
      var cur = r.cardId ? Store.find(r.cardId) : null;
      if (!changed[r.cardId]) changed[r.cardId] = { cardId: r.cardId, name: r.cardName };
      if (cur) { changed[r.cardId].card = clone(cur); changed[r.cardId].deleted = false; }
      else { changed[r.cardId].deleted = true; }
    });
    var items = Object.keys(changed).map(function (k) { return changed[k]; });
    return {
      kind: 'potato-card-editor', format: 'delta', version: '1.0',
      exportedAt: nowIso(),
      base: { revision: Store.baseRevision, exportedFrom: Store.baseRevision },
      changedCount: items.length,
      items: items.map(function (it) {
        // baseHash：导出方在本轮修改之前的版本指纹（取时间最早的那条带 before 的记录），
        // 仅作诊断信息；导入方实际使用自己的 Store.baseHashes 做三方判定。
        var revs = Store.revisions.filter(function (r) { return r.cardId === it.cardId && r.before; });
        var earliest = revs.length ? revs[revs.length - 1] : null;
        return {
          cardId: it.cardId,
          name: it.name,
          deleted: !!it.deleted,
          card: it.card || null,
          baseHash: earliest ? A.hashCard(earliest.before) : null
        };
      })
    };
  }

  /* ---------- 数据包（.pcard） ----------
     自包含的 JSON 容器：卡牌数据 + 图片资源 + 预留扩展位。
     · 卡图不再内联在卡片里，导出时抽到顶层 assets（按内容去重），卡片上只留 "asset:a1"
     · 顶层新增内容（卡背、规则页、卡套……）以后直接加新键或塞 extras，formatVersion 递增
     · 程序更新只换 index.html，不碰本地数据；换数据只换数据包 */
  var PKG_KIND = 'potato-card-package';
  var PKG_VERSION = 1;

  function splitDataUrl(u) {
    var m = /^data:([^;,]*)(;base64)?,([\s\S]*)$/.exec(String(u || ''));
    if (!m) return null;
    return { mime: m[1] || 'application/octet-stream', base64: !!m[2], data: m[3] };
  }
  function joinDataUrl(a) {
    if (!a || !a.data) return '';
    return 'data:' + (a.mime || 'application/octet-stream') +
      (a.encoding === 'base64' ? ';base64,' : ',') + a.data;
  }
  // 卡片 → 包内卡片（dataURL 换成 asset:id）
  function packCards(cards) {
    var assets = {}, seen = {}, seq = 0;
    var out = (cards || []).map(function (c) {
      var cc = clone(c);
      var p = splitDataUrl(cc.art);
      if (p) {
        if (!seen[cc.art]) {
          var id = 'a' + (++seq);
          seen[cc.art] = id;
          assets[id] = {
            type: 'card-art', mime: p.mime,
            encoding: p.base64 ? 'base64' : 'utf8', data: p.data
          };
        }
        cc.art = 'asset:' + seen[cc.art];
      }
      return cc;
    });
    return { cards: out, assets: assets };
  }
  // 包内卡片 → 卡片（asset:id 还原成 dataURL）
  function unpackCards(cards, assets) {
    return (cards || []).map(function (raw) {
      var c = clone(raw);
      var m = /^asset:(.+)$/.exec(String((c && c.art) || ''));
      if (m) c.art = joinDataUrl(assets ? assets[m[1]] : null);
      return c;
    });
  }
  // 打包：默认整库；传 opts 可只打包选中的卡牌 / 附带删除清单与范围说明
  function makePackage(opts) {
    opts = opts || {};
    var src = Array.isArray(opts.cards) ? opts.cards : Store.cards;
    var packed = packCards(src);
    var ids = {};
    src.forEach(function (c) { ids[c.id] = 1; });
    // 变更记录只带与所选卡牌相关的部分，避免局部包拖着一整本历史
    var revs = Array.isArray(opts.cards)
      ? Store.revisions.filter(function (r) { return ids[r.cardId]; })
      : Store.revisions;
    var pkg = {
      kind: PKG_KIND,
      formatVersion: PKG_VERSION,
      generator: { name: '土豆牌卡牌工作台', version: APP_VER },
      createdAt: nowIso(),
      data: { cards: packed.cards, revisions: clone(revs) },
      assets: packed.assets,
      extras: {}
    };
    var removed = (opts.removed || []).filter(function (r) { return r && r.id; });
    if (removed.length) pkg.data.removed = clone(removed);   // 导出方删掉的卡（导入方可选择是否同步删除）
    if (opts.scope) pkg.scope = clone(opts.scope);           // 导出范围说明，仅用于导入预览展示
    if (opts.by) pkg.by = String(opts.by).trim().slice(0, 24); // 导出者（必填），导入方写进修改记录
    return pkg;
  }
  function validatePackage(pkg) {
    if (!pkg || typeof pkg !== 'object') return '不是有效的 JSON 对象';
    if (pkg.kind !== PKG_KIND) return '不是卡牌数据包（kind 不匹配）';
    var v = Number(pkg.formatVersion || 0);
    if (!v) return '数据包缺少 formatVersion';
    if (v > PKG_VERSION) return '数据包版本过高（' + v + '），请先更新程序';
    if (!pkg.data || !Array.isArray(pkg.data.cards)) return '数据包缺少 data.cards';
    return null;
  }
  function packageSummary(pkg) {
    var n = pkg && pkg.data && Array.isArray(pkg.data.cards) ? pkg.data.cards.length : 0;
    var imgs = pkg && pkg.assets ? Object.keys(pkg.assets).filter(function (k) {
      return pkg.assets[k] && pkg.assets[k].type === 'card-art';
    }).length : 0;
    return n + ' 张卡牌 · ' + imgs + ' 张图片';
  }

  /* ---------- 导出 ---------- */
  function exportFull() {
    var pkg = makePackage();
    download('土豆牌_数据包_' + stamp() + '.pcard', JSON.stringify(pkg, null, 2));
    toast('已导出数据包：' + packageSummary(pkg));
  }
  function exportDelta() {
    var env = makeDeltaEnvelope();
    if (!env.items.length) { toast('没有可导出的变更'); return; }
    download('土豆牌_增量_' + stamp() + '.json', JSON.stringify(env, null, 2));
    toast('已增量导出 ' + env.items.length + ' 项变更');
  }
  function exportCsv() {
    var head = ['id', 'name', 'sub', 'level', 'type', 'atk', 'hp', 'price', 'extra', 'growth', 'tags', 'by', 'upd', 'text', 'idea'];
    function q(v) {
      var s = String(v == null ? '' : v).replace(/"/g, '""');
      return '"' + s + '"';
    }
    var rows = [head.join(',')];
    Store.cards.forEach(function (c) {
      rows.push([c.id, c.name, c.sub || '', c.level, c.type, c.atk, c.hp, c.price, c.extra, c.growth,
        (c.tags || []).join('|'), c.by || 'SnN', c.upd, c.text, c.idea].map(q).join(','));
    });
    download('土豆牌_卡表_' + stamp() + '.csv', '\ufeff' + rows.join('\r\n'), 'text/csv');
    toast('已导出 CSV');
  }

  /* ---------- 导入校验 ---------- */
  function validateEnvelope(env, expectFormat) {
    if (!env || typeof env !== 'object') return '文件不是有效的 JSON 对象';
    if (env.kind !== 'potato-card-editor') return '不是土豆牌卡牌文件（kind 不匹配）';
    if (!env.version) return '缺少版本号';
    if (expectFormat && env.format !== expectFormat) return '文件类型不符：需要 ' + expectFormat + '，实际 ' + env.format;
    if (env.format === 'full' && !Array.isArray(env.cards)) return '全量文件缺少 cards 数组';
    if (env.format === 'delta' && !Array.isArray(env.items)) return '增量文件缺少 items 数组';
    return null;
  }
  function normalizeCard(raw) {
    var c = {
      id: raw.id || uid('card'),
      name: String(raw.name || '未命名').slice(0, 48),
      atk: raw.atk == null ? '0' : String(raw.atk),
      hp: raw.hp == null ? '1' : String(raw.hp),
      price: raw.price == null ? '0' : String(raw.price),
      extra: raw.extra == null ? '' : String(raw.extra),
      level: LEVELS.indexOf(raw.level) >= 0 ? raw.level : 'I',
      type: TYPES.indexOf(raw.type) >= 0 ? raw.type : '攻击',
      growth: Number.isFinite(+raw.growth) ? +raw.growth : 1,
      art: raw.art || 'potato',
      text: raw.text == null ? '' : String(raw.text),
      idea: raw.idea == null ? '' : String(raw.idea),
      tags: Array.isArray(raw.tags) ? raw.tags.map(String) : parseTags(raw.tags),
      sub: raw.sub == null ? '' : String(raw.sub).slice(0, 40),
      // 提交者：旧文件没有该字段（曾经的 src 是「出处」），统一回落到 SnN
      by: (String(raw.by == null ? '' : raw.by).trim().slice(0, 24)) || 'SnN',
      ver: raw.ver || 'v0.1',
      upd: raw.upd || todayStr()
    };
    return c;
  }

  /* ---------- 全量替换（数据包 / 旧版全量 JSON 共用） ---------- */
  function applyCards(cards, revisions, baseRev) {
    Store.cards = cards.map(normalizeCard);
    Store.revisions = Array.isArray(revisions) ? revisions : [];
    Store.baseRevision = baseRev || nowIso();
    Store.rebuildBaseHashes();   // 全量导入 = 新基线
    Store.persist();
    UI.sel = Store.cards[0] ? Store.cards[0].id : null;
    UI.mode = 'view'; UI.dirty = false; UI.snap = null;
    renderAll();
  }
  function backupBeforeImport() {
    download('土豆牌_自动备份_' + stamp() + '.pcard', JSON.stringify(makePackage(), null, 2));
  }

  function importPackageObj(pkg) {
    var err = validatePackage(pkg);
    if (err) { toast(err); return false; }
    if (!pkg.data.cards.length) { toast('数据包里没有卡牌'); return false; }
    if (!confirm('导入数据包将替换当前的 ' + Store.cards.length + ' 张卡牌。\n会先自动备份当前数据，继续？')) return false;
    backupBeforeImport();
    var cards = unpackCards(pkg.data.cards, pkg.assets);
    var images = Object.keys(pkg.assets || {}).length;
    setTimeout(function () {
      applyCards(cards, pkg.data.revisions, pkg.createdAt);
      toast('已导入 ' + Store.cards.length + ' 张卡牌 · ' + images + ' 张图片');
    }, 250);
    return true;
  }

  function handleFullEnvelope(env) {
    var err = validateEnvelope(env, 'full');
    if (err) { toast(err); return; }
    if (!confirm('全量导入将替换当前的 ' + Store.cards.length + ' 张卡牌。\n是否先自动备份当前数据？\n\n确定后即执行导入。')) return;
    backupBeforeImport();
    setTimeout(function () {
      applyCards(env.cards, env.revisions, env.exportedAt || nowIso());
      toast('已导入 ' + Store.cards.length + ' 张卡牌');
    }, 250);
  }
  // 统一入口：先过「导入预览」（勾选要导入的部分），确认后才落库
  function importAny(obj, fromText) {
    if (!obj || typeof obj !== 'object') { toast('内容不是有效的 JSON 对象'); return false; }
    var X = window.__POTATO_XFER__;
    if (X && X.showPreview) return X.showPreview(fromText || '导入内容', obj);
    // 兜底（第三部分缺失时）：旧的全量替换
    if (obj.kind === PKG_KIND) return importPackageObj(obj);
    if (obj.kind === 'potato-card-editor' && obj.format === 'full') { handleFullEnvelope(obj); return true; }
    toast('无法识别的文件类型（既不是数据包也不是旧版导出）');
    return false;
  }
  function importFull() {
    pickFile('.pcard,.json,application/json').then(function (file) {
      if (!file) return;
      var obj;
      try { obj = JSON.parse(file.text); } catch (e) { toast('文件解析失败（不是合法 JSON）'); return; }
      importAny(obj, file.name);
    });
  }

  /* ---------- 增量导入（带冲突解决） ---------- */
  // 核心：把增量信封与当前数据做三方合并。返回 { auto, conflicts }
  // auto 已就地应用；conflicts 交由调用方解决。
  function applyDelta(env) {
    var auto = [], conflicts = [];
    env.items.forEach(function (it) {
      var local = it.cardId ? Store.find(it.cardId) : null;
      if (it.deleted) {
        if (local) {
          var di = Store.indexOf(it.cardId);
          Store.log('import', it.cardId, local.name, clone(local), null);
          Store.cards.splice(di, 1);
          auto.push({ type: 'delete', cardId: it.cardId, name: local.name });
        }
        return;
      }
      var theirs = normalizeCard(it.card || {});
      if (!local) {
        if (Store.indexOf(theirs.id) < 0) {
          Store.cards.push(theirs);
          Store.log('import', theirs.id, theirs.name, null, clone(theirs));
          auto.push({ type: 'add', cardId: theirs.id, name: theirs.name });
        }
        return;
      }
      if (A.hashCard(local) === A.hashCard(theirs)) return; // 双方一致，无需处理
      conflicts.push({ cardId: it.cardId, name: theirs.name, local: clone(local), theirs: theirs });
    });
    return { auto: auto, conflicts: conflicts };
  }

  // 直接应用增量：三方比对
  //   base   = 导入方上次同步时的基线指纹（Store.baseHashes）
  //   local  = 导入方当前卡片
  //   theirs = 导出方给出的新卡片
  // 规则：local 未偏离 base → 可直接采用 theirs；否则视为冲突
  function applyDeltaAuto(env) {
    var applied = [], conflicts = [];
    var base = Store.baseHashes || {};
    env.items.forEach(function (it) {
      var local = it.cardId ? Store.find(it.cardId) : null;
      if (it.deleted) {
        if (local) {
          var di = Store.indexOf(it.cardId);
          Store.log('import', it.cardId, local.name, clone(local), null);
          Store.cards.splice(di, 1);
          delete base[it.cardId];
          applied.push({ type: 'delete', cardId: it.cardId });
        }
        return;
      }
      var theirs = normalizeCard(it.card || {});
      if (!local) {
        if (Store.indexOf(theirs.id) < 0) {
          Store.cards.push(theirs);
          Store.log('import', theirs.id, theirs.name, null, clone(theirs));
          base[theirs.id] = A.hashCard(theirs);
          applied.push({ type: 'add', cardId: theirs.id });
        }
        return;
      }
      var localHash = A.hashCard(local);
      var theirsHash = A.hashCard(theirs);
      if (localHash === theirsHash) {
        base[it.cardId] = theirsHash;   // 双方一致，刷新基线
        return;
      }
      // 本地未改过（仍等于基线）→ 自动采用远端
      var baseHash = base[it.cardId];
      if (baseHash && localHash === baseHash) {
        var idx = Store.indexOf(it.cardId);
        var before = clone(Store.cards[idx]);
        Store.cards[idx] = theirs;
        Store.log('import', it.cardId, theirs.name, before, clone(theirs));
        base[it.cardId] = theirsHash;
        applied.push({ type: 'update', cardId: it.cardId });
        return;
      }
      // 本地也改过 → 冲突
      conflicts.push({ cardId: it.cardId, name: theirs.name, local: clone(local), theirs: theirs });
    });
    Store.baseHashes = base;
    return { applied: applied, conflicts: conflicts };
  }

  // 解决冲突：choices = { cardId: 'local' | 'theirs' }
  function resolveConflicts(conflicts, choices) {
    var taken = 0;
    conflicts.forEach(function (cf) {
      if (choices[cf.cardId] !== 'theirs') return;
      var idx = Store.indexOf(cf.cardId);
      if (idx < 0) return;
      var before = clone(Store.cards[idx]);
      Store.cards[idx] = clone(cf.theirs);
      Store.log('import', cf.cardId, cf.theirs.name, before, clone(cf.theirs));
      taken++;
    });
    return taken;
  }

  function handleDeltaEnvelope(env) {
    if (!env.items.length) { toast('该增量文件没有变更'); return; }
    var res = applyDeltaAuto(env);
    if (!res.conflicts.length) {
      Store.persist();
      renderAll();
      toast('增量导入完成：应用 ' + res.applied.length + ' 项');
      return;
    }
    openConflictModal(res.conflicts, res.applied.length);
  }
  function importDelta() {
    pickFile().then(function (file) {
      if (!file) return;
      var env;
      try { env = JSON.parse(file.text); } catch (e) { toast('JSON 解析失败'); return; }
      var err = validateEnvelope(env, 'delta');
      if (err) { toast(err); return; }
      handleDeltaEnvelope(env);
    });
  }

  /* ---------- 微信协作：复制 / 粘贴导入 ---------- */
  function pasteImport() {
    // 优先直接读剪贴板；失败则弹粘贴框
    if (navigator.clipboard && navigator.clipboard.readText) {
      navigator.clipboard.readText().then(function (t) {
        if (t && t.trim()) tryPasteImport(t);
        else pasteModal('');
      }).catch(function () { pasteModal(''); });
      return;
    }
    pasteModal('');
  }
  function pasteModal(prefill) {
    $('#modal').classList.remove('wide');
    $('#modalBody').innerHTML = '<div class="hintline" style="margin-bottom:8px">粘贴队友发来的数据包 / 增量 JSON 文本：</div>' +
      '<textarea class="fx" id="pasteTa" rows="8" style="min-height:150px" placeholder="粘贴 JSON 文本"></textarea>';
    $('#modalFoot').innerHTML =
      '<button class="btn" id="piCancel">取消</button>' +
      '<button class="btn solid" id="piOk">导入</button>';
    showModal('从剪贴板导入');
    $('#piCancel').onclick = closeModal;
    $('#piOk').onclick = function () {
      var t = $('#pasteTa').value.trim();
      if (!t) { toast('内容为空'); return; }
      tryPasteImport(t);
    };
    setTimeout(function () { var ta = $('#pasteTa'); if (ta) ta.focus(); }, 60);
  }
  function tryPasteImport(t) {
    var obj;
    try { obj = JSON.parse(t); } catch (e) { toast('JSON 解析失败'); return; }
    if (!obj || typeof obj !== 'object') { toast('内容不是有效的 JSON 对象'); return; }
    closeModal();
    importAny(obj, '剪贴板');
  }

  /* ---------- 冲突弹窗 ---------- */
  var pendingConflicts = null;
  function openConflictModal(conflicts, autoCount) {
    pendingConflicts = conflicts;
    var modal = $('#modal');
    modal.classList.add('wide');
    var title = '增量导入 · 冲突解决（' + conflicts.length + '）';
    var body = '<div class="hintline" style="margin-bottom:10px">' +
      '已自动应用 ' + autoCount + ' 项无冲突变更。以下卡牌本地与远端都被修改，请逐项选择。' +
      '<br>默认保留本地；选「采用远端」将用对方版本覆盖本地。</div>';
    conflicts.forEach(function (cf, i) {
      body += '<div class="conflict"><div class="ch">' + esc(cf.name) + '</div><div class="cb">' +
        '<div class="side">本地：' + esc(shortCard(cf.local)) + '</div>' +
        '<div class="side theirs">远端：' + esc(shortCard(cf.theirs)) + '</div>' +
        '<label><input type="radio" name="cf' + i + '" value="local" checked> 保留本地</label>' +
        '<label><input type="radio" name="cf' + i + '" value="theirs"> 采用远端</label>' +
        '</div></div>';
    });
    $('#modalBody').innerHTML = body;
    $('#modalFoot').innerHTML =
      '<button class="btn" id="cfAllLocal">全部保留本地</button>' +
      '<button class="btn" id="cfAllTheirs">全部采用远端</button>' +
      '<span style="flex:1"></span>' +
      '<button class="btn" id="cfCancel">取消</button>' +
      '<button class="btn solid" id="cfApply">应用勾选</button>';
    showModal(title);

    $('#cfAllLocal').onclick = function () { setAll('local'); };
    $('#cfAllTheirs').onclick = function () { setAll('theirs'); };
    $('#cfCancel').onclick = function () { closeModal(); pendingConflicts = null; };
    $('#cfApply').onclick = applyConflicts;
  }
  function shortCard(c) {
    return (c.name || '') + ' [' + c.atk + '|' + c.hp + '|' + c.price + '] ' + c.level + '/' + c.type;
  }
  function setAll(v) {
    $$('input[type=radio]').forEach(function (r) { r.checked = (r.value === v); });
  }
  function applyConflicts() {
    var conflicts = pendingConflicts || [];
    var choices = {};
    conflicts.forEach(function (cf, i) {
      var sel = document.querySelector('input[name="cf' + i + '"]:checked');
      choices[cf.cardId] = (sel && sel.value === 'theirs') ? 'theirs' : 'local';
    });
    var takeTheirs = resolveConflicts(conflicts, choices);
    Store.persist();
    closeModal();
    renderAll();
    toast('冲突已解决：采用远端 ' + takeTheirs + ' 项');
    pendingConflicts = null;
  }

  /* ---------- 导入 / 导出工作台（第三部分优先，缺失则回落旧行为） ---------- */
  function withXfer(fn, fallback) {
    var X = window.__POTATO_XFER__;
    if (X && typeof X[fn] === 'function') X[fn]();
    else fallback();
  }

  /* ---------- 弹窗控制（复用 part1 的实现，保持单一来源）---------- */
  var showModal = A.openModalBound;
  var closeModal = A.closeModalBound;
  function setFooter(html) { $('#modalFoot').innerHTML = html; }

  /* ---------- 恢复首批数据 ---------- */
  function resetSeed() {
    if (!confirm('将恢复到设计稿的首批 21 张卡牌，并清除全部变更记录。继续？')) return;
    download('土豆牌_当前备份_' + stamp() + '.json', JSON.stringify(makeFullEnvelope(), null, 2));
    setTimeout(function () {
      Store.resetToSeed();
      Store.persist();
      UI.sel = Store.cards[0] ? Store.cards[0].id : null;
      UI.mode = 'view'; UI.dirty = false; UI.snap = null;
      renderAll();
      toast('已恢复首批数据');
    }, 250);
  }

  /* ---------- 自动更新检查（多源并行探测） ---------- */
  var UPD_SRC_KEY = 'potato.upd.sources';
  var UPD_TIMEOUT = 4000;
  // 默认更新源（随构建一起发布，必须保持长期稳定）：
  //   ① GitHub Pages —— 主源，同域直接 fetch manifest.json
  //   ② jsDelivr    —— 备用源，按分支取（不能用 tag，否则每个版本都要改这里）
  //   ③ Gitee 仓库   —— 国内镜像。Gitee Pages 已于 2024 年下线，raw 又缺 CORS 且带
  //                    nosniff（连 script 标签都拒），只剩 API v5 一条路：它带
  //                    Access-Control-Allow-Origin: *，返回 base64 文件内容。
  //                    该源只用于「发现新版」，点更新仍跳到 Pages 实际运行。
  //                    地址写成仓库根即可：https://gitee.com/<owner>/<repo>[#分支]
  // 用户在「数据 → 更新源设置」里填的地址会覆盖此列表（存 localStorage）。
  var UPD_REPO = 'Snn12773/SnnPotatoCardEditor';
  var DEFAULT_SOURCES = [
    'https://snn12773.github.io/SnnPotatoCardEditor/',
    'https://cdn.jsdelivr.net/gh/' + UPD_REPO + '@main/',
    'https://gitee.com/snn12772/SnnPotatoCardEditor'
  ];
  function getSources() {
    try {
      var raw = localStorage.getItem(UPD_SRC_KEY);
      if (raw) {
        var arr = JSON.parse(raw);
        if (Array.isArray(arr)) return arr.map(function (s) { return String(s).trim(); }).filter(Boolean);
      }
    } catch (e) { /* 损坏的配置当作未设置 */ }
    return DEFAULT_SOURCES.slice();
  }
  function setSources(list) {
    localStorage.setItem(UPD_SRC_KEY, JSON.stringify((list || []).filter(Boolean)));
  }
  function joinUrl(base, file) {
    return String(base).replace(/\/+$/, '') + '/' + String(file || 'index.html').replace(/^\/+/, '');
  }
  // 语义化版本比较：1.2.10 > 1.2.9；非法段按 0 处理
  function cmpVer(a, b) {
    var pa = String(a || '0').split('.');
    var pb = String(b || '0').split('.');
    for (var i = 0; i < 3; i++) {
      var x = parseInt(pa[i], 10) || 0;
      var y = parseInt(pb[i], 10) || 0;
      if (x !== y) return x > y ? 1 : -1;
    }
    return 0;
  }
  // 单源探测（方案二选一，失败自动回退）：
  //   http(s) → 先 fetch manifest.json（要求对方带 CORS 头）
  //            拿不到就回退 JSONP 加载 manifest.js（script 标签不受 CORS 限制）
  //   file://  → 直接 JSONP（本地页面的 fetch 常被跨域策略挡掉）
  // JSONP 用固定回调名 window.__potatoManifest，所以必须串行，不能并发。
  var jsonpLock = Promise.resolve();
  function probeJsonp(base, timeout) {
    var run = function () {
      return new Promise(function (resolve) {
        var done = false;
        var s = document.createElement('script');
        var timer = setTimeout(function () { finish(false); }, timeout);
        function finish(ok, data) {
          if (done) return;
          done = true;
          clearTimeout(timer);
          if (s.parentNode) s.parentNode.removeChild(s);
          try { delete window.__potatoManifest; } catch (e) { window.__potatoManifest = undefined; }
          resolve(ok && data && data.version ? { src: base, manifest: data } : null);
        }
        window.__potatoManifest = function (m) { finish(true, m); };
        s.src = base + 'manifest.js?t=' + Date.now();
        s.onerror = function () { finish(false); };
        document.head.appendChild(s);
      });
    };
    var p = jsonpLock.then(run, run);
    jsonpLock = p.then(function () {}, function () {});
    return p;
  }
  function probeFetch(base, timeout) {
    return new Promise(function (resolve) {
      var ctl = typeof AbortController === 'function' ? new AbortController() : null;
      var timer = setTimeout(function () { if (ctl) ctl.abort(); }, timeout);
      fetch(base + 'manifest.json', { cache: 'no-store', signal: ctl ? ctl.signal : undefined })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (m) { clearTimeout(timer); resolve(m && m.version ? { src: base, manifest: m } : null); })
        .catch(function () { clearTimeout(timer); resolve(null); });
    });
  }
  // Gitee 仓库地址 → 走 API v5 读 manifest.json（唯一带 CORS 的官方通道）
  var GITEE_RE = /^https?:\/\/(?:www\.)?gitee\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i;
  function parseGitee(src) {
    var s = String(src || '').trim();
    var ref = 'main';
    var at = s.indexOf('#');
    if (at >= 0) { ref = s.slice(at + 1).trim() || 'main'; s = s.slice(0, at); }
    var m = s.match(GITEE_RE);
    if (!m) return null;
    return { owner: m[1], repo: m[2], ref: ref };
  }
  // Gitee 返回的 content 是 base64，且可能含中文（notes 字段）→ 必须按 UTF-8 解码
  function b64utf8(b64) {
    if (typeof atob !== 'function') return '';
    var bin = atob(String(b64).replace(/\s+/g, ''));
    var i, bytes = new Uint8Array(bin.length);
    for (i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    if (typeof TextDecoder === 'function') return new TextDecoder('utf-8').decode(bytes);
    return decodeURIComponent(escape(bin));
  }
  function probeGitee(src, timeout) {
    var g = parseGitee(src);
    var api = 'https://gitee.com/api/v5/repos/' + g.owner + '/' + g.repo +
      '/contents/manifest.json?ref=' + encodeURIComponent(g.ref);
    return new Promise(function (resolve) {
      var ctl = typeof AbortController === 'function' ? new AbortController() : null;
      var timer = setTimeout(function () { if (ctl) ctl.abort(); }, timeout);
      fetch(api, { cache: 'no-store', signal: ctl ? ctl.signal : undefined })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          clearTimeout(timer);
          var m = null;
          if (j && j.content) { try { m = JSON.parse(b64utf8(j.content)); } catch (e) { m = null; } }
          // Gitee 只能读到文件、不能当页面跑 → 附带 open（实际打开地址）
          resolve(m && m.version
            ? { src: String(src).trim(), open: DEFAULT_SOURCES[0], manifest: m }
            : null);
        })
        .catch(function () { clearTimeout(timer); resolve(null); });
    });
  }
  function probeSource(src, timeout) {
    timeout = timeout || UPD_TIMEOUT;
    if (parseGitee(src)) return probeGitee(src, timeout);
    // 规范化为目录（末尾必带 /）；不要走 joinUrl——空文件名会命中默认值 index.html
    var base = String(src).replace(/\/+$/, '') + '/';
    if (location.protocol === 'file:') return probeJsonp(base, timeout);
    return probeFetch(base, timeout).then(function (r) {
      // 无 CORS 头（内网静态服务器常见）→ 退回 JSONP
      return r || probeJsonp(base, timeout);
    });
  }
  // 并行探测所有源（JSONP 内部已串行）；file:// 下没有 fetch 可用，整段走串行 JSONP
  function probeAll(sources, timeout) {
    return Promise.all(sources.map(function (src) {
      return probeSource(src, timeout).then(function (r) { return r; }, function () { return null; });
    })).then(function (out) { return out.filter(Boolean); });
  }
  // manual=true 时无论结果如何都给出反馈；否则只在发现新版时提示
  function checkUpdates(manual, probeAllFn) {
    var sources = getSources();
    if (!sources.length) {
      if (manual) toast('未配置更新源：请到 数据菜单 →「更新源设置」填入地址');
      return Promise.resolve(null);
    }
    var run = probeAllFn || probeAll;
    return run(sources, UPD_TIMEOUT).then(function (found) {
      found = (found || []).filter(Boolean);
      if (!found.length) {
        if (manual) toast('所有更新源均不可达（共 ' + sources.length + ' 个源）');
        return null;
      }
      // 多源结果取版本号最高的一份，并记住它的源
      var best = found[0];
      for (var i = 1; i < found.length; i++) {
        if (cmpVer(found[i].manifest.version, best.manifest.version) > 0) best = found[i];
      }
      var m = best.manifest;
      if (cmpVer(m.version, APP_VER) > 0) {
        var btn = $('#btnUpdate');
        if (btn) {
          btn.removeAttribute('hidden');
          btn.setAttribute('data-file', m.file || 'index.html');
          // Gitee 源只能读文件、不能当页面跑 → 用它的 open（Pages 地址）做跳转目标
          btn.setAttribute('data-src', best.open || best.src);
          btn.title = '发现新版本 v' + m.version + '（来源：' + best.src + '）';
        }
        toast('发现新版本 v' + m.version + (m.notes ? '：' + m.notes : ''));
        return { version: m.version, src: best.src };
      }
      if (manual) toast('已是最新版本 v' + APP_VER);
      return { version: APP_VER, upToDate: true };
    }).catch(function () {
      if (manual) toast('更新检查失败');
      return null;
    });
  }
  function applyUpdate(btn) {
    var src = btn && btn.getAttribute('data-src');
    if (!src) return;
    var url = joinUrl(src, btn.getAttribute('data-file') || 'index.html');
    if (location.protocol === 'file:') {
      // 网页无法改写本地文件。手机端连「写文件」的手段都没有（update.bat 是 Windows 脚本，
      // 手机上跑不了），只能改用在线版；这里给一条把数据带走的出路：导出整库数据包。
      var mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || navigator.maxTouchPoints > 1;
      $('#modal').classList.remove('wide');
      $('#modalBody').innerHTML = '<div class="hintline" style="line-height:1.9">' +
        (mobile
          ? '本地副本无法自动更新：<b>手机浏览器不允许网页改写本地文件</b>，这是系统安全限制，' +
            '和 update.bat 无关（那是 Windows 脚本，手机上无法运行）。<br>' +
            '正确做法是改用下面的<b>在线版</b>——它每次打开都是最新，收藏即可。' +
            '想保留现在的卡牌：先点「导出整库数据包」，打开在线版后再导入这份文件。'
          : '本地副本无法自动更新文件（浏览器不允许网页改磁盘）。<br>' +
            '两种办法：① 直接打开下方在线版，它每次都是最新；② 在程序目录里双击 <b>update.bat</b>，自动替换本地 index.html。') +
        '</div>' +
        '<div class="upd-linkrow"><input id="updUrl" readonly value="' + esc(url) + '">' +
        '<button class="btn" id="updCopy">复制</button></div>';
      $('#modalFoot').innerHTML =
        '<button class="btn" id="uCancel">取消</button>' +
        '<button class="btn" id="uExport">导出整库数据包</button>' +
        '<button class="btn solid" id="uGo">打开在线最新版</button>';
      showModal('获取更新');
      $('#uGo').onclick = function () { closeModal(); window.open(url, '_blank'); };
      $('#uCancel').onclick = closeModal;
      $('#updCopy').onclick = function () {
        copyText(url).then(function (ok) { toast(ok ? '已复制在线版链接' : '复制失败，请长按链接手动复制'); });
      };
      $('#uExport').onclick = function () {
        var by = '';
        try { by = localStorage.getItem('potato.exporter') || ''; } catch (e) { /* 隐私模式 */ }
        var pkg = makePackage({ by: by });
        var name = '土豆牌_数据包_' + stamp() + '.pcard';
        var text = JSON.stringify(pkg, null, 2);
        closeModal();
        exportToFile(name, text).then(function (r) {
          if (r && r.cancel) return;
          if (!(r && r.ok)) download(name, text);
          toast('已导出整库数据包，打开在线版后导入它即可');
        });
      };
    } else {
      location.href = url;
    }
  }
  function updateSettingsModal() {
    $('#modal').classList.remove('wide');
    $('#modalBody').innerHTML =
      '<div class="hintline" style="margin-bottom:8px">更新检查地址（每行一个）：目录级地址（GitHub Pages / 自建静态目录）填到文件夹即可；Gitee 仓库直接填仓库根（如 https://gitee.com/用户名/仓库名，可用 #分支 指定）。检查时并行探测所有源，取版本号最高的为准：</div>' +
      '<textarea class="fx" id="updTa" rows="5" style="min-height:110px" placeholder="https://example.com/path-to-workbench/"></textarea>' +
      '<div class="hintline" style="margin-top:8px">当前版本 <b>v' + esc(APP_VER) + '</b>' +
      (location.protocol === 'file:' ? ' · 本地副本用 JSONP 检查，建议改用在线链接' : '') + '</div>';
    $('#modalFoot').innerHTML =
      '<button class="btn" id="usCheck">立即检查</button><span style="flex:1"></span>' +
      '<button class="btn" id="usReset">恢复默认</button>' +
      '<button class="btn" id="usCancel">取消</button>' +
      '<button class="btn solid" id="usSave">保存</button>';
    showModal('更新源设置');
    $('#updTa').value = getSources().join('\n');
    $('#usCancel').onclick = closeModal;
    $('#usReset').onclick = function () {
      try { localStorage.removeItem(UPD_SRC_KEY); } catch (e) { /* 忽略 */ }
      closeModal();
      toast('已恢复默认更新源（' + DEFAULT_SOURCES.length + ' 个）');
    };
    $('#usSave').onclick = function () {
      var list = $('#updTa').value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
      setSources(list);
      closeModal();
      toast(list.length ? '已保存 ' + list.length + ' 个更新源' : '已清空更新源');
    };
    $('#usCheck').onclick = function () {
      setSources($('#updTa').value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean));
      closeModal();
      toast('正在检查更新…');
      checkUpdates(true);
    };
  }

  /* ---------- 事件绑定 ---------- */
  /* ---------- 主题（黑夜模式） ---------- */
  var THEME_KEY = 'potato.theme';
  function themeNow() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }
  function syncThemeBtn() {
    var b = $('#btnTheme');
    if (!b) return;
    var dark = themeNow() === 'dark';
    b.innerHTML = '<span class="ic ' + (dark ? 'ic-sun' : 'ic-moon') + '"></span><span class="lb"> ' + (dark ? '白天' : '黑夜') + '</span>';
    b.setAttribute('aria-pressed', dark ? 'true' : 'false');
    b.setAttribute('title', dark ? '切换到白天模式' : '切换到黑夜模式');
    var m = $('#metaTheme');
    if (m) m.setAttribute('content', dark ? '#1b2128' : '#eceade');
  }
  function applyTheme(t, persist) {
    var next = t === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    if (persist) { try { localStorage.setItem(THEME_KEY, next); } catch (e) {} }
    syncThemeBtn();
    return next;
  }
  function toggleTheme() {
    return applyTheme(themeNow() === 'dark' ? 'light' : 'dark', true);
  }
  // 未手动选择过时，跟随系统实时切换
  function watchSystemTheme() {
    if (!window.matchMedia) return;
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    var onSys = function () {
      var saved = null;
      try { saved = localStorage.getItem(THEME_KEY); } catch (e) {}
      if (saved !== 'dark' && saved !== 'light') applyTheme(mq.matches ? 'dark' : 'light', false);
    };
    if (mq.addEventListener) mq.addEventListener('change', onSys);
    else if (mq.addListener) mq.addListener(onSys);
  }

  function bind() {
    // 顶栏模式
    $('#tabView').onclick = function () { A.leaveEdit(); };
    $('#tabEdit').onclick = function () { A.enterEdit(); };
    // 视图切换
    $('#viewSeg').onclick = function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      UI.view = b.getAttribute('data-view');
      renderAll();
    };
    // 数据菜单
    $('#menuBtn').onclick = function (e) {
      e.stopPropagation();
      $('#menuPop').classList.toggle('show');
    };
    $('#menuPop').onclick = function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      var act = b.getAttribute('data-act');
      $('#menuPop').classList.remove('show');
      if (act === 'exportFull') withXfer('openExport', exportFull);
      else if (act === 'exportDelta') exportDelta();
      else if (act === 'copyJson') copyExport();
      else if (act === 'importFull') withXfer('openImport', importFull);
      else if (act === 'importDelta') importDelta();
      else if (act === 'pasteImport') pasteImport();
      else if (act === 'resetSeed') resetSeed();
      else if (act === 'exportCsv') exportCsv();
      else if (act === 'checkUpdate') { toast('正在检查更新…'); checkUpdates(true); }
      else if (act === 'updSettings') updateSettingsModal();
    };
    document.addEventListener('click', function () { $('#menuPop').classList.remove('show'); });
    // 空卡库里的「导入数据包」入口
    document.addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('[data-empty-act="import"]') : null;
      if (b) { e.preventDefault(); importFull(); }
    });
    // 发布版不含种子数据，隐藏「恢复首批数据」（本地开发构建里保留）
    if (!(window.__SEED__ && window.__SEED__.cards && window.__SEED__.cards.length)) {
      var rs = $('#menuPop button[data-act="resetSeed"]');
      if (rs) rs.hidden = true;
    }
    // 新建
    $('#btnNew').onclick = function () { A.newCard(); };
    // 黑夜 / 白天切换
    $('#btnTheme').onclick = function () { toggleTheme(); };
    // 更新提示按钮（发现新版本时顶栏出现）
    $('#btnUpdate').onclick = function () { applyUpdate(this); };
    $('#btnDup').onclick = function () { A.dupCard(); };
    $('#btnDel').onclick = function () { A.delCard(); };
    // 搜索
    $('#search').oninput = function (e) { UI.q = e.target.value; A.renderSiblings(); };
    // chips
    $('#lvChips').onclick = function (e) {
      var b = e.target.closest('button'); if (!b) return;
      UI.lv = b.getAttribute('data-lv'); renderAll();
    };
    $('#typeChips').onclick = function (e) {
      var b = e.target.closest('button'); if (!b) return;
      UI.type = b.getAttribute('data-type'); renderAll();
    };
    // 排序：字段下拉 + 独立的升 / 降序按钮
    $('#sortSel').onchange = function (e) {
      UI.sort = e.target.value;
      // 切换字段时给一个直觉默认：最近更新默认新→旧，其余默认正序
      UI.sortDir = UI.sort === 'upd' ? 'desc' : 'asc';
      syncSortBtn();
      A.renderSiblings();
    };
    $('#btnSortDir').onclick = function () {
      UI.sortDir = UI.sortDir === 'asc' ? 'desc' : 'asc';
      syncSortBtn();
      A.renderSiblings();
    };
    // 清除筛选
    $('#btnClear').onclick = function () {
      UI.q = ''; UI.lv = 'all'; UI.type = 'all'; $('#search').value = '';
      renderAll();
    };
    // 列表 / 网格 / 表格点击（移动端：点卡即跳详情视图）
    function onClickCard(e) {
      var el = e.target.closest('[data-id]');
      if (!el) return;
      selectCard(el.getAttribute('data-id'), { mview: isMobile() ? 'ins' : null });
    }
    $('#clist').onclick = onClickCard;
    $('#centerBody').onclick = onClickCard;
    // 移动端底部视图切换栏（方案A）
    $('#mTabs').onclick = function (e) {
      var b = e.target.closest('button'); if (!b) return;
      UI.mview = b.getAttribute('data-mv');
      renderAll();
    };
    $('#mRevert').onclick = function () { A.revertCard(); };
    $('#mSave').onclick = function () { A.saveCard(); };
    // 检视器返回按钮（仅移动端显示）
    $('#btnBack').onclick = function () { UI.mview = 'grid'; renderAll(); };
    // 右栏页签
    $('#insTabs').onclick = function (e) {
      var b = e.target.closest('button'); if (!b) return;
      UI.tab = b.getAttribute('data-tab'); renderAll();
    };
    // 右栏底部按钮（事件委托，因会重建）
    $('#insFoot').onclick = function (e) {
      var id = e.target.id;
      if (id === 'btnEdit') A.enterEdit();
      else if (id === 'btnView') A.leaveEdit();
      else if (id === 'btnSave') A.saveCard();
      else if (id === 'btnRevert') A.revertCard();
    };
    // 表单输入（input 事件，不重绘右栏）
    $('#insBody').oninput = function (e) {
      if (e.target && e.target.getAttribute && e.target.getAttribute('data-f')) A.onFieldInput(e.target);
    };
    // select 变更后需要重绘右栏（下拉重建不会失焦）
    $('#insBody').onchange = function (e) {
      if (e.target && e.target.tagName === 'SELECT' && e.target.getAttribute('data-f')) {
        A.onFieldInput(e.target);
        renderAll();
        toast('类型/等级已修改，记得保存');
      }
    };
    // 「＋ 范围」按钮与富文本工具栏（工具栏按钮在编辑器重建后依然有效：事件委托）
    $('#insBody').onclick = function (e) {
      // 编辑态点卡面卡图 → 换图（先判断，避免被「必须是按钮」的条件挡掉）
      var fr = e.target.closest ? e.target.closest('.pv .frame.can-upload') : null;
      if (fr) { e.preventDefault(); A.pickArt(); return; }
      var b = e.target.closest ? e.target.closest('button') : null;
      if (!b) return;
      var cmd = b.getAttribute('data-cmd');
      if (cmd) {
        e.preventDefault();
        A.setRichField(b.getAttribute('data-rt-for'));
        if (cmd === 'range') A.openRangePicker(function (mask) { A.insertRangeMark(mask); });
        else A.applyRichCmd(cmd, b.getAttribute('data-color'));
        return;
      }
      if (b.id === 'btnArtUp') { e.preventDefault(); A.pickArt(); return; }
      if (b.id === 'btnArtReset') { e.preventDefault(); A.resetArt(); return; }
    };
    // 富文本编辑：记录最近聚焦的编辑器，输入时序列化回卡片字段
    $('#insBody').onfocusin = function (e) {
      if (e.target && e.target.getAttribute && e.target.getAttribute('data-rt')) {
        A.setRichField(e.target.getAttribute('data-rt'));
      }
    };
    $('#insBody').addEventListener('input', function (e) {
      var t = e.target;
      if (t && t.getAttribute && t.getAttribute('data-rt')) A.onRichInput(t);
    });
    // 卡图文件选择
    var artFile = $('#artFile');
    if (artFile) artFile.onchange = function (e) {
      var f = e.target.files && e.target.files[0];
      if (f) A.loadArt(f);
    };
    // 弹窗关闭
    $('#modalClose').onclick = closeModal;
    $('#overlay').onclick = function (e) { if (e.target === $('#overlay')) closeModal(); };

    // 快捷键
    document.addEventListener('keydown', function (e) {
      var t = e.target;
      var inField = t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
      if (e.key === '/' && !inField) {
        e.preventDefault(); $('#search').focus(); return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        if (UI.mode === 'edit' && UI.dirty) A.saveCard();
        else toast('没有需要保存的修改');
        return;
      }
      if (e.key === 'Escape') { closeModal(); return; }
      if (e.key === 'Enter' && !inField && UI.mode === 'view') {
        A.enterEdit();
      }
    });
  }

  /* ---------- 启动 ---------- */
  // 排序方向按钮：图标 + title 跟随 UI.sortDir
  function syncSortBtn() {
    var ic = $('#sortDirIc'), b = $('#btnSortDir');
    if (ic) ic.className = 'ic ' + (UI.sortDir === 'desc' ? 'ic-desc' : 'ic-asc');
    if (b) b.setAttribute('title', UI.sortDir === 'desc' ? '当前：降序，点击切为升序' : '当前：升序，点击切为降序');
    var sel = $('#sortSel');
    // linkedom（单测环境）的 select.value 只有 getter，这里容错
    if (sel) { try { sel.value = UI.sort; } catch (e) {} }
  }

  function boot() {
    // 品牌图标
    var bi = $('#brandIco');
    if (bi) bi.src = window.__IMG__['test_potato'];
    Store.load();
    UI.sel = Store.cards[0] ? Store.cards[0].id : null;
    Store.persist();
    bind();
    renderAll();
    // 菜单里的版本号
    var mv = $('#menuVer');
    if (mv) mv.textContent = 'v' + APP_VER;
    // 同步主题按钮（首屏主题已由 head 内联脚本应用）
    syncThemeBtn();
    syncSortBtn();
    watchSystemTheme();
    // 启动 2.5 秒后静默检查更新；无源或网络不可达都不打扰
    setTimeout(function () { checkUpdates(false); }, 2500);
  }

  // 暴露给测试与 part1 使用
  window.__POTATO_IO__ = {
    exportFull: exportFull, exportDelta: exportDelta,
    importFull: importFull, importDelta: importDelta,
    makeFullEnvelope: makeFullEnvelope, makeDeltaEnvelope: makeDeltaEnvelope,
    applyDelta: applyDelta, applyDeltaAuto: applyDeltaAuto,
    resolveConflicts: resolveConflicts,
    normalizeCard: normalizeCard, validateEnvelope: validateEnvelope,
    // 数据包
    PKG_KIND: PKG_KIND, PKG_VERSION: PKG_VERSION,
    makePackage: makePackage, packCards: packCards, unpackCards: unpackCards,
    validatePackage: validatePackage, packageSummary: packageSummary,
    importPackageObj: importPackageObj, importAny: importAny, applyCards: applyCards,
    // 导出 / 导入工作台（part3）所需的基础能力
    download: download, pickFile: pickFile, backupBeforeImport: backupBeforeImport,
    copyText: copyText, splitDataUrl: splitDataUrl, joinDataUrl: joinDataUrl,
    exportToFile: exportToFile, resetExportDir: resetExportDir, FS_EXPORT: FS_EXPORT
  };
  // 更新检查模块（测试可传入自定义 probeAllFn 模拟源）
  window.__POTATO_UPD__ = {
    checkUpdates: checkUpdates, applyUpdate: applyUpdate,
    getSources: getSources, setSources: setSources,
    cmpVer: cmpVer, joinUrl: joinUrl, probeSource: probeSource, probeAll: probeAll,
    parseGitee: parseGitee, b64utf8: b64utf8
  };
  // 主题模块
  window.__POTATO_THEME__ = {
    get: themeNow, set: applyTheme, toggle: toggleTheme, KEY: THEME_KEY
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
