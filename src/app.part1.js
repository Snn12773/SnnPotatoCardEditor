/* ============================================================
   土豆牌 · 卡牌工作台 —— 应用逻辑
   ============================================================ */
(function () {
  'use strict';

  /* ---------- 常量 ---------- */
  // 等级：I / II / III / IV 为普通卡；「衍生物」为特殊等级，
  // 使用简化卡框 derivative（卡面只显示名称、卡图与三个数值）。
  var DERIV = '衍生物';
  var LEVELS = ['I', 'II', 'III', 'IV', DERIV];
  var TYPES = ['攻击', '防御', '辅助', '衍生物'];
  var LEVEL_ART = { I: 'front_I', II: 'front_II', III: 'front_III', IV: 'front_IV', '衍生物': 'derivative' };
  var LEVEL_DOT = { I: '#7d8a96', II: '#2f6fb5', III: '#7b45c9', IV: '#a3741a', '衍生物': '#8fa9bb' };
  var STORE_KEY = 'potato-cards-v1';
  var FIELDS = ['name', 'sub', 'atk', 'hp', 'price', 'extra', 'level', 'type', 'growth', 'text', 'idea', 'tags', 'by', 'ver', 'upd', 'art'];
  // 应用版本号：构建时由 build.mjs 注入（package.mjs 传 POTATO_VER），直接构建为 dev
  var APP_VER = window.__POTATO_VER__ || 'dev';

  /* ---------- 工具 ---------- */
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function todayStr() {
    var d = new Date(), p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function stamp() {
    var d = new Date(), p = function (n) { return String(n).padStart(2, '0'); };
    return '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes());
  }
  function nowIso() {
    var d = new Date(), pad = function (n) { return String(Math.floor(Math.abs(n))).padStart(2, '0'); };
    var tz = -d.getTimezoneOffset(), sg = tz >= 0 ? '+' : '-';
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) +
      sg + pad(tz / 60) + ':' + pad(tz % 60);
  }
  function uid(prefix) {
    return (prefix || 'card') + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
  }
  function hashCard(c) {
    var s = FIELDS.map(function (k) {
      return k === 'tags' ? (c.tags || []).join(',') : String(c[k] == null ? '' : c[k]);
    }).join('\u0001');
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }
  function icoPng() { return window.__IMG__['test_potato']; }
  function parseTags(s) {
    return String(s || '').split(/[,，]/).map(function (t) { return t.trim(); }).filter(Boolean);
  }

  /* ---------- 数据层 ---------- */
  var Store = {
    cards: [],
    revisions: [],
    baseRevision: null,
    // 基线指纹：上次同步（全量导入 / 初始加载）时每张卡的内容哈希，
    // 用于增量导入时判断"本地这张卡有没有被改过"。
    baseHashes: {},
    rebuildBaseHashes: function () {
      var h = {};
      this.cards.forEach(function (c) { h[c.id] = hashCard(c); });
      this.baseHashes = h;
    },
    load: function () {
      try {
        var raw = localStorage.getItem(STORE_KEY);
        if (raw) {
          var d = JSON.parse(raw);
          if (d && Array.isArray(d.cards) && d.cards.length) {
            this.cards = d.cards;
            this.revisions = d.revisions || [];
            this.baseRevision = d.baseRevision || null;
            this.baseHashes = d.baseHashes || {};
            if (!Object.keys(this.baseHashes).length) this.rebuildBaseHashes();
            return;
          }
        }
      } catch (e) { /* 损坏则回落到种子数据 */ }
      this.resetToSeed();
    },
    resetToSeed: function () {
      this.cards = clone(window.__SEED__.cards || []);
      this.revisions = [];
      this.baseRevision = nowIso();
      this.rebuildBaseHashes();
    },
    persist: function () {
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify({
          cards: this.cards, revisions: this.revisions,
          baseRevision: this.baseRevision, baseHashes: this.baseHashes
        }));
      } catch (e) { toast('本地存储写入失败（可能超出容量）'); }
    },
    find: function (id) {
      for (var i = 0; i < this.cards.length; i++) if (this.cards[i].id === id) return this.cards[i];
      return null;
    },
    indexOf: function (id) {
      for (var i = 0; i < this.cards.length; i++) if (this.cards[i].id === id) return i;
      return -1;
    },
    log: function (action, cardId, cardName, before, after, by) {
      var delta = {};
      if (before && after) {
        Object.keys(after).forEach(function (k) {
          if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) {
            delta[k] = { before: clone(before[k]), after: clone(after[k]) };
          }
        });
      }
      var entry = {
        id: uid('rev'), ts: nowIso(), action: action, cardId: cardId, cardName: cardName,
        before: before ? clone(before) : null,
        after: after ? clone(after) : null,
        delta: delta
      };
      // 提交者：仅导入时由数据包的导出者提供（本机编辑不填，卡面的 by 始终是最初创建者）
      var who = String(by == null ? '' : by).trim().slice(0, 24);
      if (who) entry.by = who;
      this.revisions.unshift(entry);
      if (this.revisions.length > 500) this.revisions.length = 500;
    }
  };

  /* ---------- 视图状态 ---------- */
  var UI = {
    mode: 'view',           // view | edit
    view: 'grid',           // grid | table
    mview: 'grid',          // 移动端三视图：list | grid | ins（方案A，桌面忽略）
    sel: null,              // 选中的 cardId
    tab: 'attr',            // attr | text | log
    q: '',
    lv: 'all',
    type: 'all',
    sort: 'level',
    sortDir: 'asc',         // asc | desc（排序字段与方向分开控制）
    snap: null,             // 进入编辑时的深拷贝快照
    dirty: false
  };

  function current() { return UI.sel ? Store.find(UI.sel) : null; }
  function isDirty() { return UI.dirty; }

  /* ---------- Toast ---------- */
  var toastTimer = null;
  function toast(msg) {
    var el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 1800);
  }

  /* ---------- 卡面渲染 ---------- */
  // 衍生物：简化卡面 —— 只有名称、卡图与攻/血/价三个数值（没有留空槽）
  function isDeriv(card) { return !!card && card.level === DERIV; }

  // 大卡下方的注脚：完全由用户填写（card.sub），初始为空时不占位
  function subOf(c) { return String((c && c.sub) == null ? '' : c.sub); }
  // 提交者：旧数据没有该字段，统一回落到 SnN
  function byOf(c) { return String((c && c.by) == null ? '' : c.by).trim() || 'SnN'; }

  // 卡图来源：上传的图片以 dataURL 存在 card.art；否则取内置图
  // 无卡图（或 art 为旧版本的 'potato' 之类无效值）时统一显示「?」占位图 potato_temp；
  // 例外：「普通土豆」这张卡本身画的就是土豆，缺省仍用土豆图 test_potato
  function artSrc(card) {
    var a = card && card.art;
    if (a && /^data:image\//.test(a)) return a;
    if (a && window.__IMG__[a]) return window.__IMG__[a];
    if (card && richPlain(card.name) === '普通土豆') return window.__IMG__['test_potato'];
    return window.__IMG__['potato_temp'];
  }
  // 数值字体选择：GameDigits 字库含 0-9 + - × / ? x y，只要数值的每个字符
  // 都在字库内就走像素字体（.px）；多字符降一档字号（.m），
  // 3 字符以上再加 .l3 用负字距收紧，不靠继续缩字号来塞进格子
  var PIX_RE = /^[0-9+\-*/?xy×−]+$/;
  function valHTML(cls, val) {
    var t = (val === '' || val == null) ? '' : String(val);
    var pix = t !== '' && PIX_RE.test(t);
    var size = t.length >= 3 ? ' m l3' : (t.length > 1 ? ' m' : '');
    return '<span class="v ' + cls + (pix ? ' px' : ' tx') + size + '">' + esc(t) + '</span>';
  }

  function frameHTML(card, size) {
    var deriv = isDeriv(card);
    var lv = LEVEL_ART[card.level] || LEVEL_ART.I;
    var art = artSrc(card);
    return '<div class="frame' + (deriv ? ' deriv' : '') + '">' +
      '<img class="bg" alt="" src="' + window.__IMG__[lv] + '">' +
      '<img class="art" alt="" src="' + art + '">' +
      '<span class="nm">' + renderRichText(card.name) + '</span>' +
      valHTML('atk', card.atk) + valHTML('hp', card.hp) + valHTML('pr', card.price) +
      (deriv ? '' : valHTML('ex', card.extra)) +
      '</div>';
  }

  /* ---------- 列表 / 筛选 ---------- */
  function filtered() {
    var q = UI.q.trim().toLowerCase();
    var list = Store.cards.filter(function (c) {
      if (UI.lv !== 'all' && c.level !== UI.lv) return false;
      if (UI.type !== 'all' && c.type !== UI.type) return false;
      if (!q) return true;
      var hay = [richPlain(c.name), richPlain(c.text), richPlain(c.idea), (c.tags || []).join(' '), c.id].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
    var byName = function (a, b) { return richPlain(a.name).localeCompare(richPlain(b.name), 'zh'); };
    var dir = UI.sortDir === 'desc' ? -1 : 1;
    if (UI.sort === 'name') list.sort(function (a, b) { return byName(a, b) * dir; });
    else if (UI.sort === 'upd') list.sort(function (a, b) { return (String(a.upd).localeCompare(String(b.upd)) || byName(a, b)) * dir; });
    else list.sort(function (a, b) {
      var d = LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level);
      return (d || byName(a, b)) * dir;
    });
    return list;
  }

  function renderChips() {
    var lv = ['all'].concat(LEVELS), lvLabel = { all: '全部', I: 'I', II: 'II', III: 'III', IV: 'IV', '衍生物': '衍生物' };
    $('#lvChips').innerHTML = lv.map(function (k) {
      return '<button class="chip' + (UI.lv === k ? ' on' : '') + '" data-lv="' + k + '">' + lvLabel[k] + '</button>';
    }).join('');
    var ty = ['all'].concat(TYPES);
    $('#typeChips').innerHTML = ty.map(function (k) {
      return '<button class="chip' + (UI.type === k ? ' on' : '') + '" data-type="' + k + '">' + (k === 'all' ? '全部' : k) + '</button>';
    }).join('');
  }

  // 空态：中间栏给主入口（大按钮），左栏只留一句提示，避免同一段话出现三次
  function emptyHTML(variant) {
    if (Store.cards.length) return '<div class="empty">没有匹配的卡牌</div>';
    if (variant === 'list') return '<div class="empty">卡库为空</div>';
    return '<div class="empty empty-lib">' +
      '<div class="el-title">卡库为空</div>' +
      '<div class="el-sub">程序不含卡牌数据，导入团队分发的 .pcard 数据包即可开始。</div>' +
      '<button class="btn solid" data-empty-act="import">导入数据包</button>' +
      '</div>';
  }

  function renderList() {
    var list = filtered();
    $('#listCnt').textContent = list.length + ' 张';
    if (!list.length) { $('#clist').innerHTML = emptyHTML('list'); return; }
    $('#clist').innerHTML = list.map(function (c) {
      return '<div class="crow' + (c.id === UI.sel ? ' on' : '') + '" data-id="' + c.id + '">' +
        '<img class="art" alt="" src="' + artSrc(c) + '">' +
        '<div class="meta">' +
        '<div class="nm">' + renderRichText(c.name) + '</div>' +
        '<div class="line2">' +
        '<span class="nums">' + esc(c.atk || '0') + '<i>·</i>' + esc(c.hp || '0') + '<i>·</i>' + esc(c.price || '0') + '</span>' +
        '<span class="ty">' + esc(c.type) + '</span>' +
        '</div>' +
        '</div>' +
        '</div>';
    }).join('');
  }

  /* ---------- 中栏 ---------- */
  function renderCenter() {
    var list = filtered();
    $('#gridCnt').textContent = list.length + ' 张';
    var body = $('#centerBody');
    if (!list.length) { body.innerHTML = emptyHTML(); return; }
    if (UI.view === 'grid') {
      body.innerHTML = '<div class="cards">' + list.map(function (c) {
        return '<button class="card' + (c.id === UI.sel ? ' on' : '') + '" data-id="' + c.id + '" title="' + esc(richPlain(c.name)) + '">' +
          '<span class="flag">▸ 选中</span>' + frameHTML(c) + '</button>';
      }).join('') + '</div>';
    } else {
      body.innerHTML = '<table class="data"><thead><tr>' +
        '<th>等级</th><th>名称</th><th>类型</th><th>攻</th><th>血</th><th>价</th><th>成长</th><th>牌效</th><th>更新</th>' +
        '</tr></thead><tbody>' + list.map(function (c) {
          return '<tr class="' + (c.id === UI.sel ? 'on' : '') + '" data-id="' + c.id + '">' +
            '<td>' + esc(c.level) + '</td><td>' + renderRichText(c.name) + '</td><td>' + esc(c.type) + '</td>' +
            '<td>' + esc(c.atk) + '</td><td>' + esc(c.hp) + '</td><td>' + esc(c.price) + '</td>' +
            '<td>' + esc(c.growth) + '</td><td class="tx">' + esc(richPlain(c.text).replace(/\n/g, ' ')) + '</td>' +
            '<td>' + esc(c.upd) + '</td></tr>';
        }).join('') + '</tbody></table>';
    }
  }

  /* ---------- 右栏 ---------- */
  function renderInspector() {
    var c = current();
    var insBody = $('#insBody'), state = $('#insState');
    $('#btnDup').disabled = !c;
    $('#btnDel').disabled = !c;
    if (!c) {
      state.innerHTML = '';
      insBody.innerHTML = Store.cards.length
        ? '<div class="ins-empty">未选择卡牌。<br>从左侧列表或中间卡牌库选择一张开始。</div>'
        : '<div class="ins-empty">卡库为空。<br>用「数据 → 导入数据包」加载团队数据包。' +
          '<br><button class="btn solid m-only" data-empty-act="import">导入数据包</button></div>';
      renderFoot();
      return;
    }
    if (UI.dirty) state.innerHTML = '<span class="state dirty"><span class="pt"></span>未保存</span>';
    else state.innerHTML = '';

    var sub = subOf(c);
    var html = '<div class="pv">' + frameHTML(c) +
      (UI.mode === 'edit'
        // 编辑态：注脚就地可改（与查看态同一位置），初始为空
        ? '<input class="fx pv-sub" data-f="sub" maxlength="40" placeholder="卡面注脚（可留空）"' +
          ' title="显示在卡面下方的一行备注，例如：I 级 · 辅助 · 成长 1 回合" value="' + esc(sub) + '">'
        : (sub.trim() ? '<div class="pv-meta">' + esc(sub) + '</div>' : '')) +
      '</div>';
    // 描述区：查看模式常驻（满足"选中即在侧边显示描述"）；
    // 编辑模式下收进「文本」页签，以免挤压表单。
    // 「记录」页签不需要描述，也一并省略。
    if (UI.tab !== 'log' && (UI.mode === 'view' || UI.tab === 'text')) {
      html += renderDesc(c);
    }

    if (UI.tab === 'attr') html += UI.mode === 'view' ? renderAttrView(c) : renderAttrForm(c);
    else if (UI.tab === 'text') html += renderTextForm(c);
    else html += renderLogs(c);
    insBody.innerHTML = html;
    decoratePreviewUpload();

    renderFoot();
  }

  /* ---------- 检视器底栏 ----------
     查看：显示「查看 + 编辑」；编辑：显示「编辑 + 查看 + 还原 + 保存」，
     右下角随时可回到查看模式（未保存时提示先保存或还原）。 */
  function renderFoot() {
    var foot = $('#insFoot');
    if (!foot) return;
    if (!current()) {
      foot.innerHTML = '<span class="state"><span class="pt" style="background:#b3b0a2"></span>无选中</span>';
      return;
    }
    if (UI.mode === 'view') {
      foot.innerHTML = '<span class="state">查看</span>' +
        '<span class="grow"></span><button class="btn solid" id="btnEdit"><span class="ic ic-edit"></span> 编辑</button>';
      return;
    }
    var dis = UI.dirty ? '' : ' disabled';
    foot.innerHTML =
      '<span class="state' + (UI.dirty ? ' dirty' : '') + '">' +
      (UI.dirty ? '<span class="pt"></span>编辑 · 未保存' : '编辑') + '</span>' +
      '<span class="grow"></span>' +
      '<button class="btn" id="btnView" title="返回查看模式">查看</button>' +
      '<button class="btn" id="btnRevert"' + dis + '>还原</button>' +
      '<button class="btn solid" id="btnSave"' + dis + '><span class="ic ic-save"></span> 保存</button>';
  }

  /* ---------- 范围图形（内联标记）----------
     存储形式：文本中嵌入 [[r:NNNNNNNNN]]
       后面 9 位对应 3x3（从左到右、从上到下），1=可用格，0=不可用
       中心位（下标 4）恒为 0，代表卡牌自身，渲染为实心黑点
     示例：[[r:100000100]] → 左上 + 左下（左斜对角）
            [[r:011010011]] → 上方 T 字以外的常见形状等
     好处：纯文本存储，可随卡片 JSON 一起导入导出，旧数据完全兼容。 */
  var RANGE_RE = /\[\[r:([01]{9})\]\]/g;

  // 解析 9 位掩码为 3x3 布尔数组
  // 内部表示中，中心（下标 4）恒为 true —— 用于渲染实心黑点"自身"
  function rangeMaskToGrid(mask) {
    var g = [];
    for (var i = 0; i < 9; i++) g.push(i === 4 ? true : mask.charAt(i) === '1');
    return g;
  }
  // 导出为 9 位掩码；中心位强制为 '0'（中心代表自身，不参与"可用范围"）
  function rangeGridToMask(grid) {
    var s = '';
    for (var i = 0; i < 9; i++) s += (i === 4 ? '0' : (grid[i] ? '1' : '0'));
    return s;
  }

  // 渲染一个范围图形（O = 可用空心圈，● = 自身实心点）
  // opts 可为字符串（附加 class）或对象 { cls, edit }；edit 模式带 data-mask，
  // 供 contenteditable 编辑器序列化回 [[r:...]]，并设为不可编辑的整体。
  function rangeGlyphHTML(mask, opts) {
    var cls = typeof opts === 'string' ? opts : ((opts && opts.cls) || '');
    var edit = !!(opts && typeof opts === 'object' && opts.edit);
    var g = rangeMaskToGrid(mask);
    var cells = '';
    for (var i = 0; i < 9; i++) {
      var isCenter = i === 4;
      var on = g[i];
      var inner = isCenter ? '<i class="rg-dot"></i>' : (on ? '<i class="rg-o"></i>' : '');
      cells += '<span class="rg-c' + (on ? ' on' : '') + (isCenter ? ' self' : '') + '">' + inner + '</span>';
    }
    return '<span class="range-glyph' + (cls ? ' ' + cls : '') + '"' +
      (edit ? ' contenteditable="false" data-mask="' + mask + '"' : '') +
      ' title="范围 3x3：●=自身，○=可用">' + cells + '</span>';
  }

  /* ---------- 富文本（b / i / u / 颜色 / 换行 + 范围图形） ---------- */
  // 存储仍是字符串（可随卡片 JSON 导出导入，旧数据完全兼容）。
  // 允许的标签集合固定，其它标签一律「剥壳留文字」，防止外部 JSON 注入脚本。
  var RT_TAGS = { B: 'b', STRONG: 'b', I: 'i', EM: 'i', U: 'u' };
  var RT_COLORS = ['#a8402f', '#2f6fb5', '#3f7a5a', '#a3741a', '#7b45c9'];
  var RT_HTML_RE = /<\/?(b|i|u|strong|em|br|span|div|p|font)\b/i;

  function rtColor(v) {
    v = String(v || '').trim();
    var m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(v);
    if (m) {
      var h = function (n) { var s = (+n).toString(16); return s.length < 2 ? '0' + s : s; };
      return ('#' + h(m[1]) + h(m[2]) + h(m[3])).toLowerCase();
    }
    return /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : '';
  }
  function rtColorOf(el) {
    if (!el || !el.getAttribute) return '';
    return rtColor(el.getAttribute('color') || (el.style && el.style.color));
  }
  function isRangeNode(n) {
    return !!(n && n.nodeType === 1 && n.classList && n.classList.contains('range-glyph'));
  }
  // 文本节点：转义 + 范围标记转图形
  function rtTextNode(txt, forEdit) {
    var out = '', last = 0, m;
    var re = new RegExp(RANGE_RE.source, 'g');
    while ((m = re.exec(txt)) !== null) {
      out += esc(txt.slice(last, m.index));
      out += rangeGlyphHTML(m[1], { edit: forEdit });
      last = m.index + m[0].length;
    }
    return out + esc(txt.slice(last));
  }
  // DOM → 安全 HTML（白名单标签保留，其它剥壳）
  function rtBuildHTML(root, forEdit) {
    var out = '';
    for (var n = root.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3) { out += rtTextNode(n.nodeValue, forEdit); continue; }
      if (n.nodeType !== 1) continue;
      var tag = String(n.tagName || '').toUpperCase();
      if (tag === 'BR') { out += '<br>'; continue; }
      if (tag === 'DIV' || tag === 'P') { out += '<br>' + rtBuildHTML(n, forEdit); continue; }
      if (RT_TAGS[tag]) {
        out += '<' + RT_TAGS[tag] + '>' + rtBuildHTML(n, forEdit) + '</' + RT_TAGS[tag] + '>';
        continue;
      }
      if (tag === 'SPAN' || tag === 'FONT') {
        var color = rtColorOf(n);
        var inner = rtBuildHTML(n, forEdit);
        out += color ? '<span style="color:' + color + '">' + inner + '</span>' : inner;
        continue;
      }
      out += rtBuildHTML(n, forEdit);
    }
    return out;
  }
  // 存储字符串 → 安全 HTML（用于查看态 / 卡面 / 列表）
  function renderRichText(text, forEdit) {
    text = String(text == null ? '' : text);
    if (!text) return '';
    var box = document.createElement('div');
    if (RT_HTML_RE.test(text)) box.innerHTML = text;
    else box.innerHTML = esc(text).replace(/\n/g, '<br>');
    return rtBuildHTML(box, !!forEdit);
  }
  // 纯文本化（搜索匹配、title 属性、表格摘要）
  function richPlain(text) {
    var box = document.createElement('div');
    box.innerHTML = renderRichText(text);
    var glyphs = box.querySelectorAll('.range-glyph');
    for (var i = 0; i < glyphs.length; i++) {
      var g = glyphs[i];
      if (g.parentNode) g.parentNode.replaceChild(document.createTextNode('〔范围〕'), g);
    }
    return (box.textContent || '').replace(/\u00a0/g, ' ');
  }
  // 编辑器中 contenteditable DOM → 存储字符串
  function serializeRich(root) {
    var out = '';
    for (var n = root.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3) { out += n.nodeValue; continue; }
      if (n.nodeType !== 1) continue;
      if (isRangeNode(n)) {
        var mask = n.getAttribute('data-mask');
        if (mask) out += '[[r:' + mask + ']]';
        continue;
      }
      var tag = String(n.tagName || '').toUpperCase();
      if (tag === 'BR') { out += '\n'; continue; }
      if (tag === 'DIV' || tag === 'P') {
        out += (out && !/\n$/.test(out) ? '\n' : '') + serializeRich(n);
        continue;
      }
      var inner = serializeRich(n);
      if (RT_TAGS[tag]) out += '<' + RT_TAGS[tag] + '>' + inner + '</' + RT_TAGS[tag] + '>';
      else if (tag === 'SPAN' || tag === 'FONT') {
        var color = rtColorOf(n);
        out += color ? '<span style="color:' + color + '">' + inner + '</span>' : inner;
      } else out += inner;
    }
    return out;
  }
  // 去标记的纯文本（兼容旧函数名：范围标记 → 〔范围〕）
  function stripRangeMarks(text) {
    return richPlain(text);
  }

  // 描述区：始终可见，不依赖页签
  function renderDesc(c) {
    var t = (c.text || '').trim();
    var idea = (c.idea || '').trim();
    var h = '<div class="desc"><h4>描述</h4>';
    h += '<div class="body rich' + (t ? '' : ' placeholder') + '">' +
      (t ? renderRichText(c.text) : '（未填写牌效）') + '</div>';
    if (idea) h += '<h4 style="margin-top:8px">设计思路</h4><div class="idea rich">' + renderRichText(c.idea) + '</div>';
    h += '</div>';
    return h;
  }

  // 查看态的「属性」页只保留：标签 + 更新 / 提交者。
  // （原先的 ID/等级/类型/数值/成长/留空槽清单已去掉；「文本」页签在查看态移除，
  //   牌效与设计思路都在常驻描述区里。）
  function renderAttrView(c) {
    var tags = (c.tags || []).map(function (t) { return '<span class="tag">' + esc(t) + '</span>'; }).join('');
    var note = isDeriv(c)
      ? '<div class="hintline" style="margin-bottom:8px">衍生物 · 简化卡面（只显示名称、卡图与三个数值）</div>'
      : '';
    return '<div class="attrview">' + note +
      '<div class="taglist">' + (tags || '<span class="tag muted">无标签</span>') + '</div>' +
      '<div class="metaline">' +
      '<span><i>更新</i><b>' + esc(c.upd || '—') + '</b></span>' +
      '<span><i>提交者</i><b>' + esc(byOf(c)) + '</b></span>' +
      '</div>' +
      '</div>';
  }

  function renderAttrForm(c) {
    var deriv = isDeriv(c);
    return '<div class="form' + (deriv ? ' deriv' : '') + '">' +
      '<div class="row"><label>卡牌 ID（不可改）</label>' +
      '<input class="fx" value="' + esc(c.id) + '" disabled style="opacity:.65"></div>' +
      '<div class="row"><label>名称（支持富文本标签）</label>' +
      '<input class="fx" data-f="name" maxlength="48" value="' + esc(c.name) + '">' +
      '<div class="hintline" id="namePreview">预览：' + renderRichText(c.name) + '</div></div>' +
      '<div class="row"><label>卡图（裁切为 32×32）</label><div class="art-row">' +
      '<img class="art-thumb" id="artThumb" alt="" src="' + artSrc(c) + '">' +
      '<button class="btn tiny" type="button" id="btnArtUp">上传图片</button>' +
      '<button class="btn tiny" type="button" id="btnArtReset">恢复默认</button>' +
      '<span class="hintline">编辑时也可直接点上方卡面卡图</span>' +
      '</div></div>' +
      '<div class="grid2">' +
      '<div class="row"><label>等级</label><select class="fx" data-f="level">' +
      LEVELS.map(function (l) { return '<option' + (c.level === l ? ' selected' : '') + '>' + l + '</option>'; }).join('') +
      '</select></div>' +
      '<div class="row"><label>类型</label><select class="fx" data-f="type">' +
      TYPES.map(function (t) { return '<option' + (c.type === t ? ' selected' : '') + '>' + t + '</option>'; }).join('') +
      '</select></div>' +
      '</div>' +
      '<div class="grid3">' +
      '<div class="row"><label>攻击力</label><input class="fx" data-f="atk" value="' + esc(c.atk) + '"></div>' +
      '<div class="row"><label>血量</label><input class="fx" data-f="hp" value="' + esc(c.hp) + '"></div>' +
      '<div class="row"><label>价值</label><input class="fx" data-f="price" value="' + esc(c.price) + '"></div>' +
      '</div>' +
      '<div class="grid2 deriv-hide">' +
      '<div class="row"><label>留空槽（数字/图标）</label><input class="fx" data-f="extra" value="' + esc(c.extra) + '" placeholder="可空"></div>' +
      '<div class="row"><label>成长回合</label><input class="fx" data-f="growth" type="number" min="0" max="9" value="' + esc(c.growth) + '"></div>' +
      '</div>' +
      '<div class="row"><label>标签（逗号分隔）</label><input class="fx" data-f="tags" value="' + esc((c.tags || []).join(',')) + '"></div>' +
      '<div class="grid2">' +
      '<div class="row"><label>更新日期</label><input class="fx" data-f="upd" value="' + esc(c.upd) + '"></div>' +
      '<div class="row"><label>提交者（属性页显示）</label><input class="fx" data-f="by" maxlength="24" value="' + esc(byOf(c)) + '" placeholder="SnN"></div>' +
      '</div>' +
      (deriv
        ? '<div class="hintline">衍生物卡面只显示名称、卡图与三个数值，留空槽与成长回合不参与渲染。</div>'
        : '<div class="hintline">数值可填数字或表达式（如 <b>?</b>、<b>1+?</b>），将原样显示在卡面。</div>') +
      '<div class="hintline">名称支持富文本：<b>粗</b> / <i>斜</i> / <u>下划线</u> / <span style="color:#a8402f">颜色</span>；描述请在「文本」页签用工具栏编辑。</div>' +
      '</div>';
  }

  /* 3x3 索引布局（掩码按行从左到右）：
       0 1 2
       3 4 5      ← 4 为卡牌自身，恒为 '0'
       6 7 8
     各形态（经参考图放大逐像素判读确认）：
       上下相邻 = 010/000/010 → '010000010'   （上、下）
       左右相邻 = 000/101/000 → '000101000'   （左、右）
       直接相邻 = 010/101/010 → '010101010'   （十字四格）
       上方 T 字 = 000/101/010 → '000101010'  （左、右 + 下）
       下方 T 字 = 010/101/000 → '010101000'  （上 + 左、右）
       方形范围 = 111/101/111 → '111101111'   （3x3 全包围）
       左斜对角 = 100/000/001 → '100000001'   （左上、右下）
       右斜对角 = 001/000/100 → '001000100'   （右上、左下） */
  var RANGE_PRESETS = [
    { name: '上下相邻', mask: '010000010' },
    { name: '左右相邻', mask: '000101000' },
    { name: '直接相邻', mask: '010101010' },
    { name: '上方 T 字', mask: '000101010' },
    { name: '下方 T 字', mask: '010101000' },
    { name: '方形范围', mask: '111101111' },
    { name: '左斜对角 \\', mask: '100000001' },
    { name: '右斜对角 /', mask: '001000100' }
  ];

  // 富文本工具栏（field = text | idea）
  function rtToolbar(field) {
    var sw = RT_COLORS.map(function (c) {
      return '<button type="button" class="sw" data-cmd="color" data-color="' + c + '" data-rt-for="' + field + '"' +
        ' style="background:' + c + '" title="文字颜色 ' + c + '"></button>';
    }).join('');
    return '<div class="rt-tools">' +
      '<button type="button" data-cmd="bold" data-rt-for="' + field + '" title="加粗"><b>B</b></button>' +
      '<button type="button" data-cmd="italic" data-rt-for="' + field + '" title="斜体"><i>I</i></button>' +
      '<button type="button" data-cmd="underline" data-rt-for="' + field + '" title="下划线"><u>U</u></button>' +
      '<span class="sep"></span>' + sw +
      '<span class="sep"></span>' +
      '<button type="button" data-cmd="clear" data-rt-for="' + field + '" title="清除格式">清</button>' +
      '<button type="button" data-cmd="range" data-rt-for="' + field + '" title="插入 3x3 范围图形">＋ 范围</button>' +
      '</div>';
  }

  function renderTextForm(c) {
    return '<div class="form">' +
      '<div class="row">' +
      '<div class="tbar"><label>牌效文本 · 富文本</label>' + rtToolbar('text') + '</div>' +
      '<div class="rt-editor" id="rt-text" data-rt="text" contenteditable="true" spellcheck="false">' +
      renderRichText(c.text, true) + '</div>' +
      '<div class="hintline" id="textPreview">' +
      (c.text ? '预览：' + renderRichText(c.text) : '预览：（空）') + '</div>' +
      '</div>' +
      '<div class="row"><div class="tbar"><label>设计思路 · 富文本</label>' + rtToolbar('idea') + '</div>' +
      '<div class="rt-editor" id="rt-idea" data-rt="idea" contenteditable="true" spellcheck="false" style="min-height:80px">' +
      renderRichText(c.idea, true) + '</div></div>' +
      '</div>';
  }

  /* ---------- 弹窗基础（part1 内共用）---------- */
  function openModal(title) {
    $('#modalTitle').textContent = title;
    $('#overlay').classList.add('show');
  }
  function closeModal() {
    $('#overlay').classList.remove('show');
    $('#modal').classList.remove('wide');
  }

  /* ---------- 范围选择弹窗 ---------- */
  var rangeCb = null;   // 确认回调
  var rangeState = null; // 当前 3x3 选中状态

  function openRangePicker(onConfirm) {
    rangeCb = onConfirm;
    // 内部状态：中心恒为 true（渲染为 ● 自身），其余为可切换的可用格
    rangeState = [false, false, false, false, true, false, false, false, false];
    renderRangePicker();
    showRangeModal();
  }

  function renderRangePicker() {
    var cells = '';
    for (var i = 0; i < 9; i++) {
      var isCenter = i === 4;
      var on = rangeState[i];
      cells += '<button type="button" class="gp' + (isCenter ? ' self' : on ? ' on' : '') +
        '" data-i="' + i + '"' + (isCenter ? ' disabled' : '') + '>' +
        (isCenter ? '●' : (on ? '○' : '')) + '</button>';
    }
    var mask = rangeGridToMask(rangeState);
    var body =
      '<div class="gpwrap">' +
      '<div class="grid3gp">' + cells + '</div>' +
      '<div class="gpinfo">' +
      '<div class="hintline" style="margin-bottom:6px">点击空格选择可用范围；● 为卡牌自身（固定）。</div>' +
      '<div class="hintline">当前：' + (rangeGlyphHTML(mask)) + '</div>' +
      '<div class="hintline" style="margin-top:8px">常用范围：</div>' +
      '<div class="presets">' +
      RANGE_PRESETS.map(function (p, idx) {
        return '<button type="button" class="btn tiny preset" data-preset="' + idx + '">' +
          rangeGlyphHTML(p.mask, 'mini') + '<span>' + esc(p.name) + '</span></button>';
      }).join('') +
      '</div>' +
      '</div></div>';
    $('#modalBody').innerHTML = body;
    $('#modalFoot').innerHTML =
      '<button class="btn" id="rgClear">清空</button><span style="flex:1"></span>' +
      '<button class="btn" id="rgCancel">取消</button>' +
      '<button class="btn solid" id="rgOk">插入</button>';

    // 绑定
    $$('#modalBody .gp').forEach(function (b) {
      b.onclick = function () {
        var i = +b.getAttribute('data-i');
        if (i === 4) return;
        rangeState[i] = !rangeState[i];
        renderRangePicker();
      };
    });
    $$('#modalBody .preset').forEach(function (b) {
      b.onclick = function () {
        var p = RANGE_PRESETS[+b.getAttribute('data-preset')];
        rangeState = rangeMaskToGrid(p.mask);
        rangeState[4] = true;
        renderRangePicker();
      };
    });
    $('#rgClear').onclick = function () {
      rangeState = [false, false, false, false, true, false, false, false, false];
      renderRangePicker();
    };
    $('#rgCancel').onclick = function () { closeRangeModal(); };
    $('#rgOk').onclick = function () {
      var mask = rangeGridToMask(rangeState);
      var cb = rangeCb;            // 先取出回调，closeRangeModal 会清空它
      closeModal();
      rangeCb = null;
      if (cb) cb(mask);
    };
  }

  function showRangeModal() { openModal('插入范围图形'); }
  function closeRangeModal() { closeModal(); rangeCb = null; }

  /* ---------- 富文本编辑交互 ---------- */
  var lastRichField = 'text';
  function richEditor(field) { return $('#rt-' + field); }
  function setRichField(field) { if (field) lastRichField = field; }
  function syncRich(field, ed) {
    var c = current();
    if (!c || !ed) return;
    c[field] = serializeRich(ed);
    markDirty();
    updatePreview(c);
    renderSiblings();
  }
  function onRichInput(el) {
    var field = el.getAttribute('data-rt');
    if (!field) return;
    lastRichField = field;
    syncRich(field, el);
  }
  function applyRichCmd(cmd, color, field) {
    field = field || lastRichField || 'text';
    var ed = richEditor(field);
    if (!ed) return;
    ed.focus();
    if (cmd === 'range') { openRangePicker(function (mask) { insertRangeMark(mask); }); return; }
    if (!document.execCommand) { toast('当前浏览器不支持富文本命令'); return; }
    if (cmd === 'color') document.execCommand('foreColor', false, color || RT_COLORS[0]);
    else if (cmd === 'clear') document.execCommand('removeFormat', false, null);
    else document.execCommand(cmd, false, null);
    syncRich(field, ed);
  }

  // 在富文本编辑器光标处插入范围图形（无编辑器时退回追加到文本末尾）
  function insertRangeMark(mask) {
    var c = current();
    if (!c) return;
    var ed = richEditor(lastRichField) || $('#rt-text');
    var html = rangeGlyphHTML(mask, { edit: true });
    if (ed) {
      ed.focus();
      var ok = false;
      if (document.execCommand) {
        try { ok = document.execCommand('insertHTML', false, html); } catch (e) { ok = false; }
      }
      if (!ok) ed.insertAdjacentHTML('beforeend', html);
      syncRich(lastRichField, ed);
      return;
    }
    c.text = (c.text || '') + '[[r:' + mask + ']]';
    markDirty();
    renderAll();
  }

  /* ---------- 卡图上传 ---------- */
  var ART_SIZE = 32;
  function pickArt() {
    var c = current();
    if (!c || UI.mode !== 'edit') { toast('进入编辑模式后可更换卡图'); return; }
    var inp = $('#artFile');
    if (!inp) return;
    inp.value = '';
    inp.click();
  }
  function resetArt() {
    var c = current();
    if (!c) return;
    c.art = 'potato';
    markDirty();
    updatePreview(c);
    renderAll();
    toast('已恢复默认卡图');
  }
  // 读图 → 等比覆盖 + 居中裁切 → 32×32 PNG dataURL
  function loadArt(file) {
    var c = current();
    if (!c || !file) return;
    if (typeof FileReader === 'undefined' || typeof Image === 'undefined') {
      toast('当前环境不支持图片读取');
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        try {
          var cv = document.createElement('canvas');
          cv.width = ART_SIZE; cv.height = ART_SIZE;
          var ctx = cv.getContext('2d');
          if (!ctx) throw new Error('no canvas');
          var s = Math.max(ART_SIZE / img.width, ART_SIZE / img.height);
          var w = img.width * s, h = img.height * s;
          // 小图（≤64px）多半是像素画：关掉平滑，保持硬边
          ctx.imageSmoothingEnabled = !(img.width <= 64 && img.height <= 64);
          ctx.clearRect(0, 0, ART_SIZE, ART_SIZE);
          ctx.drawImage(img, (ART_SIZE - w) / 2, (ART_SIZE - h) / 2, w, h);
          c.art = cv.toDataURL('image/png');
        } catch (e) {
          toast('图片处理失败（浏览器不支持 Canvas）');
          return;
        }
        markDirty();
        updatePreview(c);
        renderSiblings();
        var th = $('#artThumb'); if (th) th.src = artSrc(c);
        toast('卡图已更新（32×32）');
      };
      img.onerror = function () { toast('无法读取该图片'); };
      img.src = reader.result;
    };
    reader.onerror = function () { toast('读取文件失败'); };
    reader.readAsDataURL(file);
  }

  // 编辑模式下给大卡预览加「可点击更换卡图」标记
  function decoratePreviewUpload() {
    var fr = $('.pv .frame');
    if (!fr || UI.mode !== 'edit') return;
    fr.classList.add('can-upload');
    if (!$('.art-hint', fr)) {
      var hint = document.createElement('span');
      hint.className = 'art-hint';
      hint.textContent = '点击更换卡图';
      fr.appendChild(hint);
    }
  }

  function renderLogs(c) {
    var logs = Store.revisions.filter(function (r) { return r.cardId === c.id; }).slice(0, 40);
    if (!logs.length) return '<div class="empty">这张卡暂无变更记录</div>';
    var actName = { create: '创建', update: '修改', delete: '删除', import: '导入' };
    return '<div class="revlog">' + logs.map(function (r) {
      var fields = Object.keys(r.delta || {});
      var detail = fields.length
        ? fields.map(function (k) {
          return k + ': ' + String(r.delta[k].before) .slice(0, 60) + ' → ' + String(r.delta[k].after).slice(0, 60);
        }).join('\n')
        : '';
      return '<div class="rev"><div class="h"><span class="act">' + (actName[r.action] || r.action) + '</span>' +
        (r.by ? '<span class="by">@' + esc(r.by) + '</span>' : '') +
        '<span class="d">' + esc(r.ts.replace('T', ' ').slice(0, 19)) + '</span></div>' +
        (detail ? '<div class="b">' + esc(detail) + '</div>' : '') + '</div>';
    }).join('') + '</div>';
  }

  /* ---------- 状态栏（只保留模式与快捷键提示，不再统计卡牌/类型） ---------- */
  function renderStatus() {
    $('#stMode').textContent = (UI.mode === 'edit' ? '编辑模式' : '查看模式') +
      (UI.dirty ? ' · 未保存' : '') + ' · ' + (UI.view === 'grid' ? '网格' : '数据表');
  }

  /* ---------- 移动端三视图同步（方案A） ---------- */
  function renderMobile() {
    var main = $('.main');
    if (main) {
      ['list', 'grid', 'ins'].forEach(function (v) {
        main.classList.toggle('mv-' + v, UI.mview === v);
      });
    }
    $$('#mTabs button').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-mv') === UI.mview);
    });
    document.body.setAttribute('data-mode', UI.mode);
    var ms = $('#mState');
    if (ms) {
      ms.innerHTML = UI.mode === 'edit'
        ? (UI.dirty
          ? '<span class="state dirty"><span class="pt"></span>未保存</span>'
          : '<span class="state"><span class="pt"></span>已保存</span>')
        : '';
    }
    var mr = $('#mRevert'), msv = $('#mSave');
    if (mr && msv) {
      var dis = !(UI.mode === 'edit' && UI.dirty);
      mr.disabled = dis;
      msv.disabled = dis;
    }
  }

  /* ---------- 总渲染 ---------- */
  function renderAll() {
    // 查看模式没有「文本」页签，停留在这里时回落到「属性」
    if (UI.mode === 'view' && UI.tab === 'text') UI.tab = 'attr';
    renderChips();
    renderList();
    renderCenter();
    renderInspector();
    renderStatus();
    renderMobile();
    $('#tabView').classList.toggle('on', UI.mode === 'view');
    $('#tabEdit').classList.toggle('on', UI.mode === 'edit');
    $$('#viewSeg button').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-view') === UI.view);
    });
    $$('#insTabs button').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-tab') === UI.tab);
    });
  }
  function renderSiblings() {
    // 输入时不重绘右栏，避免失焦
    renderList();
    renderCenter();
    renderStatus();
  }

  /* ---------- 选择 ---------- */
  function canLeave() {
    if (UI.mode === 'edit' && UI.dirty) {
      toast('请先保存或还原当前修改');
      return false;
    }
    return true;
  }
  function selectCard(id, opts) {
    opts = opts || {};
    if (id !== UI.sel && !opts.force && !canLeave()) return;
    UI.sel = id;
    UI.dirty = false;
    UI.snap = null;
    if (UI.mode === 'edit') UI.snap = current() ? clone(current()) : null;
    if (opts.mview) UI.mview = opts.mview;   // 移动端：点卡即跳详情
    renderAll();
  }

  /* ---------- 编辑 ---------- */
  function enterEdit() {
    if (!current() || UI.mode === 'edit') return;
    UI.mode = 'edit';
    UI.snap = clone(current());
    UI.dirty = false;
    UI.tab = 'attr';
    UI.mview = 'ins';   // 移动端：进入编辑即切到详情视图
    renderAll();
  }
  function leaveEdit() {
    if (UI.mode !== 'edit') return;
    if (UI.dirty) {
      // 允许直接返回查看，但要明确确认（避免误丢修改）
      if (!window.confirm('当前修改尚未保存，放弃修改并返回查看？')) return;
      var i = Store.indexOf(UI.sel);
      if (i >= 0 && UI.snap) Store.cards[i] = clone(UI.snap);
      UI.dirty = false;
    }
    UI.mode = 'view';
    UI.snap = null;
    if (UI.tab === 'text') UI.tab = 'attr';   // 查看态没有文本页签
    renderAll();
  }
  function markDirty() {
    if (UI.dirty) return;
    UI.dirty = true;
    var st = $('#insState');
    if (st) st.innerHTML = '<span class="state dirty"><span class="pt"></span>未保存</span>';
    if (UI.mode === 'edit') renderFoot();
    renderMobile();
    renderStatus();
  }
  function updatePreview(c) {
    var pv = $('.pv');
    if (!pv) return;
    var lv = LEVEL_ART[c.level] || LEVEL_ART.I;
    var fr = $('.frame', pv);
    if (fr) fr.classList.toggle('deriv', isDeriv(c));
    var bg = $('img.bg', pv);
    if (bg) bg.src = window.__IMG__[lv];
    var artEl = $('img.art', pv);
    if (artEl) artEl.src = artSrc(c);
    var nm = $('.nm', pv);
    if (nm) nm.innerHTML = renderRichText(c.name);
    var map = { atk: c.atk, hp: c.hp, pr: c.price, ex: c.extra };
    Object.keys(map).forEach(function (k) {
      var el = $('.v.' + k, pv);
      if (!el) return;
      var t = map[k] == null ? '' : String(map[k]);
      el.textContent = t;
      var pure = /^[0-9]+$/.test(t);
      el.classList.toggle('px', pure);
      el.classList.toggle('tx', !pure);
      el.classList.toggle('m', t.length > 1);
    });
    // 衍生物卡面没有留空槽：结构差异交给随后的 renderAll 重建，
    // 这里先隐藏，避免切换等级瞬间闪现旧数值。
    var exEl = $('.v.ex', pv);
    if (exEl && isDeriv(c)) exEl.style.visibility = 'hidden';
    // 查看态注脚（编辑态渲染的是 .pv-sub 输入框，不需要后台改写）
    var meta = $('.pv-meta');
    if (meta) {
      var sv = subOf(c).trim();
      meta.textContent = sv;
      meta.style.display = sv ? '' : 'none';
    }
    var np = $('#namePreview');
    if (np) np.innerHTML = '预览：' + renderRichText(c.name);
    var desc = $('.desc .body');
    if (desc) {
      var t = (c.text || '').trim();
      // 用富文本渲染，使范围标记实时显示为图形
      desc.innerHTML = t ? renderRichText(c.text) : esc('（未填写牌效）');
      desc.classList.toggle('placeholder', !t);
    }
    // 编辑模式下的文本预览行
    var tp = $('#textPreview');
    if (tp) {
      var tt = (c.text || '').trim();
      tp.innerHTML = tt ? '预览：' + renderRichText(c.text) : '预览：（空）';
    }
  }
  function onFieldInput(el) {
    var c = current();
    if (!c || UI.mode !== 'edit') return;
    var f = el.getAttribute('data-f');
    if (!f) return;
    var v = el.value;
    if (f === 'tags') c.tags = parseTags(v);
    else if (f === 'growth') c.growth = Math.max(0, Math.min(9, parseInt(v, 10) || 0));
    else if (f === 'name') c.name = v.slice(0, 48);
    else if (f === 'sub') c.sub = v.slice(0, 40);
    else if (f === 'by') c.by = v.slice(0, 24);
    else c[f] = v;
    markDirty();
    updatePreview(c);
    renderSiblings();
  }
  function saveCard() {
    var c = current();
    if (!c) return;
    if (!String(c.name || '').trim()) { toast('请填写卡牌名称'); return; }
    c.upd = todayStr();
    if (UI.snap) Store.log('update', c.id, c.name, UI.snap, c);
    UI.snap = clone(c);
    UI.dirty = false;
    Store.persist();
    renderAll();
    toast('已保存「' + c.name + '」');
  }
  function revertCard() {
    if (!UI.snap || !current()) return;
    var i = Store.indexOf(UI.sel);
    Store.cards[i] = clone(UI.snap);
    UI.dirty = false;
    renderAll();
    toast('已还原更改');
  }

  /* ---------- 新建 / 复制 / 删除 ---------- */
  function newCard() {
    if (!canLeave()) return;
    var id = uid('card');
    var card = {
      id: id, name: '新卡牌', sub: '', atk: '0', hp: '1', price: '0', extra: '',
      level: 'I', type: '攻击', growth: 1, art: 'potato',
      text: '', idea: '', tags: [], by: 'SnN', ver: 'v0.1', upd: todayStr()
    };
    Store.cards.unshift(card);
    Store.log('create', card.id, card.name, null, card);
    Store.persist();
    UI.sel = id; UI.mode = 'edit'; UI.snap = clone(card); UI.dirty = false; UI.tab = 'attr';
    UI.mview = 'ins';
    UI.q = ''; $('#search').value = '';
    renderAll();
    toast('已创建「新卡牌」');
  }
  function dupCard() {
    var c = current();
    if (!c || !canLeave()) return;
    var cp = clone(c);
    cp.id = uid('card');
    cp.name = (c.name + ' 副本').slice(0, 12);
    cp.upd = todayStr();
    cp.src = c.src;
    var i = Store.indexOf(c.id);
    Store.cards.splice(i + 1, 0, cp);
    Store.log('create', cp.id, cp.name, null, cp);
    Store.persist();
    UI.sel = cp.id;
    UI.snap = UI.mode === 'edit' ? clone(cp) : null;
    UI.dirty = false;
    renderAll();
    toast('已复制为「' + cp.name + '」');
  }
  function delCard() {
    var c = current();
    if (!c || !canLeave()) return;
    if (!confirm('确定删除「' + c.name + '」？此操作不可撤销。')) return;
    var i = Store.indexOf(c.id);
    Store.log('delete', c.id, c.name, clone(c), null);
    Store.cards.splice(i, 1);
    Store.persist();
    var next = Store.cards[i] || Store.cards[i - 1] || Store.cards[0] || null;
    UI.sel = next ? next.id : null;
    UI.snap = null; UI.dirty = false;
    renderAll();
    toast('已删除');
  }

  /* ---------- 暴露给第二部分 ---------- */
  window.__POTATO__ = {
    LEVES: LEVELS, LEVELS: LEVELS, TYPES: TYPES, DERIV: DERIV, isDeriv: isDeriv,
    APP_VER: APP_VER,
    $: $, $$: $$, clone: clone, esc: esc, nowIso: nowIso, stamp: stamp,
    todayStr: todayStr, uid: uid, hashCard: hashCard, parseTags: parseTags,
    toast: toast, Store: Store, UI: UI,
    renderAll: renderAll, renderSiblings: renderSiblings,
    renderMobile: renderMobile,
    current: current, selectCard: selectCard,
    frameHTML: frameHTML,
    enterEdit: enterEdit, leaveEdit: leaveEdit, saveCard: saveCard,
    revertCard: revertCard, newCard: newCard, dupCard: dupCard, delCard: delCard,
    onFieldInput: onFieldInput,
    // 富文本
    renderRichText: renderRichText, serializeRich: serializeRich, richPlain: richPlain,
    onRichInput: onRichInput, applyRichCmd: applyRichCmd, setRichField: setRichField,
    // 卡图
    artSrc: artSrc, pickArt: pickArt, resetArt: resetArt, loadArt: loadArt,
    // 范围图形
    stripRangeMarks: stripRangeMarks,
    openRangePicker: openRangePicker, insertRangeMark: insertRangeMark,
    rangeGlyphHTML: rangeGlyphHTML, rangeGridToMask: rangeGridToMask,
    rangeMaskToGrid: rangeMaskToGrid, RANGE_PRESETS: RANGE_PRESETS,
    // 弹窗（part2 复用，避免重复定义）
    openModalBound: openModal, closeModalBound: closeModal
  };
})();
