/* ============================================================
   第三部分：导出 / 导入工作台
   —— 导出：选范围（默认「自上次导入以来的变更」）+ 勾选 + 预览
   —— 导入：预览待导入内容、区分「新增 / 修改 / 冲突 / 删除」
             并逐项勾选要导入的部分
   ============================================================ */
(function () {
  'use strict';
  var A = window.__POTATO__, IO = window.__POTATO_IO__;
  if (!A || !IO) return;

  var $ = A.$, $$ = A.$$, esc = A.esc, clone = A.clone;
  var Store = A.Store, UI = A.UI, toast = A.toast, hashCard = A.hashCard;
  var renderAll = A.renderAll;

  /* ---------- 字段与徽标 ---------- */
  var FIELDS = ['name', 'sub', 'atk', 'hp', 'price', 'extra', 'level', 'type', 'growth',
    'text', 'idea', 'tags', 'by', 'ver', 'upd', 'art'];
  var LABELS = {
    name: '名称', sub: '注脚', atk: '攻击', hp: '生命', price: '价格', extra: '追加',
    level: '等级', type: '类型', growth: '成长', text: '文本', idea: '设计思路',
    tags: '标签', by: '提交者', ver: '版本', upd: '更新日期', art: '卡图'
  };
  var KL = { add: '新增', mod: '修改', conflict: '冲突', same: '一致', remove: '删除' };
  var KORDER = { add: 0, mod: 1, conflict: 2, remove: 3, same: 4 };

  /* ---------- 值展示 ---------- */
  function tval(c, k) {
    if (k === 'tags') return (Array.isArray(c.tags) ? c.tags : []).join('\u0001');
    return String(c[k] == null ? '' : c[k]);
  }
  function clip(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n) + '…' : s; }
  function plainHTML(s) {
    return String(s == null ? '' : s)
      .replace(/\[\[r:[01]{9}\]\]/g, '〔范围〕')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  }
  function showVal(k, v) {
    if (k === 'art') return v && v !== 'potato' ? '自定义图' : '内置图';
    if (k === 'text' || k === 'idea') return clip(plainHTML(v), 30) || '（空）';
    if (k === 'tags') {
      var arr = Array.isArray(v) ? v : String(v || '').split('\u0001');
      return arr.filter(Boolean).join('、') || '（空）';
    }
    var s = String(v == null ? '' : v);
    return clip(s, 18) || '（空）';
  }
  function diffOf(a, b) {
    var out = [];
    FIELDS.forEach(function (k) {
      if (tval(a, k) === tval(b, k)) return;
      out.push({ k: k, label: LABELS[k] || k, before: showVal(k, a[k]), after: showVal(k, b[k]) });
    });
    return out;
  }
  function diffHTML(list) {
    if (!list || !list.length) return '';
    return list.map(function (d) {
      return '<span class="xf-df">' + esc(d.label) +
        '<i>' + esc(d.before) + '</i>→' + esc(d.after) + '</span>';
    }).join('');
  }
  // 从变更记录里还原「哪些字段变了」（用于导出预览；before 取最早、after 取最新）
  function revDiffs(cardId, since) {
    var map = {}, order = [];
    var revs = Store.revisions.filter(function (r) { return r.cardId === cardId && r.delta; });
    // ISO 只到秒，同一秒内的操作也要算进来，故用 >=
    if (since) revs = revs.filter(function (r) { return String(r.ts) >= String(since); });
    revs.slice().reverse().forEach(function (r) {
      Object.keys(r.delta || {}).forEach(function (k) {
        var d = r.delta[k] || {};
        if (!map[k]) {
          map[k] = { k: k, label: LABELS[k] || k, before: showVal(k, d.before), after: showVal(k, d.after) };
          order.push(k);
        } else {
          map[k].after = showVal(k, d.after);
        }
      });
    });
    return order.map(function (k) { return map[k]; });
  }
  function changedFields(cardId) {
    var d = revDiffs(cardId, Store.baseRevision);
    if (!d.length && Store.baseRevision) d = revDiffs(cardId, null);
    return d;
  }
  function fmtTime(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(iso || ''));
    return m ? m[1] + '-' + m[2] + '-' + m[3] + ' ' + m[4] + ':' + m[5] : String(iso || '');
  }
  // 新增卡没有「差异」，给一行摘要，方便判断要不要收
  function brief(c) {
    if (!c) return '';
    return '攻击 ' + (c.atk || '-') + ' · 生命 ' + (c.hp || '-') + ' · 价格 ' + (c.price || '-') +
      (c.text ? ' · ' + clip(plainHTML(c.text), 22) : '');
  }
  function kb(n) { return n < 1024 ? n + ' B' : (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB'; }

  /* ---------- 公共：筛选条 / 行 ---------- */
  function counts(rows) {
    var c = { all: rows.length };
    rows.forEach(function (r) { c[r.kind] = (c[r.kind] || 0) + 1; });
    return c;
  }
  function filterBar(st, rows) {
    var c = counts(rows);
    var chips = [['all', '全部', c.all]];
    ['add', 'mod', 'conflict', 'remove', 'same'].forEach(function (k) {
      if (c[k]) chips.push([k, KL[k], c[k]]);
    });
    return '<div class="xf-filters">' + chips.map(function (it) {
      return '<button type="button" class="xf-chip' + (st.filter === it[0] ? ' on' : '') +
        '" data-filter="' + it[0] + '">' + it[1] + '<b>' + it[2] + '</b></button>';
    }).join('') + '</div>';
  }
  function visible(st, rows) {
    if (st.filter === 'all') return rows;
    return rows.filter(function (r) { return r.kind === st.filter; });
  }
  function sortRows(rows) {
    return rows.slice().sort(function (a, b) {
      var d = (KORDER[a.kind] || 0) - (KORDER[b.kind] || 0);
      if (d) return d;
      return String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hans-CN');
    });
  }
  function rowHTML(id, name, level, type, kind, diff, dis, note) {
    var d = diffHTML(diff);
    if (!d && note) d = '<span class="xf-brief">' + esc(note) + '</span>';
    return '<label class="xf-row xf-' + kind + (dis ? ' dis' : '') + '">' +
      '<input type="checkbox" data-id="' + esc(id) + '">' +
      '<span class="xf-nm" title="' + esc(name || '') + '">' + esc(name || '未命名') + '</span>' +
      (level ? '<span class="xf-meta">' + esc(level) + (type ? ' · ' + esc(type) : '') + '</span>' : '') +
      '<span class="xf-bd bd-' + kind + '">' + KL[kind] + '</span>' +
      (d ? '<span class="xf-diff">' + d + '</span>' : '') +
      '</label>';
  }

  /* ============================================================
     一、导出
     ============================================================ */
  var exp = null;

  function openExport() {
    exp = { mode: 'changes', filter: 'all', sel: {}, by: '' };
    try { exp.by = localStorage.getItem('potato.exporter') || ''; } catch (e) { /* 隐私模式 */ }
    exp.rows = buildExportRows();
    resetSel(exp);
    drawExport();
  }

  function buildExportRows() {
    var base = Store.baseHashes || {};
    var rows = Store.cards.map(function (c) {
      var kind = base[c.id] === undefined ? 'add'
        : (base[c.id] === hashCard(c) ? 'same' : 'mod');
      return {
        id: c.id, name: c.name, level: c.level, type: c.type, kind: kind, card: c,
        diff: kind === 'mod' ? changedFields(c.id) : []
      };
    });
    // 本地删掉的卡：基线里有、当前没有，且有删除记录 → 作为「删除」项一并导出
    var alive = {};
    Store.cards.forEach(function (c) { alive[c.id] = 1; });
    var gone = {};
    Store.revisions.forEach(function (r) {
      if (r.action !== 'delete' || !r.cardId || alive[r.cardId] || !base[r.cardId]) return;
      if (Store.baseRevision && String(r.ts) < String(Store.baseRevision)) return;
      if (!gone[r.cardId]) gone[r.cardId] = { id: r.cardId, name: r.cardName || r.cardId, kind: 'remove', diff: [] };
    });
    Object.keys(gone).forEach(function (k) { rows.push(gone[k]); });
    return sortRows(rows);
  }

  function resetSel(st) {
    st.sel = {};
    st.rows.forEach(function (r) {
      if (st.mode === 'all') st.sel[r.id] = true;
      else if (st.mode === 'changes') st.sel[r.id] = (r.kind !== 'same');
      else st.sel[r.id] = false;
    });
  }

  function selCards(st) {
    var ids = {};
    st.rows.forEach(function (r) { if (r.kind !== 'remove' && st.sel[r.id]) ids[r.id] = 1; });
    return Store.cards.filter(function (c) { return ids[c.id]; });
  }
  function selRemoved(st) {
    return st.rows.filter(function (r) { return r.kind === 'remove' && st.sel[r.id]; })
      .map(function (r) { return { id: r.id, name: r.name }; });
  }
  function buildPkg(st) {
    var cards = selCards(st), removed = selRemoved(st);
    if (!cards.length && !removed.length) return null;
    return IO.makePackage({
      cards: cards,
      removed: removed,
      by: String(st.by || '').trim(),
      scope: { mode: st.mode, baseline: Store.baseRevision, cards: cards.length, removed: removed.length }
    });
  }
  function exportStat(st) {
    var cards = selCards(st).length, rm = selRemoved(st).length;
    var byKind = {};
    st.rows.forEach(function (r) { if (st.sel[r.id]) byKind[r.kind] = (byKind[r.kind] || 0) + 1; });
    var parts = [];
    if (byKind.add) parts.push('新增 ' + byKind.add);
    if (byKind.mod) parts.push('修改 ' + byKind.mod);
    if (byKind.same) parts.push('未变 ' + byKind.same);
    if (rm) parts.push('删除 ' + rm);
    var pkg = buildPkg(st);
    var size = pkg ? kb(JSON.stringify(pkg).length) : '—';
    return '已选 <b>' + (cards + rm) + '</b> 项' +
      (parts.length ? '（' + parts.join(' · ') + '）' : '') + ' · 约 ' + size;
  }

  function drawExport() {
    var st = exp, rows = st.rows, vis = visible(st, rows);
    var scopes = [['changes', '仅变更'], ['all', '全部卡牌'], ['pick', '手动挑选']];
    var body =
      '<div class="xf-note">导出为数据包（.pcard）。默认只打包<b>上次导入之后</b>新增 / 修改的内容；' +
      '也可切到「全部卡牌」或「手动挑选」。差异按「字段 <i>旧值</i> → 新值」显示。</div>' +
      '<div class="xf-byrow"><label>提交者<i>必填</i></label>' +
      '<input id="xfBy" maxlength="24" placeholder="你的名字，随数据包写入队友的修改记录"></div>' +
      '<div class="xf-scope">' + scopes.map(function (s) {
        return '<button type="button" data-mode="' + s[0] + '"' +
          (st.mode === s[0] ? ' class="on"' : '') + '>' + s[1] + '</button>';
      }).join('') + '</div>' +
      filterBar(st, rows) +
      '<div class="xf-bar">' +
      '<label class="xf-all"><input type="checkbox" id="xfAll"> 全选</label>' +
      '<span class="xf-cnt" id="xfCnt">' + exportStat(st) + '</span>' +
      '</div>' +
      '<div class="xf-list" id="xfList">' +
      (vis.length ? vis.map(function (r) {
        return rowHTML(r.id, r.name, r.level, r.type, r.kind, r.diff, false,
          r.kind === 'add' ? brief(r.card) : '');
      }).join('') : '<div class="xf-empty">' + (!Store.cards.length
        ? '卡库为空，没有可导出的内容。<br>先用「导入数据包」把团队的卡库装进来。'
        : st.mode === 'changes'
          ? '自上次导入以来没有变更。<br>可切到「全部卡牌」导出整库。'
          : '没有符合条件的卡牌') + '</div>') +
      '</div>';
    $('#modal').classList.add('wide');
    $('#modalBody').innerHTML = body;
    $('#modalFoot').innerHTML =
      '<button class="btn" id="xfCancel">取消</button>' +
      (IO.FS_EXPORT ? '<button class="btn" id="xfDir" title="清除记住的导出文件夹，下次导出时重新选择">更换文件夹</button>' : '') +
      '<button class="btn solid" id="xfOk">导出数据包</button>';
    A.openModalBound('导出数据包 · 预览');
    var byInp = $('#xfBy');
    if (byInp) {
      byInp.value = st.by || '';
      byInp.oninput = function () { st.by = byInp.value; syncExpRows(); };
    }
    syncExpRows();
    bindExport();
  }

  // 把 st.sel 同步到 DOM 勾选框（不重建列表，避免滚动位置丢失）
  function syncExpRows() {
    var st = exp;
    $$('#xfList input[type=checkbox]').forEach(function (cb) {
      cb.checked = !!st.sel[cb.getAttribute('data-id')];
    });
    var vis = visible(st, st.rows);
    var all = $('#xfAll');
    if (all) {
      all.checked = vis.length > 0 && vis.every(function (r) { return st.sel[r.id]; });
      all.indeterminate = !all.checked && vis.some(function (r) { return st.sel[r.id]; });
    }
    var cnt = $('#xfCnt');
    if (cnt) cnt.innerHTML = exportStat(st);
    var ok = $('#xfOk');
    if (ok) ok.disabled = !buildPkg(st) || !String(st.by || '').trim();
  }

  function bindExport() {
    var st = exp;
    var sc = $('#modalBody .xf-scope');
    if (sc) sc.onclick = function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      st.mode = b.getAttribute('data-mode');
      st.filter = 'all';
      resetSel(st);
      drawExport();
    };
    var fb = $('#modalBody .xf-filters');
    if (fb) fb.onclick = function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      st.filter = b.getAttribute('data-filter');
      drawExport();
    };
    var all = $('#xfAll');
    if (all) all.onchange = function () {
      var on = all.checked;
      visible(st, st.rows).forEach(function (r) { st.sel[r.id] = on; });
      syncExpRows();
    };
    var list = $('#xfList');
    if (list) list.onchange = function (e) {
      var cb = e.target;
      if (!cb || cb.type !== 'checkbox') return;
      st.sel[cb.getAttribute('data-id')] = cb.checked;
      syncExpRows();
    };
    var ok = $('#xfOk');
    if (ok) ok.onclick = doExport;
    var dirBtn = $('#xfDir');
    if (dirBtn) dirBtn.onclick = function () {
      IO.resetExportDir().then(function () { toast('已清除导出文件夹，下次导出时重新选择'); });
    };
    var cancel = $('#xfCancel');
    if (cancel) cancel.onclick = function () { A.closeModalBound(); exp = null; };
  }

  function doExport() {
    var st = exp;
    var by = String(st.by || '').trim();
    if (!by) { toast('请先填写提交者名字'); var bi = $('#xfBy'); if (bi) bi.focus(); return; }
    try { localStorage.setItem('potato.exporter', by); } catch (e) { /* 隐私模式 */ }
    var pkg = buildPkg(st);
    if (!pkg) { toast('没有勾选任何内容'); return; }
    var name = '土豆牌_数据包_' + A.stamp() + '.pcard';
    var text = JSON.stringify(pkg, null, 2);
    var n = pkg.data.cards.length;
    var rm = (pkg.data.removed || []).length;
    // 桌面 Chromium：写进所选文件夹下的「导出」子文件夹；其余环境回退 分享/下载
    IO.exportToFile(name, text).then(function (r) {
      if (r && r.ok) {
        A.closeModalBound();
        exp = null;
        toast('已导出到「' + r.where + '」');
        return;
      }
      if (r && r.cancel) { toast('已取消，未导出'); return; }  // 弹窗保持打开，可重试
      A.closeModalBound();
      exp = null;
      IO.download(name, text);   // 微信内会弹出「复制数据」提示，须在关掉预览后再弹
      toast('已导出 ' + n + ' 张卡牌' + (rm ? ' · ' + rm + ' 项删除' : ''));
    });
  }

  /* ============================================================
     二、导入
     ============================================================ */
  var imp = null;

  function openImport() {
    IO.pickFile('.pcard,.json,application/json').then(function (file) {
      if (!file) return;
      var obj;
      try { obj = JSON.parse(file.text); } catch (e) { toast('文件解析失败（不是合法 JSON）'); return; }
      showPreview(file.name, obj);
    });
  }

  // 解析文件 → 生成待导入清单（不落库）
  function buildPlan(sourceName, obj) {
    var cards = [], removed = [], meta = { source: sourceName, kind: '', gen: '', created: '', scope: null, exporter: '' };
    if (obj.kind === IO.PKG_KIND) {
      var err = IO.validatePackage(obj);
      if (err) { toast(err); return null; }
      cards = IO.unpackCards(obj.data.cards, obj.assets);
      removed = (obj.data.removed || []).map(function (r) {
        return { id: r && r.id, name: (r && r.name) || (r && r.id) };
      });
      meta.kind = '数据包';
      meta.gen = obj.generator && obj.generator.version ? 'v' + obj.generator.version : '';
      meta.created = obj.createdAt || '';
      meta.scope = obj.scope || null;
      meta.exporter = String(obj.by || '').trim().slice(0, 24);   // 导出者姓名，写进本机修改记录
    } else if (obj.kind === 'potato-card-editor' && obj.format === 'full') {
      var e2 = IO.validateEnvelope(obj, 'full');
      if (e2) { toast(e2); return null; }
      cards = obj.cards || [];
      meta.kind = '旧版全量';
      meta.created = obj.exportedAt || '';
    } else if (obj.kind === 'potato-card-editor' && obj.format === 'delta') {
      var e3 = IO.validateEnvelope(obj, 'delta');
      if (e3) { toast(e3); return null; }
      (obj.items || []).forEach(function (it) {
        if (it.deleted) removed.push({ id: it.cardId, name: it.name || it.cardId });
        else if (it.card) cards.push(it.card);
      });
      meta.kind = '旧版增量';
    } else {
      toast('无法识别的文件类型（既不是数据包也不是旧版导出）');
      return null;
    }

    var base = Store.baseHashes || {};
    var entries = [];
    cards.forEach(function (raw) {
      var theirs = IO.normalizeCard(raw);
      var local = Store.find(theirs.id);
      var kind, diff = [];
      if (!local) kind = 'add';
      else if (hashCard(local) === hashCard(theirs)) kind = 'same';
      else {
        var bh = base[local.id];
        // 本地未偏离基线 → 可直接覆盖；否则视为冲突
        kind = (bh !== undefined && bh === hashCard(local)) ? 'mod' : 'conflict';
        diff = diffOf(local, theirs);
      }
      entries.push({
        id: theirs.id, name: theirs.name, level: theirs.level, type: theirs.type,
        card: theirs, local: local, kind: kind, diff: diff,
        checked: kind !== 'conflict'
      });
    });
    removed.forEach(function (r) {
      if (!r.id) return;
      var local = Store.find(r.id);
      if (!local) return;                     // 本地本来就没有，删除项无意义
      entries.push({
        id: r.id, name: local.name || r.name, kind: 'remove',
        card: null, local: local, diff: [], checked: false
      });
    });
    if (!entries.length) { toast('文件里没有可导入的卡牌'); return null; }
    return { meta: meta, entries: sortRows(entries) };
  }

  function showPreview(sourceName, obj) {
    var plan = buildPlan(sourceName, obj);
    if (!plan) return false;
    imp = { plan: plan, filter: 'all', replaceAll: false };
    drawImport();
    return true;
  }

  function impCounts() {
    var c = {};
    imp.plan.entries.forEach(function (e) { c[e.kind] = (c[e.kind] || 0) + 1; });
    return c;
  }
  function pickedCount() {
    return imp.plan.entries.filter(function (e) { return e.checked && e.kind !== 'same'; }).length;
  }
  function localOnly() {
    var ids = {};
    imp.plan.entries.forEach(function (e) { if (e.kind !== 'remove') ids[e.id] = 1; });
    return Store.cards.filter(function (c) { return !ids[c.id]; }).length;
  }
  function scopeText(s) {
    if (!s) return '';
    var m = { changes: '自上次导入以来的变更', all: '全部卡牌', pick: '手动挑选' };
    var t = m[s.mode] || s.mode || '';
    if (s.cards != null) t += ' · ' + s.cards + ' 张';
    if (s.removed) t += ' · 删除 ' + s.removed + ' 项';
    return t;
  }

  function drawImport() {
    var p = imp, plan = p.plan, meta = plan.meta;
    var c = impCounts();
    var vis = visible(p, plan.entries);
    var eff = (c.add || 0) + (c.mod || 0) + (c.conflict || 0);
    var head = '<div class="xf-note">来源 <b>' + esc(meta.source) + '</b>' +
      (meta.kind ? ' · ' + esc(meta.kind) : '') +
      (meta.gen ? ' · 生成 ' + esc(meta.gen) : '') +
      (meta.exporter ? ' · 提交者 <b>' + esc(meta.exporter) + '</b>' : '') +
      (meta.created ? ' · ' + esc(fmtTime(meta.created)) : '') +
      (meta.scope ? '<br>导出范围：' + esc(scopeText(meta.scope)) : '') +
      '<br>本地现有 <b>' + Store.cards.length + '</b> 张，本包带来 <b>' + eff + '</b> 张改动' +
      '（新增 ' + (c.add || 0) + ' · 修改 ' + (c.mod || 0) + ' · 冲突 ' + (c.conflict || 0) +
      (c.same ? ' · 一致 ' + c.same : '') + (c.remove ? ' · 删除 ' + c.remove : '') + '）。' +
      '<br>差异按「字段 <i>本地值</i> → 包内值」显示；冲突项默认不勾选。</div>';

    // 本地没有「包外卡牌」时，整库替换没有意义，直接不显示
    var extra = localOnly();
    var opt = extra ? '<label class="xf-opt"><input type="checkbox" id="xfReplace"' +
      (p.replaceAll ? ' checked' : '') + '> 整库替换（删除本地未包含的 ' + extra + ' 张卡牌）</label>' : '';

    var body = head + filterBar(p, plan.entries) + opt +
      '<div class="xf-bar"><label class="xf-all"><input type="checkbox" id="xfAll"> ' +
      (p.filter === 'all' ? '全部勾选' : '勾选本类') + '</label>' +
      '<span class="xf-cnt" id="xfCnt">' + impStat() + '</span></div>' +
      '<div class="xf-list" id="xfList">' +
      (vis.length ? vis.map(function (e) {
        return rowHTML(e.id, e.name, e.kind === 'remove' ? '' : e.level,
          e.kind === 'remove' ? '删除' : e.type, e.kind, e.diff, false,
          e.kind === 'add' ? brief(e.card) : (e.kind === 'remove' ? '本地：' + brief(e.local) : ''));
      }).join('') : '<div class="xf-empty">没有符合条件的条目</div>') +
      '</div>';

    $('#modal').classList.add('wide');
    $('#modalBody').innerHTML = body;
    $('#modalFoot').innerHTML =
      '<button class="btn" id="imCancel">取消</button>' +
      '<button class="btn solid" id="imOk">导入选中</button>';
    A.openModalBound('导入数据包 · 预览');
    syncImpRows();
    bindImport();
  }

  function impStat() {
    var n = pickedCount();
    var ck = {}, un = 0;
    imp.plan.entries.forEach(function (e) {
      if (e.kind === 'same') return;
      if (e.checked) ck[e.kind] = (ck[e.kind] || 0) + 1;
      else un++;
    });
    var parts = [];
    if (ck.add) parts.push('新增 ' + ck.add);
    if (ck.mod) parts.push('修改 ' + ck.mod);
    if (ck.conflict) parts.push('冲突 ' + ck.conflict);
    if (ck.remove) parts.push('删除 ' + ck.remove);
    return '已选 <b>' + n + '</b> 项' +
      (parts.length ? '（' + parts.join(' · ') + '）' : '') +
      (un ? ' · 未选 ' + un + ' 项' : '');
  }

  function syncImpRows() {
    var p = imp;
    $$('#xfList input[type=checkbox]').forEach(function (cb) {
      var e = byId(cb.getAttribute('data-id'));
      cb.checked = !!(e && e.checked);
    });
    var vis = visible(p, p.plan.entries);
    var all = $('#xfAll');
    if (all) {
      all.checked = vis.length > 0 && vis.every(function (e) { return e.checked; });
      all.indeterminate = !all.checked && vis.some(function (e) { return e.checked; });
    }
    var cnt = $('#xfCnt');
    if (cnt) cnt.innerHTML = impStat();
    var ok = $('#imOk');
    if (ok) ok.disabled = pickedCount() === 0 && !p.replaceAll;
  }

  function byId(id) {
    for (var i = 0; i < imp.plan.entries.length; i++) {
      if (imp.plan.entries[i].id === id) return imp.plan.entries[i];
    }
    return null;
  }

  function bindImport() {
    var p = imp;
    var fb = $('#modalBody .xf-filters');
    if (fb) fb.onclick = function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      p.filter = b.getAttribute('data-filter');
      drawImport();
    };
    var rp = $('#xfReplace');
    if (rp) rp.onchange = function () { p.replaceAll = rp.checked; syncImpRows(); };
    var all = $('#xfAll');
    if (all) all.onchange = function () {
      var on = all.checked;
      visible(p, p.plan.entries).forEach(function (e) { e.checked = on; });
      syncImpRows();
    };
    var list = $('#xfList');
    if (list) list.onchange = function (e) {
      var cb = e.target;
      if (!cb || cb.type !== 'checkbox') return;
      var en = byId(cb.getAttribute('data-id'));
      if (en) en.checked = cb.checked;
      syncImpRows();
    };
    var ok = $('#imOk');
    if (ok) ok.onclick = doImport;
    var cancel = $('#imCancel');
    if (cancel) cancel.onclick = function () { A.closeModalBound(); imp = null; };
  }

  function doImport() {
    var p = imp;
    var picked = p.plan.entries.filter(function (e) { return e.checked; });
    var real = picked.filter(function (e) { return e.kind !== 'same'; });
    if (!real.length && !p.replaceAll) { toast('没有勾选任何要导入的内容'); return; }
    var extra = localOnly();
    if (p.replaceAll && extra && !confirm('整库替换将删除本地未被包含的 ' + extra + ' 张卡牌。\n导入前会自动备份当前数据，继续？')) return;

    IO.backupBeforeImport();     // 先备份当前数据（.pcard）

    // 数据包的提交者（导出者）→ 写进每条导入记录，卡面的 by 保持最初的创建者不动
    var who = p.plan.meta.exporter || '';
    var add = 0, upd = 0, del = 0;
    picked.forEach(function (e) {
      if (e.kind === 'same') { Store.baseHashes[e.id] = hashCard(e.card); return; }
      if (e.kind === 'remove') {
        var i0 = Store.indexOf(e.id);
        if (i0 >= 0) {
          Store.log('import', e.id, Store.cards[i0].name, clone(Store.cards[i0]), null, who);
          Store.cards.splice(i0, 1);
          del++;
        }
        delete Store.baseHashes[e.id];
        return;
      }
      var idx = Store.indexOf(e.id);
      if (e.kind === 'add') {
        if (idx < 0) {
          Store.cards.push(e.card);
          Store.log('import', e.id, e.card.name, null, clone(e.card), who);
          add++;
        }
      } else {
        if (idx >= 0) {
          var before = clone(Store.cards[idx]);
          Store.cards[idx] = e.card;
          Store.log('import', e.id, e.card.name, before, clone(e.card), who);
          upd++;
        }
      }
      Store.baseHashes[e.id] = hashCard(e.card);
    });

    if (p.replaceAll) {
      var keep = {};
      p.plan.entries.forEach(function (e) { if (e.kind !== 'remove') keep[e.id] = 1; });
      Store.cards.slice().forEach(function (c) {
        if (keep[c.id]) return;
        Store.log('import', c.id, c.name, clone(c), null, who);
        var i = Store.indexOf(c.id);
        if (i >= 0) Store.cards.splice(i, 1);
        delete Store.baseHashes[c.id];
        del++;
      });
    }

    Store.baseRevision = A.nowIso();
    Store.persist();
    if (!Store.find(UI.sel)) UI.sel = Store.cards[0] ? Store.cards[0].id : null;
    UI.mode = 'view'; UI.dirty = false; UI.snap = null;
    A.closeModalBound();
    imp = null;
    renderAll();
    toast('导入完成：新增 ' + add + ' · 更新 ' + upd + ' · 删除 ' + del);
  }

  /* ---------- 对外 ---------- */
  window.__POTATO_XFER__ = {
    openExport: openExport,
    openImport: openImport,
    showPreview: showPreview,
    buildPlan: buildPlan,
    buildExportRows: buildExportRows,
    buildPkg: buildPkg,
    diffOf: diffOf
  };
})();
