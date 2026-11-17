/* ==========================================================================
   旅程網站 ── 介面程式
   所有內容都由 data/trip.js（window.TRIP）讀取；更新內容唔使改呢個檔。
   ========================================================================== */
(function () {
  'use strict';

  // ------------------------------------------------------------ constants
  var TZ_MS = 8 * 60 * 60 * 1000; // Asia/Taipei = UTC+8 (no daylight saving)
  var PREFIX = 'tpe26:';
  var TABS = ['itinerary', 'food', 'checklist', 'info'];
  var LANES = ['runner', 'cheer'];
  var WD = '日一二三四五六';
  var TYPES = {
    transport: { label: '交通', icon: 'train' },
    sight: { label: '景點', icon: 'camera' },
    food: { label: '美食', icon: 'bowl' },
    shopping: { label: '購物', icon: 'bag' },
    hotel: { label: '酒店', icon: 'bed' },
    race: { label: '比賽', icon: 'flag' },
    onsen: { label: '溫泉', icon: 'onsen' },
  };
  var THEMES = {
    auto: { label: '跟隨系統', icon: 'auto' },
    light: { label: '淺色', icon: 'sun' },
    dark: { label: '深色', icon: 'moon' },
  };

  // ------------------------------------------------------------ helpers
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  // escape, then highlight every "待確認" so unverified details stand out wherever they appear
  function rich(v) { return esc(v).replace(/待確認/g, '<mark class="tbc-inline">待確認</mark>'); }
  function arr(v) { return v == null || v === '' ? [] : Array.isArray(v) ? v : [v]; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function icon(name, cls) {
    return '<svg class="i' + (cls ? ' ' + cls : '') + '" aria-hidden="true"><use href="#i-' + name + '"></use></svg>';
  }
  function mapsUrl(q) {
    return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);
  }
  function uniq(list) {
    var seen = {};
    return list.filter(function (x) { if (!x || seen[x._id]) return false; seen[x._id] = 1; return true; });
  }
  function cssEsc(v) {
    return window.CSS && CSS.escape ? CSS.escape(v) : String(v).replace(/["\\]/g, '\\$&');
  }

  // ------------------------------------------------------------ keep focus across re-renders
  // Re-rendering replaces the focused button; find its replacement by the same data-* attributes
  // so keyboard and screen-reader users keep their place.
  var FOCUS_ATTRS = ['data-day', 'data-group', 'data-f', 'data-v', 'data-mark', 'data-food', 'data-jump',
    'data-today', 'data-reset-checks', 'data-print', 'data-taxi', 'data-copy', 'data-check'];
  function focusKey() {
    var a = document.activeElement;
    if (!a || a === document.body || !a.closest) return null;
    var scope = a.closest('.side-status') ? '.side-status' : a.closest('#main') ? '#main' : null;
    if (!scope) return null;
    var sel = FOCUS_ATTRS.filter(function (k) { return a.hasAttribute(k); }).map(function (k) {
      var v = a.getAttribute(k);
      return v ? '[' + k + '="' + cssEsc(v) + '"]' : '[' + k + ']';
    }).join('');
    return sel ? scope + ' ' + sel : null;
  }
  function focusQuietly(el) {
    try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
  }
  function restoreFocus(key) {
    if (!key) return;
    var a = document.activeElement;
    if (a && a !== document.body && document.contains(a)) return; // focus is still somewhere sensible
    var el = document.querySelector(key);
    if (el) focusQuietly(el);
  }
  // move focus to a card the user just jumped to (programmatically focusable only while focused)
  function focusTarget(el) {
    if (!el) return;
    el.setAttribute('tabindex', '-1');
    el.addEventListener('blur', function () { el.removeAttribute('tabindex'); }, { once: true });
    focusQuietly(el);
  }

  // ------------------------------------------------------------ screen-reader announcements
  // One always-rendered, visually hidden role="status" region (a live region that is display:none
  // when its text changes is not reliably announced).
  var lastAnnounce = '', announceTimer = null;
  function announcer() {
    var el = document.getElementById('announcer');
    if (!el) { // an older cached index.html has no announcer
      el = document.createElement('p');
      el.id = 'announcer'; el.className = 'visually-hidden'; el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    // visually hidden inline as well, so it holds even if an older cached style.css is in use
    el.style.cssText = 'position:absolute;width:1px;height:1px;margin:-1px;padding:0;border:0;overflow:hidden;' +
      'clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;';
    return el;
  }
  // index.html keeps the old live-region attributes on the toast and the offline bar (for an older
  // cached app.js); this code announces through the announcer instead, so drop them here.
  function setupAnnouncer() {
    announcer();
    ['toast', 'netbar'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) { el.removeAttribute('role'); el.removeAttribute('aria-live'); }
    });
  }
  function announce(msg) {
    var el = announcer();
    // VoiceOver skips a message identical to the previous one: make a repeat differ invisibly
    var m = msg === lastAnnounce ? msg + '\u00A0' : msg;
    lastAnnounce = m;
    el.textContent = '';
    clearTimeout(announceTimer);
    requestAnimationFrame(function () { el.textContent = m; });
    announceTimer = setTimeout(function () { el.textContent = ''; }, 7000);
  }

  // ------------------------------------------------------------ storage (never throws)
  var memory = {};
  var store = {
    get: function (key, fallback) {
      if (Object.prototype.hasOwnProperty.call(memory, key)) return memory[key];
      try {
        var raw = window.localStorage.getItem(PREFIX + key);
        return raw == null ? fallback : JSON.parse(raw);
      } catch (e) { return fallback; }
    },
    set: function (key, value) {
      memory[key] = value;
      try {
        if (value == null) window.localStorage.removeItem(PREFIX + key);
        else window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
      } catch (e) { /* storage unavailable: keep in memory for this visit */ }
    },
  };

  // ------------------------------------------------------------ time (always Asia/Taipei)
  // ?now=2026-12-20T08:30 simulates a Taipei-local time (for checking the now/next view).
  var loadedAt = Date.now();
  var simulated = parseSim(new URLSearchParams(location.search).get('now'));
  function parseSim(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2}))?$/.exec(s || '');
    if (!m) return null;
    return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)) - TZ_MS;
  }
  function nowMs() { return simulated != null ? simulated + (Date.now() - loadedAt) : Date.now(); }
  function tpe(ms) {
    var d = new Date(ms + TZ_MS);
    return {
      date: d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()),
      min: d.getUTCHours() * 60 + d.getUTCMinutes(),
      hm: pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()),
    };
  }
  function dateParts(date) { var p = String(date).split('-'); return { y: +p[0], m: +p[1], d: +p[2] }; }
  function dateMs(date, min) { var p = dateParts(date); return Date.UTC(p.y, p.m - 1, p.d) - TZ_MS + (min || 0) * 60000; }
  function weekday(date) { var p = dateParts(date); return WD.charAt(new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay()); }
  function md(date) { var p = dateParts(date); return p.m + '/' + p.d; }
  function mdLong(date) { var p = dateParts(date); return p.m + '月' + p.d + '日'; }
  function parseHM(s) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(s == null ? '' : s).trim());
    return m ? +m[1] * 60 + +m[2] : null;
  }
  function duration(mins) {
    mins = Math.max(0, Math.round(mins));
    var h = Math.floor(mins / 60), m = mins % 60;
    if (!h) return m + ' 分鐘';
    return h + ' 小時' + (m ? ' ' + m + ' 分' : '');
  }

  // ------------------------------------------------------------ data
  var D = null;
  function groupLabel(g) {
    var G = (D && D.T.groups) || {};
    return g === 'runner' ? (G.runner || 'Runner') : g === 'cheer' ? (G.cheer || 'Cheer') : '全部';
  }

  function prepare() {
    var T = window.TRIP;
    if (!T || !Array.isArray(T.days) || !T.days.length) throw new Error('window.TRIP 未載入，或者冇 days');
    var warn = function () { console.warn.apply(console, ['[trip.js]'].concat([].slice.call(arguments))); };
    var stops = {};
    var dateIdx = {};

    var days = T.days.map(function (d, di) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date || '')) warn('第 ' + (di + 1) + ' 日 date 要寫成 YYYY-MM-DD：', d.date);
      dateIdx[d.date] = di;
      var last = 0;
      var items = arr(d.items).map(function (it, ii) {
        var start = parseHM(it.time);
        if (start == null) { warn(d.date + ' 第 ' + (ii + 1) + ' 項 time 格式唔啱（要 HH:MM）：', it.time); start = last; }
        last = start;
        var type = TYPES[it.type] ? it.type : 'sight';
        if (!TYPES[it.type]) warn(d.date + '「' + it.title + '」type 唔認得：', it.type);
        var end = parseHM(it.end);
        var o = Object.assign({}, it, {
          _id: String(it.id || ('d' + (di + 1) + '-' + (ii + 1))),
          _start: start,
          _end: end,
          _startAbs: dateMs(d.date, start),
          // an end at or before the start means the item runs past midnight
          _endAbs: end == null ? null : dateMs(d.date, end) + (end <= start ? 24 * 3600 * 1000 : 0),
          _type: type,
          _group: it.group === 'runner' || it.group === 'cheer' ? it.group : 'all',
          _day: di,
          _order: ii,
        });
        if (stops[o._id]) warn('行程 id 重複：', o._id);
        stops[o._id] = o;
        return o;
      });
      items.sort(function (a, b) { return a._start - b._start || a._order - b._order; });
      return Object.assign({}, d, {
        _i: di,
        items: items,
        _split: items.some(function (x) { return x._group !== 'all'; }),
      });
    });

    var food = arr(T.food).map(function (f, fi) {
      var stop = f.stop ? stops[f.stop] : null;
      if (f.stop && !stop) warn('美食「' + f.name + '」嘅 stop 搵唔到對應行程 id：', f.stop);
      var dayIdx = null;
      if (stop) dayIdx = stop._day;
      else if (typeof f.day === 'number') dayIdx = f.day >= 1 && f.day <= days.length ? f.day - 1 : null;
      else if (f.day) {
        dayIdx = dateIdx[f.day] != null ? dateIdx[f.day] : null;
        if (dayIdx == null) warn('美食「' + f.name + '」嘅 day 唔喺行程日子入面：', f.day);
      }
      return Object.assign({}, f, {
        _id: String(f.id || 'food-' + (fi + 1)),
        _stop: stop,
        _day: dayIdx,
        _order: fi,
        _pick: f.pick === 'organiser' ? 'organiser' : 'suggested',
      });
    });
    food.sort(function (a, b) {
      var da = a._day == null ? 99 : a._day, db = b._day == null ? 99 : b._day;
      return da - db || (a._stop ? a._stop._start : 9999) - (b._stop ? b._stop._start : 9999) || a._order - b._order;
    });
    var foodByStop = {};
    food.forEach(function (f) { if (f._stop) (foodByStop[f._stop._id] = foodByStop[f._stop._id] || []).push(f); });

    var all = [];
    days.forEach(function (d) { all = all.concat(d.items); });
    all.sort(function (a, b) { return a._startAbs - b._startAbs || a._day - b._day || a._order - b._order; });

    // checklist: every item is stored by its permanent id (text and group names can change freely)
    var seenIds = {};
    var checklist = arr(T.checklist).map(function (g, gi) {
      var gname = g.group || g.title || ('第 ' + (gi + 1) + ' 組');
      var items = arr(g.items).map(function (x) { return typeof x === 'string' ? { text: x } : x; })
        .filter(function (x) { return x && x.text; })
        .map(function (x) {
          var key = x.id ? String(x.id) : 'text:' + gname + '/' + x.text;
          if (!x.id) warn('清單項目冇 id（改文字會清走剔號），請加一個：', x.text);
          else if (seenIds[key]) warn('清單 id 重複：', key);
          seenIds[key] = 1;
          return Object.assign({}, x, { _key: key, _legacy: gname + '/' + x.text });
        });
      return { name: gname, items: items };
    });

    D = { T: T, days: days, all: all, food: food, foodByStop: foodByStop, stops: stops, checklist: checklist, rev: revOf(T) };
  }

  // Fingerprint of the trip data, so an open page can tell whether it is showing the newest version.
  function revOf(obj) {
    var s = JSON.stringify(obj) || '', h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36) + '.' + s.length;
  }

  // ------------------------------------------------------------ state
  var state = {
    tab: 'itinerary',
    day: 0,
    dayPickedAt: 0,
    group: 'all',
    foodFilter: { day: 'all', area: 'all', status: 'all' },
  };

  // ------------------------------------------------------------ now / next
  // All comparisons use absolute timestamps (Taipei time), so an item such as
  // 23:00–01:00 stays "current" across midnight and is still shown the next morning.
  function laneLive(lane, now, todayDate) {
    var items = D.all.filter(function (x) { return x._group === 'all' || x._group === lane; });
    var dayEnd = todayDate ? dateMs(todayDate, 24 * 60) : -Infinity;
    var current = null, next = null, past = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (it._startAbs <= now) {
        // no explicit end: runs until the next item in this lane starts, but never past its own day
        var end = it._endAbs;
        if (end == null) {
          end = dateMs(D.days[it._day].date, 24 * 60);
          if (items[i + 1]) end = Math.min(end, items[i + 1]._startAbs);
        }
        if (now < end) { if (current) past.push(current); current = it; }
        else past.push(it);
      } else if (!next && it._startAbs < dayEnd) {
        next = it; // only today's upcoming items; later days get a "聽日" line instead
      }
    }
    return { current: current, next: next, past: past };
  }

  function live() {
    var now = nowMs(), t = tpe(now);
    var days = D.days, first = days[0], last = days[days.length - 1];
    var L = { now: now, t: t, todayIdx: -1, lanes: {} };
    for (var i = 0; i < days.length; i++) if (days[i].date === t.date) L.todayIdx = i;
    LANES.forEach(function (g) { L.lanes[g] = laneLive(g, now, L.todayIdx >= 0 ? t.date : null); });
    var active = LANES.some(function (g) { return L.lanes[g].current; });
    if (t.date < first.date && !active) L.phase = 'before';
    else if (t.date > last.date && !active) L.phase = 'after';
    else L.phase = 'during';
    if (L.phase === 'before') {
      L.targetItem = first.items[0] || null;
      L.target = L.targetItem ? L.targetItem._startAbs : dateMs(first.date, 0);
    }
    return L;
  }

  function lanesShown() { return state.group === 'all' ? LANES : [state.group]; }

  function statusRow(it, kind, L) {
    var t = TYPES[it._type];
    var label = (kind === 'current' ? '而家' : '下一站') + ' · ' + esc(it.timeText || it.time);
    if (it._day !== L.todayIdx) label += '（' + md(D.days[it._day].date) + ' 開始）';
    if (it._group !== 'all') label += ' · ' + esc(groupLabel(it._group));
    if (kind === 'next') label += ' · <span class="sr-eta">仲有 ' + duration((it._startAbs - L.now) / 60000) + '</span>';
    return '<button type="button" class="status-row is-' + kind + '" data-jump="' + esc(it._id) + '">' +
      '<span class="dot dot-sm" data-type="' + it._type + '">' + icon(t.icon) + '</span>' +
      '<span class="sr-body"><span class="sr-label">' + label + '</span>' +
      '<span class="sr-title">' + esc(it.title) + '</span></span>' +
      icon('chevron', 'sr-go') + '</button>';
  }

  function statusHTML(L) {
    var days = D.days;
    if (L.phase === 'before') {
      var diff = Math.max(0, L.target - L.now);
      var dd = Math.floor(diff / 864e5), hh = Math.floor((diff % 864e5) / 36e5), mm = Math.floor((diff % 36e5) / 6e4);
      var big = dd >= 1
        ? '<b>' + dd + '</b><span>日</span><b>' + hh + '</b><span>小時</span>'
        : '<b>' + hh + '</b><span>小時</span><b>' + mm + '</b><span>分</span>';
      var it = L.targetItem;
      return '<div class="status status-cd">' +
        '<p class="status-kicker">出發倒數</p>' +
        '<p class="cd-big">' + big + '</p>' +
        '<p class="status-sub">' + mdLong(days[0].date) + '（' + weekday(days[0].date) + '）' +
        (it ? ' ' + esc(it.time) + ' · ' + esc(it.title) : '') + '</p></div>';
    }
    if (L.phase === 'after') {
      return '<div class="status status-done"><p class="status-kicker">旅程完結</p>' +
        '<p class="status-title">一路順風，下次再約！</p></div>';
    }
    var head = '<p class="status-kicker"><span class="pulse" aria-hidden="true"></span>而家 ' + L.t.hm +
      (L.todayIdx >= 0 ? ' · 第 ' + (L.todayIdx + 1) + ' 日 ' + md(days[L.todayIdx].date) + '（' + weekday(days[L.todayIdx].date) + '）' : '') + '</p>';
    var shown = lanesShown();
    var cur = uniq(shown.map(function (g) { return L.lanes[g].current; }));
    var nxt = uniq(shown.map(function (g) { return L.lanes[g].next; }));
    var rows = cur.map(function (x) { return statusRow(x, 'current', L); });
    var startedToday = L.todayIdx >= 0 && days[L.todayIdx].items.some(function (x) {
      return (x._group === 'all' || shown.indexOf(x._group) >= 0) && x._startAbs <= L.now;
    });
    if (!cur.length) rows.push('<p class="status-gap">' + (!nxt.length ? '今日行程已完成' : startedToday ? '移動中／自由時間' : '今日行程未開始') + '</p>');
    rows = rows.concat(nxt.map(function (x) { return statusRow(x, 'next', L); }));
    if (!nxt.length && L.todayIdx >= 0 && L.todayIdx < days.length - 1) {
      var tmr = days[L.todayIdx + 1].items.filter(function (x) { return x._group === 'all' || shown.indexOf(x._group) >= 0; })[0];
      if (tmr) rows.push('<p class="status-gap">聽日 ' + esc(tmr.time) + ' · ' + esc(tmr.title) + '</p>');
    }
    var back = state.tab === 'itinerary' && L.todayIdx >= 0 && state.day !== L.todayIdx
      ? '<button type="button" class="btn btn-sm status-back" data-today>返去今日行程</button>' : '';
    return '<div class="status status-live">' + head + '<div class="status-rows">' + rows.join('') + '</div>' + back + '</div>';
  }

  function applyLive(L) {
    $$('.stop').forEach(function (el) {
      el.classList.remove('is-current', 'is-next', 'is-past');
      var b = $('.live-badge', el);
      if (b) { b.hidden = true; b.textContent = ''; }
    });
    if (state.tab !== 'itinerary' || L.phase !== 'during') return;
    var cur = {}, nxt = {}, past = {};
    lanesShown().forEach(function (g) {
      var ln = L.lanes[g];
      if (ln.current) cur[ln.current._id] = 1;
      if (ln.next) nxt[ln.next._id] = 1;
      ln.past.forEach(function (x) { past[x._id] = 1; });
    });
    // "已過" only on today's page (a previous day would be all 已過); current/next wherever they appear
    var isToday = L.todayIdx === state.day;
    $$('.stop').forEach(function (el) {
      var id = el.getAttribute('data-id'), b = $('.live-badge', el);
      var mark = cur[id] ? ['is-current', '而家'] : nxt[id] ? ['is-next', '下一站'] : past[id] && isToday ? ['is-past', '已過'] : null;
      if (!mark) return;
      el.classList.add(mark[0]);
      if (b) { b.hidden = false; b.textContent = mark[1]; }
    });
  }

  var lastSig = '';
  var lastToday = null;
  function updateLive(force) {
    if (!D) return;
    var L = live();
    if (lastToday !== null && L.todayIdx !== lastToday && L.todayIdx >= 0 && Date.now() - state.dayPickedAt > 10 * 60000) {
      state.day = L.todayIdx; // the date rolled over: follow today
      lastToday = L.todayIdx;
      render();
      return;
    }
    lastToday = L.todayIdx;
    var ids = LANES.map(function (g) {
      var ln = L.lanes[g];
      return (ln.current ? ln.current._id : '-') + '>' + (ln.next ? ln.next._id : '-');
    }).join(',');
    var sig = [L.phase, L.todayIdx, ids, Math.floor(L.now / 60000), state.group, state.day, state.tab].join('|');
    if (!force && sig === lastSig) return;
    lastSig = sig;
    var html = statusHTML(L);
    $$('[data-status]').forEach(function (el) {
      if (el.__html === html) return; // unchanged: leave the DOM (and any focus inside it) alone
      var fk = el.contains(document.activeElement) ? focusKey() : null;
      el.innerHTML = html;
      el.__html = html;
      restoreFocus(fk);
    });
    applyLive(L);
  }

  // ------------------------------------------------------------ shared bits
  function mapList(m, fallback) {
    if (m === false || m === null || m === '') return [];
    if (m === undefined) m = fallback;
    return arr(m).map(function (x) {
      return typeof x === 'string' ? { label: x, q: x } : { label: x.label || x.q, q: x.q || x.label };
    }).filter(function (x) { return x.q; });
  }
  function navButtons(list, name) {
    return list.map(function (x) {
      var text = list.length === 1 ? '導航' : esc(x.label);
      return '<a class="btn btn-nav" href="' + esc(mapsUrl(x.q)) + '" target="_blank" rel="noopener" aria-label="導航：' + esc(name && list.length === 1 ? name : x.label) + '">' +
        icon('nav') + '<span>' + text + '</span></a>';
    }).join('');
  }
  function linksHTML(links) {
    var list = arr(links).filter(function (x) { return x && x.url; });
    return list.length ? '<ul class="links" role="list">' + list.map(function (x) {
      return '<li><a href="' + esc(x.url) + '" target="_blank" rel="noopener">' + esc(x.label || x.url) + icon('external') + '</a></li>';
    }).join('') + '</ul>' : '';
  }
  function textOf(x) { return typeof x === 'string' ? { text: x } : (x || {}); }
  function tag(cls, text) { return '<span class="tag ' + cls + '">' + text + '</span>'; }
  function tbcBlock(tbc) {
    return typeof tbc === 'string' && tbc ? '<p class="tbc-note">' + icon('alert') + '<span>' + esc(tbc) + '</span></p>' : '';
  }
  function segHTML() {
    return '<div class="seg-wrap"><span class="seg-label">顯示</span><div class="seg" role="group" aria-label="揀組別">' +
      ['all', 'runner', 'cheer'].map(function (g) {
        var on = state.group === g;
        return '<button type="button" class="seg-btn' + (on ? ' is-on' : '') + '" data-group="' + g + '" aria-pressed="' + on + '">' +
          (g === 'all' ? '全部' : icon(g === 'runner' ? 'flag' : 'megaphone') + esc(groupLabel(g))) + '</button>';
      }).join('') + '</div></div>';
  }
  function foodMarks() { var m = store.get('food', {}); return m && typeof m === 'object' ? m : {}; }
  var MARK_LABEL = { want: '想食', done: '食咗' };

  // ------------------------------------------------------------ view: itinerary
  function timeText(it) { return it.timeText || (it.time + (it.end ? '–' + it.end : '')); }

  // level: heading level for the stop title (3 in the day timeline, 4 inside a runner/cheer lane)
  function stopHTML(it, level) {
    var hl = level === 4 ? 'h4' : 'h3';
    var t = TYPES[it._type];
    var tags = [];
    if (it._group !== 'all') tags.push(tag('tag-' + it._group, esc(groupLabel(it._group))));
    if (it.source === 'suggested') tags.push(tag('tag-suggest', '建議'));
    if (it.tbc) tags.push(tag('tag-tbc', '待確認'));
    var foods = D.foodByStop[it._id] || [];
    var maps = mapList(it.map, it.title);
    return '<li class="stop" data-type="' + it._type + '" data-id="' + esc(it._id) + '" id="stop-' + esc(it._id) + '">' +
      '<div class="stop-rail"><span class="dot" title="' + t.label + '">' + icon(t.icon) + '</span></div>' +
      '<article class="stop-card">' +
        '<header class="stop-head"><span class="stop-time">' + esc(timeText(it)) + '</span>' +
        '<span class="live-badge" hidden></span>' +
        '<span class="stop-type">' + t.label + (it.area ? ' · ' + esc(it.area) : '') + '</span></header>' +
        '<' + hl + ' class="stop-title">' + esc(it.title) + '</' + hl + '>' +
        (tags.length ? '<div class="tags">' + tags.join('') + '</div>' : '') +
        (it.route ? '<p class="stop-route">' + icon('train') + '<span><b>前往</b>' + rich(it.route) + '</span></p>' : '') +
        (it.notes ? '<p class="stop-notes">' + rich(it.notes) + '</p>' : '') +
        tbcBlock(it.tbc) +
        linksHTML(it.links) +
        (foods.length ? foodInlineHTML(foods, '美食') : '') +
        (maps.length ? '<div class="actions">' + navButtons(maps, it.title) + '</div>' : '') +
      '</article></li>';
  }

  // a food entry is unconfirmed if it has a tbc reason or any field says 待確認
  function hasTbc(f) {
    if (f.tbc) return true;
    return ['order', 'price', 'hours', 'closed', 'address', 'notes'].some(function (k) {
      return typeof f[k] === 'string' && f[k].indexOf('待確認') >= 0;
    });
  }

  function foodInlineHTML(foods, heading) {
    var marks = foodMarks();
    return '<div class="stop-food"><p class="sf-head">' + icon('bowl') + esc(heading) + '</p><ul role="list">' +
      foods.map(function (f) {
        var mk = marks[f._id];
        var m = mapList(f.map, f.name)[0];
        return '<li class="sf-item" data-food-id="' + esc(f._id) + '">' +
          '<a class="sf-main" href="#food/' + encodeURIComponent(f._id) + '">' +
            '<span class="sf-name">' + esc(f.name) +
            (f._pick === 'organiser' ? '<svg class="i sf-star" role="img" aria-label="主辦推介"><use href="#i-star"></use></svg>' : '') +
            (hasTbc(f) ? tag('tag-tbc sf-tbc', '待確認') : '') + '</span>' +
            (f.order ? '<span class="sf-order">' + rich(f.order) + '</span>' : '') +
          '</a>' +
          '<span class="sf-mark' + (mk ? ' is-' + mk : '') + '">' + (mk ? MARK_LABEL[mk] : '') + '</span>' +
          (m ? '<a class="icon-btn" href="' + esc(mapsUrl(m.q)) + '" target="_blank" rel="noopener" aria-label="導航：' + esc(f.name) + '">' + icon('nav') + '</a>' : '') +
          '</li>';
      }).join('') + '</ul></div>';
  }

  function splitHTML(run) {
    var first = run[0];
    return '<li class="split"><div class="split-head">' + icon('fork') + '<span>分頭行動</span>' +
      '<span class="split-time">' + esc(first.time) + ' 起</span></div><div class="lanes">' +
      LANES.map(function (g) {
        var items = run.filter(function (x) { return x._group === g; });
        return '<section class="lane lane-' + g + '"><h3 class="lane-head">' + icon(g === 'runner' ? 'flag' : 'megaphone') +
          esc(groupLabel(g)) + '</h3>' +
          (items.length ? '<ol class="timeline" role="list">' + items.map(function (x) { return stopHTML(x, 4); }).join('') + '</ol>' : '<p class="lane-empty">跟大隊行程</p>') +
          '</section>';
      }).join('') + '</div></li>';
  }

  function timelineHTML(day) {
    var out = [], items = day.items, i = 0;
    while (i < items.length) {
      if (items[i]._group === 'all') { out.push(stopHTML(items[i++])); continue; }
      var run = [];
      while (i < items.length && items[i]._group !== 'all') run.push(items[i++]);
      if (state.group === 'all') { out.push(splitHTML(run)); continue; }
      var mine = run.filter(function (x) { return x._group === state.group; });
      var others = run.length - mine.length;
      mine.forEach(function (x) { out.push(stopHTML(x)); });
      if (others) {
        out.push('<li class="hidden-note">' + icon('fork') + '<span>' + esc(groupLabel(state.group === 'runner' ? 'cheer' : 'runner')) +
          '同時有另一套安排（' + others + ' 項）</span><button type="button" class="btn btn-sm" data-group="all">顯示全部</button></li>');
      }
    }
    return '<ol class="timeline" role="list">' + out.join('') + '</ol>';
  }

  function daybarHTML(L) {
    return '<div class="daybar" role="group" aria-label="揀日子">' + D.days.map(function (d) {
      var on = d._i === state.day;
      var today = L.phase === 'during' && L.todayIdx === d._i;
      return '<button type="button" class="daychip' + (on ? ' is-active' : '') + (today ? ' is-today' : '') +
        '" data-day="' + d._i + '" aria-pressed="' + on + '">' +
        '<span class="dc-top"><span class="dc-date">' + md(d.date) + '</span><span class="dc-wd">' + weekday(d.date) + '</span>' +
        (today ? '<span class="dc-today">今日</span>' : '') + '</span>' +
        '<span class="dc-title">' + esc(d.title || '') + '</span></button>';
    }).join('') + '</div>';
  }

  function renderItinerary() {
    var L = live();
    var day = D.days[state.day];
    var rem = arr(day.reminders);
    var sug = arr(day.suggestions);
    var loose = D.food.filter(function (f) { return f._day === day._i && !f._stop; });
    var html = '';
    html += '<div class="status-inline" data-status></div>';
    html += daybarHTML(L);
    html += '<div class="day-layout">';
    html += '<header class="day-head"><div><p class="dh-kicker">第 ' + (day._i + 1) + ' 日 · DAY ' + (day._i + 1) + '</p>' +
      '<h2 class="dh-title"><span>' + mdLong(day.date) + '</span><span class="dh-wd">星期' + weekday(day.date) + '</span></h2>' +
      (day.title ? '<p class="dh-sub">' + esc(day.title) + '</p>' : '') + '</div>' +
      '<button type="button" class="btn btn-sm print-btn" data-print>' + icon('print') + '<span>列印全部行程</span></button></header>';
    if (day._split) html += '<div class="day-seg">' + segHTML() + '</div>';
    html += '<div class="day-timeline">' + timelineHTML(day) + '</div>';
    html += '<aside class="day-aside">';
    var alerts = arr(day.alerts).map(textOf);
    if (alerts.length) {
      html += '<div class="day-alerts">' + alerts.map(function (a) {
        return '<section class="alert">' + icon('alert') + '<div>' + (a.title ? '<h3>' + esc(a.title) + '</h3>' : '') +
          '<p>' + rich(a.text) + '</p>' + linksHTML(a.links) + '</div></section>';
      }).join('') + '</div>';
    }
    if (rem.length) {
      html += '<section class="callout callout-warn day-notes">' + icon('alert') + '<div><h3>重要提醒</h3><ul>' +
        rem.map(function (r) { r = textOf(r); return '<li>' + rich(r.text) + linksHTML(r.links) + '</li>'; }).join('') + '</ul></div></section>';
    }
    if (loose.length) html += '<section class="day-extra panel">' + foodInlineHTML(loose, '當日其他美食') + '</section>';
    if (sug.length) {
      html += '<details class="suggest day-extra"' + (window.matchMedia('(min-width: 1024px)').matches ? ' open' : '') + '>' +
        '<summary>' + icon('bulb') + icon('chevron', 'sum-chev') + '<span>研究建議<small>未納入行程，供主辦人參考</small></span><span class="count">' + sug.length + '</span></summary><ul>' +
        sug.map(function (s) {
          var o = typeof s === 'string' ? { text: s } : s;
          return '<li><p>' + rich(o.text) + '</p>' + (o.why ? '<p class="why">' + rich(o.why) + '</p>' : '') + '</li>';
        }).join('') + '</ul></details>';
    }
    html += '</aside></div>';
    return html;
  }

  // ------------------------------------------------------------ view: food
  function renderFood() {
    var F = state.foodFilter, marks = foodMarks();
    var areas = [];
    D.food.forEach(function (f) { if (f.area && areas.indexOf(f.area) < 0) areas.push(f.area); });
    if (F.area !== 'all' && areas.indexOf(F.area) < 0) F.area = 'all';
    var hasLoose = D.food.some(function (f) { return f._day == null; });
    var list = D.food.filter(function (f) {
      if (F.day === 'none' ? f._day != null : F.day !== 'all' && f._day !== +F.day) return false;
      if (F.area !== 'all' && f.area !== F.area) return false;
      var mk = marks[f._id];
      if (F.status === 'want' && mk !== 'want') return false;
      if (F.status === 'done' && mk !== 'done') return false;
      if (F.status === 'organiser' && f._pick !== 'organiser') return false;
      if (F.status === 'suggested' && f._pick !== 'suggested') return false;
      return true;
    });
    var nWant = 0, nDone = 0;
    D.food.forEach(function (f) { if (marks[f._id] === 'want') nWant++; if (marks[f._id] === 'done') nDone++; });

    function chips(key, opts) {
      return '<div class="chips" role="group" aria-labelledby="fl-' + key + '">' + opts.map(function (o) {
        var on = String(F[key]) === String(o[0]);
        return '<button type="button" class="chip' + (on ? ' is-on' : '') + '" data-f="' + key + '" data-v="' + esc(o[0]) + '" aria-pressed="' + on + '">' + o[1] + '</button>';
      }).join('') + '</div>';
    }
    var dayOpts = [['all', '全部日子']].concat(D.days.map(function (d) { return [d._i, md(d.date) + ' ' + weekday(d.date)]; }));
    if (hasLoose) dayOpts.push(['none', '未分日']);
    var areaOpts = [['all', '全部地區']].concat(areas.map(function (a) { return [a, esc(a)]; }));
    var statusOpts = [['all', '全部'], ['want', '想食'], ['done', '食咗'], ['organiser', '主辦推介'], ['suggested', '建議']];

    var html = '<header class="view-head"><p class="dh-kicker">FOOD</p><h2 class="view-title">美食清單</h2>' +
      '<p class="view-sub">共 ' + D.food.length + ' 間 · 想食 ' + nWant + ' · 食咗 ' + nDone + '</p></header>';
    html += '<div class="filters">' +
      '<div class="filter-row"><span class="filter-label" id="fl-day">日子</span>' + chips('day', dayOpts) + '</div>' +
      '<div class="filter-row"><span class="filter-label" id="fl-area">地區</span>' + chips('area', areaOpts) + '</div>' +
      '<div class="filter-row"><span class="filter-label" id="fl-status">標記</span>' + chips('status', statusOpts) + '</div></div>';
    if (!list.length) html += '<p class="empty">冇符合篩選條件嘅美食。</p>';
    html += '<div class="food-grid">' + list.map(function (f) { return foodCardHTML(f, marks[f._id]); }).join('') + '</div>';
    return html;
  }

  function foodCardHTML(f, mk) {
    var facts = [['必點', f.order], ['價錢', f.price], ['營業時間', f.hours], ['休息日', f.closed], ['地址', f.address]]
      .filter(function (x) { return x[1]; })
      .map(function (x) { return [x[0], rich(x[1])]; });
    if (f.phone) facts.push(['電話', '<a href="tel:' + esc(String(f.phone).replace(/[^\d+]/g, '')) + '">' + esc(f.phone) + '</a>']);
    var m = mapList(f.map, f.name);
    var meta = [];
    if (f.area) meta.push(esc(f.area));
    if (f._day != null) meta.push(md(D.days[f._day].date) + '（' + weekday(D.days[f._day].date) + '）');
    var link = f._stop ? '<a class="fc-stop" href="#itinerary" data-jump="' + esc(f._stop._id) + '">' + icon('route') + '行程：' + esc(f._stop.title) + '</a>' : '';
    return '<article class="food-card' + (mk ? ' is-' + mk : '') + '" id="food-' + esc(f._id) + '" data-food-id="' + esc(f._id) + '">' +
      '<header class="fc-head"><h3 class="fc-name">' + esc(f.name) + '</h3>' +
      (f._pick === 'organiser' ? tag('tag-pick', icon('star') + '主辦推介') : tag('tag-suggest', '建議')) + '</header>' +
      (meta.length ? '<p class="fc-meta">' + meta.join(' · ') + '</p>' : '') +
      (facts.length ? '<dl class="fc-facts">' + facts.map(function (x) { return '<div><dt>' + x[0] + '</dt><dd>' + x[1] + '</dd></div>'; }).join('') + '</dl>' : '') +
      (f.notes ? '<p class="fc-notes">' + rich(f.notes) + '</p>' : '') +
      (hasTbc(f) ? '<div class="tags">' + tag('tag-tbc', '待確認') + '</div>' + tbcBlock(f.tbc) : '') +
      link +
      '<footer class="fc-foot"><div class="marks" role="group" aria-label="標記">' +
        '<button type="button" class="mark mark-want" data-mark="want" data-food="' + esc(f._id) + '" aria-pressed="' + (mk === 'want') + '" aria-label="想食：' + esc(f.name) + '">' + icon('heart') + '想食</button>' +
        '<button type="button" class="mark mark-done" data-mark="done" data-food="' + esc(f._id) + '" aria-pressed="' + (mk === 'done') + '" aria-label="食咗：' + esc(f.name) + '">' + icon('check') + '食咗</button>' +
      '</div>' + (m.length ? navButtons(m.slice(0, 1), f.name) : '') + '</footer></article>';
  }

  // ------------------------------------------------------------ view: checklist
  var CHECKS_KEY = 'checklist'; // { itemId: true }

  function checklistGroups() {
    return D.checklist.map(function (g) {
      var items = g.items.filter(function (x) { return state.group === 'all' || !x.who || x.who === 'all' || x.who === state.group; });
      return { name: g.name, items: items };
    }).filter(function (g) { return g.items.length; });
  }

  function getChecks() { var c = store.get(CHECKS_KEY, {}); return c && typeof c === 'object' ? c : {}; }

  // One-off: earlier versions stored ticks as "group name/item text"; move them onto item ids.
  function migrateChecks() {
    if (store.get(CHECKS_KEY, null) !== null) return;
    var old = store.get('checks', null), next = {};
    if (old && typeof old === 'object') {
      D.checklist.forEach(function (g) { g.items.forEach(function (x) { if (old[x._legacy] || old[x._key]) next[x._key] = true; }); });
    }
    store.set(CHECKS_KEY, next);
    if (old) store.set('checks', null);
  }

  function renderChecklist() {
    var checks = getChecks();
    var groups = checklistGroups();
    var total = 0, done = 0;
    groups.forEach(function (g) { g.items.forEach(function (x) { total++; if (checks[x._key]) done++; }); });
    var html = '<header class="view-head"><p class="dh-kicker">PACKING &amp; TO-DO</p><h2 class="view-title">行李及待辦清單</h2>' +
      '<div class="progress" data-progress><div class="progress-bar"><span style="width:' + (total ? Math.round(done / total * 100) : 0) + '%"></span></div>' +
      '<span class="progress-text"><b data-done>' + done + '</b> / ' + total + ' 完成</span></div></header>';
    html += '<div class="check-tools">' + segHTML() + '<button type="button" class="btn btn-sm" data-reset-checks>清除全部剔號</button></div>';
    html += '<p class="hint">剔咗嘅項目只會儲存喺呢部裝置。</p>';
    html += '<div class="check-groups">' + groups.map(function (g) {
      var gd = g.items.filter(function (x) { return checks[x._key]; }).length;
      return '<section class="check-group panel"><h3><span>' + esc(g.name) + '</span><span class="cg-count" data-group-count>' + gd + '/' + g.items.length + '</span></h3><ul>' +
        g.items.map(function (x) {
          return '<li><label class="check"><input type="checkbox" data-check="' + esc(x._key) + '"' + (checks[x._key] ? ' checked' : '') + '>' +
            '<span class="check-box">' + icon('check') + '</span>' +
            '<span class="check-text">' + rich(x.text) + (x.note ? '<small>' + rich(x.note) + '</small>' : '') +
            (typeof x.tbc === 'string' ? '<small class="check-tbc">待確認：' + esc(x.tbc) + '</small>' : '') + '</span>' +
            (x.who === 'runner' || x.who === 'cheer' ? tag('tag-' + x.who, esc(groupLabel(x.who))) : '') +
            '</label></li>';
        }).join('') + '</ul></section>';
    }).join('') + '</div>';
    return html;
  }

  function refreshCheckCounts() {
    var all = $$('[data-check]'), done = all.filter(function (x) { return x.checked; }).length;
    var p = $('[data-progress]');
    if (p) {
      $('.progress-bar span', p).style.width = (all.length ? Math.round(done / all.length * 100) : 0) + '%';
      $('[data-done]', p).textContent = done;
    }
    $$('.check-group').forEach(function (sec) {
      var boxes = $$('[data-check]', sec);
      $('[data-group-count]', sec).textContent = boxes.filter(function (x) { return x.checked; }).length + '/' + boxes.length;
    });
  }

  // ------------------------------------------------------------ view: info
  function renderInfo() {
    var T = D.T, h = T.hotel || {};
    var html = '<header class="view-head"><p class="dh-kicker">INFO</p><h2 class="view-title">旅程資訊</h2></header><div class="info-grid">';

    var flights = arr(T.flights);
    if (flights.length) {
      html += '<section class="info-sec info-flights"><h3 class="sec-title">' + icon('plane') + '航班</h3>' + flights.map(function (f) {
        var a = f.from || {}, b = f.to || {};
        return '<article class="pass"><div class="pass-top"><span class="pass-label">' + esc(f.label || '') + '</span>' +
          '<span class="pass-date">' + (f.date ? mdLong(f.date) + '（' + weekday(f.date) + '）' : '') + '</span>' +
          '<span class="pass-no">' + esc(f.airline || '') + ' <b>' + esc(f.flight || '') + '</b></span></div>' +
          '<div class="pass-route">' +
            '<div class="pass-end"><span class="pass-code">' + esc(a.code || '') + '</span><span class="pass-time">' + esc(a.time || '') + '</span>' +
            '<span class="pass-name">' + esc(a.name || '') + (a.terminal ? ' ' + esc(a.terminal) : '') + '</span></div>' +
            '<div class="pass-line" aria-hidden="true">' + icon('plane') + '</div>' +
            '<div class="pass-end pass-end-r"><span class="pass-code">' + esc(b.code || '') + '</span><span class="pass-time">' + esc(b.time || '') + '</span>' +
            '<span class="pass-name">' + esc(b.name || '') + (b.terminal ? ' ' + esc(b.terminal) : '') + '</span></div>' +
          '</div>' + (f.notes ? '<p class="pass-note">' + rich(f.notes) + '</p>' : '') + tbcBlock(f.tbc) + '</article>';
      }).join('') + '</section>';
    }

    if (h.name) {
      var hm = mapList(h.map, h.name);
      html += '<section class="info-sec"><h3 class="sec-title">' + icon('bed') + '住宿</h3><article class="panel hotel">' +
        '<p class="hotel-name">' + esc(h.name) + '</p>' + (h.nameEn ? '<p class="hotel-en">' + esc(h.nameEn) + '</p>' : '') +
        (h.note ? '<p class="hotel-note">' + esc(h.note) + '</p>' : '') +
        (h.address ? '<p class="hotel-addr">' + esc(h.address) + '</p>' : '') +
        (h.tbc || !h.address ? '<div class="tags">' + tag('tag-tbc', '待確認') + '</div>' + tbcBlock(h.tbc || '地址待確認') : '') +
        '<dl class="kv">' + (h.checkIn ? '<div><dt>入住</dt><dd>' + esc(h.checkIn) + '</dd></div>' : '') +
        (h.checkOut ? '<div><dt>退房</dt><dd>' + esc(h.checkOut) + '</dd></div>' : '') +
        (h.phone ? '<div><dt>電話</dt><dd><a href="tel:' + esc(String(h.phone).replace(/[^\d+]/g, '')) + '">' + esc(h.phone) + '</a></dd></div>' : '') + '</dl>' +
        '<div class="actions"><button type="button" class="btn btn-primary" data-taxi>' + icon('car') + '<span>俾司機睇</span></button>' +
        '<button type="button" class="btn" data-copy>' + icon('copy') + '<span>' + (h.address ? '複製地址' : '複製名稱') + '</span></button>' +
        navButtons(hm, h.name) + '</div></article></section>';
    }

    var rem = [];
    arr(T.notices).forEach(function (n) { n = textOf(n); rem.push({ when: '', text: n.text, links: n.links }); });
    D.days.forEach(function (d) {
      var when = md(d.date) + '（' + weekday(d.date) + '）';
      arr(d.alerts).map(textOf).forEach(function (a) { rem.push({ when: when, title: a.title, text: a.text, links: a.links, strong: true }); });
      arr(d.reminders).map(textOf).forEach(function (r) { rem.push({ when: when, text: r.text, links: r.links }); });
    });
    if (rem.length) {
      html += '<section class="info-sec"><h3 class="sec-title">' + icon('alert') + '重要提醒</h3><ul class="panel reminders" role="list">' +
        rem.map(function (r) { return '<li' + (r.strong ? ' class="rem-strong"' : '') + '>' + (r.when ? '<span class="rem-when">' + r.when + '</span>' : '') + '<span>' + (r.title ? '<b>' + esc(r.title) + '</b>\n' : '') + rich(r.text) + linksHTML(r.links) + '</span></li>'; }).join('') + '</ul></section>';
    }

    var tips = arr(T.tips);
    if (tips.length) {
      html += '<section class="info-sec info-tips"><h3 class="sec-title">' + icon('bulb') + '實用資訊</h3><div class="tips">' +
        tips.map(function (t) {
          return '<article class="panel tip"><h4>' + esc(t.title) + '</h4><ul>' +
            arr(t.items).map(function (x) {
              var o = typeof x === 'string' ? { text: x } : x;
              return '<li>' + rich(o.text) + (o.tbc ? ' ' + tag('tag-tbc', '待確認') : '') + linksHTML(o.links) + '</li>';
            }).join('') + '</ul></article>';
        }).join('') + '</div></section>';
    }

    var em = arr(T.emergency);
    if (em.length) {
      html += '<section class="info-sec"><h3 class="sec-title">' + icon('phone') + '緊急電話</h3><div class="phones">' +
        em.map(function (e) {
          return '<a class="phone panel" href="tel:' + esc(String(e.number).replace(/[^\d+]/g, '')) + '">' +
            '<span class="phone-num">' + esc(e.number) + '</span><span class="phone-label">' + esc(e.label) +
            (e.note ? '<small>' + rich(e.note) + '</small>' : '') + '</span>' + icon('phone') + '</a>';
        }).join('') + '</div></section>';
    }
    html += '</div>';
    var meta = T.meta || {};
    html += '<footer class="data-meta">' +
      (meta.sources ? '<p class="sources"><b>資料來源／最後核實日期 ' + esc(meta.checked || '') + '</b><br>' + rich(meta.sources) + '</p>' : '') +
      '<p>資料更新：' + esc(meta.updated || '—') + '</p><p data-offline-state>' + offlineText() + '</p></footer>';
    return html;
  }

  function offlineText() {
    if (!('serviceWorker' in navigator)) return '呢個瀏覽器唔支援離線模式';
    return navigator.serviceWorker.controller ? '已可離線使用' : '離線模式準備中（重新開一次就得）';
  }

  // ------------------------------------------------------------ taxi card / copy
  // Native modal <dialog> where supported (inert page, focus containment, Esc and the Android back
  // gesture close it, focus returns to the button that opened it). Older browsers keep the div.
  // No history entries are added for the card; a history navigation while it is open closes it (onHash).
  var HAS_DIALOG = typeof HTMLDialogElement === 'function' && 'showModal' in HTMLDialogElement.prototype;
  var taxiOpener = null;
  var reloadPending = false; // new code took over while the card was open; stays set until the reload runs
  function setupOverlay() {
    var ov = $('#overlay');
    if (HAS_DIALOG && ov.tagName !== 'DIALOG') {
      var d = document.createElement('dialog');
      d.id = 'overlay'; d.className = 'overlay';
      d.setAttribute('aria-label', '俾司機睇');
      // full-screen white sheet set inline, so it holds even if an older cached style.css is in use
      d.style.cssText = 'position:fixed;top:0;right:0;bottom:0;left:0;z-index:100;width:auto;height:auto;' +
        'max-width:none;max-height:none;margin:0;padding:0;border:0;overflow-y:auto;' +
        'background:#FFFFFF;color:#111111;color-scheme:light;overscroll-behavior:contain;';
      d.style.setProperty('--accent', '#B3312A');
      ov.parentNode.replaceChild(d, ov);
      ov = d;
    }
    if (ov.tagName === 'DIALOG') ov.addEventListener('close', overlayClosed);
  }
  // called when a new service worker takes over: reload now, or as soon as the card is closed
  function reloadForNewCode() {
    if (overlayOpen()) { reloadPending = true; return; }
    location.reload();
  }
  function overlayOpen() {
    var ov = $('#overlay');
    return ov.tagName === 'DIALOG' ? ov.open : !ov.hidden;
  }
  function openTaxi(opener) {
    var h = D.T.hotel || {};
    var ov = $('#overlay');
    var native = ov.tagName === 'DIALOG';
    if (overlayOpen()) return;
    taxiOpener = opener || document.activeElement; // iOS does not focus a tapped button, so take the button itself
    ov.innerHTML = '<div class="taxi"' + (native ? '' : ' role="dialog" aria-modal="true" aria-label="俾司機睇"') + '>' +
      '<button type="button" class="icon-btn taxi-close" data-close aria-label="關閉"' + (native ? ' autofocus' : '') + '>' + icon('close') + '</button>' +
      '<p class="taxi-lead">司機您好，請載我到：</p>' +
      '<p class="taxi-name">' + esc(h.name || '') + '</p>' +
      (h.address ? '<p class="taxi-addr">' + esc(h.address) + '</p>' : '') +
      (h.note ? '<p class="taxi-note">（' + esc(h.note) + '）</p>' : '') +
      (h.phone ? '<p class="taxi-note">電話 ' + esc(h.phone) + '</p>' : '') +
      '<p class="taxi-thanks">謝謝！</p></div>';
    // kept deliberately (untested on iOS): stops the page behind the opaque sheet from scrolling
    document.body.classList.add('no-scroll');
    if (native) {
      try { ov.showModal(); } catch (e) { ov.setAttribute('open', ''); }
    } else ov.hidden = false;
    focusQuietly($('.taxi-close', ov));
  }
  function closeOverlay() {
    var ov = $('#overlay');
    if (!overlayOpen()) return;
    if (ov.tagName === 'DIALOG') { ov.close(); return; } // cleanup runs in the 'close' event
    ov.hidden = true;
    overlayClosed();
  }
  function overlayClosed() {
    var ov = $('#overlay');
    ov.innerHTML = '';
    document.body.classList.remove('no-scroll');
    // the browser returns focus to the opener for a native dialog; make sure it does everywhere
    var a = document.activeElement;
    if ((!a || a === document.body) && taxiOpener && document.contains(taxiOpener)) focusQuietly(taxiOpener);
    taxiOpener = null;
    // a new version of the site's code took over while the card was showing: reload now that it is
    // closed. The flag stays set until the reload really happens; if the card was reopened in the
    // meantime, the next close tries again.
    if (reloadPending) setTimeout(function () { if (reloadPending && !overlayOpen()) location.reload(); }, 100);
  }
  function copyText(text) {
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      toast(ok ? '已複製' : '複製唔到，請長按文字複製');
    }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () { toast('已複製'); }, fallback);
    } else fallback();
  }

  // ------------------------------------------------------------ print (all days)
  function renderPrint() {
    if (!D) return;
    var m = D.T.meta || {};
    $('#print-root').innerHTML = '<h1>' + esc(m.title || '') + ' ' + esc(m.year || '') + '</h1>' + D.days.map(function (d) {
      return '<section class="p-day"><h2>' + mdLong(d.date) + '（' + weekday(d.date) + '）' + (d.title ? ' · ' + esc(d.title) : '') + '</h2>' +
        arr(d.alerts).map(textOf).map(function (a) { return '<p class="p-rem"><b>' + esc(a.title || '注意') + '：</b>' + esc(a.text) + '</p>'; }).join('') +
        arr(d.reminders).map(function (r) { return '<p class="p-rem">提醒：' + esc(textOf(r).text) + '</p>'; }).join('') +
        '<table>' + d.items.map(function (it) {
          var foods = (D.foodByStop[it._id] || []).map(function (f) { return esc(f.name) + (hasTbc(f) ? '（待確認）' : ''); });
          return '<tr' + (it.source === 'suggested' ? ' class="p-suggest"' : '') + '><td class="p-time">' + esc(timeText(it)) + '</td><td><b>' + esc(it.title) + '</b>' +
            (it.source === 'suggested' ? ' 〔建議・非主辦原定安排〕' : '') +
            (it._group !== 'all' ? ' 〔' + esc(groupLabel(it._group)) + '〕' : '') + (it.tbc ? ' 〔待確認〕' : '') +
            '<div class="p-meta">' + TYPES[it._type].label + (it.area ? ' · ' + esc(it.area) : '') + '</div>' +
            (it.route ? '<div>前往：' + esc(it.route) + '</div>' : '') +
            (it.notes ? '<div>' + esc(it.notes) + '</div>' : '') +
            (typeof it.tbc === 'string' ? '<div>待確認：' + esc(it.tbc) + '</div>' : '') +
            (foods.length ? '<div>美食：' + foods.join('、') + '</div>' : '') + '</td></tr>';
        }).join('') + '</table>' +
        (arr(d.suggestions).length ? '<div class="p-sugg"><b>研究建議（未納入行程，供參考）</b>' + arr(d.suggestions).map(function (s) {
          s = textOf(s); return '<p>・' + esc(s.text) + (s.why ? '（' + esc(s.why) + '）' : '') + '</p>';
        }).join('') + '</div>' : '') + '</section>';
    }).join('');
  }

  // ------------------------------------------------------------ chrome: brand, theme, toast, network
  function renderBrand() {
    var m = D.T.meta || {}, days = D.days;
    document.title = [m.title, m.year].filter(Boolean).join(' ') || document.title;
    var range = days[0].date.slice(5).replace('-', '.') + ' – ' + days[days.length - 1].date.slice(5).replace('-', '.');
    $('#brand').innerHTML = '<span class="brand-mark">' + esc(m.city || m.title || '') + '</span>' +
      '<span class="brand-text"><span class="brand-en">' + esc([m.cityEn, m.year].filter(Boolean).join(' ')) + '</span>' +
      '<span class="brand-dates">' + range + '</span></span><span class="brand-lines" aria-hidden="true"></span>';
    var foot = $('#side-foot');
    if (foot) foot.textContent = '資料更新：' + (m.updated || '—');
  }

  // Stored theme: absent (or a legacy "auto") = follow the system; "light"/"dark" = pinned by the user.
  function themeMode() { var t = store.get('theme', 'auto'); return THEMES[t] ? t : 'auto'; }
  function systemDark() { return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches); }
  function renderedDark(mode) { return mode === 'dark' || (mode === 'auto' && systemDark()); }
  function applyTheme(mode) {
    var root = document.documentElement;
    if (mode === 'light' || mode === 'dark') root.setAttribute('data-theme', mode); else root.removeAttribute('data-theme');
    var dark = renderedDark(mode);
    $$('meta[name="theme-color"]').forEach(function (el) {
      var media = el.getAttribute('media') || '';
      var isDarkMeta = media.indexOf('dark') >= 0;
      var lightC = $('meta[name="theme-color"][media*="light"]').getAttribute('data-default');
      var darkC = $('meta[name="theme-color"][media*="dark"]').getAttribute('data-default');
      el.setAttribute('content', mode === 'auto' ? (isDarkMeta ? darkC : lightC) : (dark ? darkC : lightC));
    });
    var btn = $('#theme-btn');
    if (btn) {
      // the icon shows what is on screen now; the name says what pressing it does
      btn.innerHTML = icon(dark ? 'moon' : 'sun');
      btn.setAttribute('aria-label', dark ? '轉淺色主題' : '轉深色主題');
      btn.title = '主題：' + (dark ? '深色' : '淺色') + (mode === 'auto' ? '（跟隨系統）' : '');
    }
  }
  // Two states: always switch to the opposite of what is shown. If that matches the system setting,
  // the user is undoing their override, so forget it (follow the system again) rather than pinning it.
  function toggleTheme() {
    var target = renderedDark(themeMode()) ? 'light' : 'dark';
    var next = (target === 'dark') === systemDark() ? 'auto' : target;
    store.set('theme', next === 'auto' ? null : next);
    applyTheme(next);
    toast('主題：' + (target === 'dark' ? '深色' : '淺色') + (next === 'auto' ? '（跟隨系統）' : ''));
  }

  var toastTimer = null;
  function toast(msg, actionLabel, action) {
    var el = $('#toast');
    el.innerHTML = '<span>' + esc(msg) + '</span>' + (actionLabel ? '<button type="button" class="btn btn-sm">' + esc(actionLabel) + '</button>' : '');
    el.hidden = false;
    if (actionLabel) $('button', el).addEventListener('click', function () { el.hidden = true; action(); });
    announce(actionLabel ? msg + '（可以按「' + actionLabel + '」）' : msg);
    clearTimeout(toastTimer);
    var wait = actionLabel ? 10000 : 2600;
    (function hideLater(ms) {
      toastTimer = setTimeout(function () {
        if (el.contains(document.activeElement)) { hideLater(1000); return; } // don't vanish under a keyboard user
        el.hidden = true;
      }, ms);
    })(wait);
  }

  var wasOffline = null;
  function updateNet() {
    var bar = $('#netbar');
    var off = navigator.onLine === false;
    bar.hidden = !off;
    bar.innerHTML = off ? icon('offline') + '<span>離線中 · 顯示已儲存嘅內容</span>' : '';
    document.body.classList.toggle('is-offline', off);
    if (off !== wasOffline && (off || wasOffline !== null)) announce(off ? '離線中 · 顯示已儲存嘅內容' : '已重新連線');
    wasOffline = off;
  }

  // ------------------------------------------------------------ render + routing
  var VIEWS = { itinerary: renderItinerary, food: renderFood, checklist: renderChecklist, info: renderInfo };

  function render() {
    renderBrand();
    $$('.tab').forEach(function (a) {
      if (a.getAttribute('data-tab') === state.tab) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    var main = $('#main');
    var html;
    try { html = VIEWS[state.tab](); } catch (e) {
      console.error(e);
      html = '<div class="fatal"><h2>呢頁顯示唔到</h2><p>可能係 data/trip.js 內容格式有問題。</p><pre>' + esc(e && e.message) + '</pre></div>';
    }
    var fk = focusKey();
    main.innerHTML = html;
    main.setAttribute('data-view', state.tab);
    document.body.setAttribute('data-view', state.tab);
    updateLive(true);
    restoreFocus(fk);
  }

  // Re-render the same view for a passive update (e.g. a tick made in another tab) without losing the
  // reader's place: re-open the <details> that were open, then restore the scroll position.
  function rerenderInPlace() {
    var open = $$('#main details').map(function (d) { return d.open; });
    var y = window.scrollY;
    render();
    var now = $$('#main details');
    if (now.length === open.length) now.forEach(function (d, i) { d.open = open[i]; });
    window.scrollTo(0, y);
  }

  function parseHash() {
    var h = decodeURIComponent((location.hash || '').replace(/^#\/?/, ''));
    var parts = h.split('/');
    return { tab: TABS.indexOf(parts[0]) >= 0 ? parts[0] : 'itinerary', arg: parts.slice(1).join('/') };
  }

  function onHash() {
    closeOverlay(); // any history navigation closes the taxi card rather than changing the view behind it
    var h = parseHash();
    var changed = h.tab !== state.tab;
    state.tab = h.tab;
    if (h.tab === 'food' && h.arg) state.foodFilter = { day: 'all', area: 'all', status: 'all' };
    render();
    if (h.tab === 'food' && h.arg) {
      var card = document.getElementById('food-' + h.arg);
      if (card) { card.scrollIntoView({ block: 'center' }); flash(card); focusTarget(card); }
    } else if (changed) window.scrollTo(0, 0);
  }

  function flash(el) {
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
  }

  function jumpTo(id) {
    var it = D.stops[id];
    if (!it) return;
    state.day = it._day; state.dayPickedAt = Date.now();
    if (it._group !== 'all' && state.group !== 'all' && state.group !== it._group) { state.group = 'all'; store.set('group', 'all'); }
    if (state.tab !== 'itinerary') { state.tab = 'itinerary'; history.pushState(null, '', '#itinerary'); }
    render();
    var el = document.getElementById('stop-' + id);
    if (el) { el.scrollIntoView({ block: 'center' }); flash($('.stop-card', el)); focusTarget($('.stop-card', el)); }
  }

  function setDay(i) {
    var lay = $('.day-layout'), bar = $('.daybar');
    // was the user already scrolled into the day's list (under the sticky day bar)?
    var scrolledIn = !!(lay && bar && lay.getBoundingClientRect().top < bar.getBoundingClientRect().bottom - 1);
    state.day = i; state.dayPickedAt = Date.now();
    render();
    if (!scrolledIn) return;
    lay = $('.day-layout'); bar = $('.daybar');
    var sticky = window.getComputedStyle(bar).position === 'sticky';
    var offset = sticky ? bar.offsetHeight + (parseFloat(window.getComputedStyle(bar).top) || 0) : 16;
    window.scrollTo(0, Math.max(0, lay.getBoundingClientRect().top + window.scrollY - offset));
  }

  // ------------------------------------------------------------ events
  function bind() {
    document.addEventListener('click', function (e) {
      var el = e.target.closest('[data-day],[data-group],[data-jump],[data-mark],[data-f],[data-taxi],[data-close],[data-copy],[data-theme-toggle],[data-print],[data-reset-checks],[data-today]');
      if (!el) return;
      if (el.hasAttribute('data-day')) setDay(+el.getAttribute('data-day'));
      else if (el.hasAttribute('data-group')) {
        state.group = el.getAttribute('data-group'); store.set('group', state.group);
        var y = window.scrollY; render(); window.scrollTo(0, y);
      } else if (el.hasAttribute('data-jump')) { e.preventDefault(); jumpTo(el.getAttribute('data-jump')); }
      else if (el.hasAttribute('data-mark')) {
        var id = el.getAttribute('data-food'), mk = el.getAttribute('data-mark');
        var marks = foodMarks();
        marks = Object.assign({}, marks);
        if (marks[id] === mk) delete marks[id]; else marks[id] = mk;
        store.set('food', marks);
        var y2 = window.scrollY; render(); window.scrollTo(0, y2);
      } else if (el.hasAttribute('data-f')) {
        state.foodFilter[el.getAttribute('data-f')] = el.getAttribute('data-v');
        var y3 = window.scrollY; render(); window.scrollTo(0, y3);
      } else if (el.hasAttribute('data-taxi')) openTaxi(el);
      else if (el.hasAttribute('data-close')) closeOverlay();
      else if (el.hasAttribute('data-copy')) {
        var h = D.T.hotel || {};
        copyText(h.address ? h.name + '\n' + h.address : h.name);
      } else if (el.hasAttribute('data-theme-toggle')) toggleTheme();
      else if (el.hasAttribute('data-print')) { renderPrint(); window.print(); }
      else if (el.hasAttribute('data-reset-checks')) {
        if (window.confirm('確定清除呢部裝置上所有剔號？')) { store.set(CHECKS_KEY, {}); render(); }
      } else if (el.hasAttribute('data-today')) { var L = live(); if (L.todayIdx >= 0) setDay(L.todayIdx); }
    });

    document.addEventListener('change', function (e) {
      var box = e.target.closest('[data-check]');
      if (!box) return;
      var checks = Object.assign({}, getChecks());
      var key = box.getAttribute('data-check');
      if (box.checked) checks[key] = true; else delete checks[key];
      store.set(CHECKS_KEY, checks);
      refreshCheckCounts();
    });

    // a native <dialog> handles Esc itself; only the fallback div needs this
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && $('#overlay').tagName !== 'DIALOG') closeOverlay();
    });
    // another tab / the installed app changed saved state: drop our in-memory copy and show theirs
    // (otherwise this page's next write would overwrite ticks or marks made over there)
    window.addEventListener('storage', function (e) {
      if (e.key === null) memory = {};
      else if (e.key.indexOf(PREFIX) === 0) delete memory[e.key.slice(PREFIX.length)];
      else return;
      if (e.key === null || e.key === PREFIX + 'theme') applyTheme(themeMode());
      if (D && e.key !== PREFIX + 'theme') rerenderInPlace();
    });
    window.addEventListener('hashchange', onHash);
    window.addEventListener('beforeprint', renderPrint);
    window.addEventListener('online', function () { updateNet(); checkData(); });
    window.addEventListener('offline', updateNet);
    if (window.matchMedia) {
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      var onScheme = function () { applyTheme(themeMode()); };
      if (mq.addEventListener) mq.addEventListener('change', onScheme); else if (mq.addListener) mq.addListener(onScheme);
    }
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState !== 'visible') return;
      updateLive(true);
      checkForUpdates();
    });
    setInterval(function () { updateLive(false); }, 20000);
    // while the page stays open and visible, look for a newer itinerary every 10 minutes
    setInterval(function () { if (document.visibilityState === 'visible') checkData(); }, 10 * 60000);
  }

  // ------------------------------------------------------------ service worker + live content updates
  var swReg = null;
  function checkForUpdates() {
    if ('serviceWorker' in navigator && swReg) swReg.update().catch(function () {});
    checkData();
  }

  // Make sure this page shows the newest trip data. The fetch goes through the service worker
  // (fresh copy when online, newest saved copy otherwise — possibly saved by another tab or the
  // installed app). We compare against what this page actually rendered, not network vs cache.
  var checking = null;
  function parseTrip(text) {
    var sandbox = {};
    (new Function('window', text))(sandbox); // trip.js assigns window.TRIP
    return sandbox.TRIP;
  }
  function checkData() {
    if (checking || !D) return checking;
    checking = fetch('data/trip.js', { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    }).then(function (text) {
      var next = parseTrip(text);
      if (!next || !Array.isArray(next.days) || revOf(next) === D.rev) return;
      var prev = window.TRIP;
      window.TRIP = next;
      try { prepare(); } catch (e) { window.TRIP = prev; prepare(); throw e; }
      if (state.day >= D.days.length) state.day = 0;
      var y = window.scrollY;
      render();
      window.scrollTo(0, y);
      toast('行程已更新');
    }).catch(function (e) { console.warn('checking for new trip data failed', e); })
      .then(function () { checking = null; });
    return checking;
  }

  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    var hadController = !!navigator.serviceWorker.controller;
    var refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      // A new version of the site's code took over: reload once to use it.
      if (!hadController) { hadController = true; refreshOfflineState(); return; }
      if (refreshing) return;
      refreshing = true;
      // never yank the taxi card away while someone is showing it to a driver: reload once it is closed
      reloadForNewCode();
    });
    navigator.serviceWorker.addEventListener('message', function (e) {
      var data = e.data || {};
      if (data.type === 'data-updated') checkData();
      else if (data.type === 'app-updated') toast('網站有新版本', '重新載入', function () { location.reload(); });
    });
    navigator.serviceWorker.register('sw.js').then(function (reg) {
      swReg = reg;
      setInterval(function () { reg.update().catch(function () {}); }, 30 * 60000);
      return navigator.serviceWorker.ready;
    }).then(refreshOfflineState).catch(function (e) { console.warn('service worker registration failed', e); });
  }
  function refreshOfflineState() {
    var el = $('[data-offline-state]');
    if (el) el.textContent = offlineText();
  }

  // ------------------------------------------------------------ boot
  function fatal(e) {
    console.error(e);
    $('#main').innerHTML = '<div class="fatal"><h2>載入唔到行程資料</h2>' +
      '<p>請檢查 <code>data/trip.js</code> 有冇打錯字（例如漏咗逗號、引號或者括號）。用電腦瀏覽器開啟、睇 Console 會講係邊一行出錯。</p>' +
      '<pre>' + esc(e && e.message) + '</pre></div>';
  }

  function boot() {
    setupOverlay();
    setupAnnouncer();
    applyTheme(themeMode());
    bind();
    updateNet();
    registerSW();
    try { prepare(); } catch (e) { fatal(e); return; }
    migrateChecks();
    var g = store.get('group', 'all');
    state.group = g === 'runner' || g === 'cheer' ? g : 'all';
    var L = live();
    state.day = L.phase === 'during' && L.todayIdx >= 0 ? L.todayIdx : 0;
    lastToday = L.todayIdx;
    var h = parseHash();
    state.tab = h.tab;
    if (h.tab === 'food' && h.arg) onHash(); else render();
  }

  // Icon sprite (inline so it works offline with no extra request)
  function sprite() {
    var P = {
      train: '<rect x="5" y="3" width="14" height="13" rx="3"/><path d="M5 10h14M9 20l-2 2M15 20l2 2M8 16l-1.5 4M16 16l1.5 4"/><path d="M8.5 13h.01M15.5 13h.01"/>',
      camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
      bowl: '<path d="M3 12h18a9 7 0 0 1-18 0z"/><path d="M9 20h6M14 3l-3 9M20 4l-6 8"/>',
      bag: '<path d="M5 8h14l-1 12H6z"/><path d="M9 10V7a3 3 0 0 1 6 0v3"/>',
      bed: '<path d="M3 5v14M3 15h18v4M21 15v-3a3 3 0 0 0-3-3h-7v6"/><circle cx="7" cy="11.5" r="2"/>',
      flag: '<path d="M5 21V4M5 4h12l-2.5 4L17 12H5"/>',
      onsen: '<path d="M4 15c0 3 3.6 5 8 5s8-2 8-5"/><path d="M8 13c-1.2-1.5 1.2-2.5 0-4.5S9.2 6 8 4M12 13c-1.2-1.5 1.2-2.5 0-4.5S13.2 6 12 4M16 13c-1.2-1.5 1.2-2.5 0-4.5S17.2 6 16 4"/>',
      nav: '<path d="M3.5 11 20 4l-7 16.5-2-7.5z"/>',
      route: '<circle cx="6" cy="5" r="2"/><circle cx="18" cy="19" r="2"/><path d="M8 5h7.5a3.5 3.5 0 0 1 0 7h-7a3.5 3.5 0 0 0 0 7H16"/>',
      checklist: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8 12 3 3 5-6"/>',
      info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/>',
      copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
      sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
      moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
      auto: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17a8.5 8.5 0 0 0 0-17z" fill="currentColor" stroke="none"/>',
      alert: '<path d="M12 3.5 2.5 20h19z"/><path d="M12 10v4.5M12 17.2v.01"/>',
      heart: '<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z"/>',
      check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
      phone: '<path d="M5 4h3.5l2 5-2.5 1.5a11 11 0 0 0 5.5 5.5l1.5-2.5 5 2V19a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z"/>',
      car: '<path d="M5 16v-4l2-5h10l2 5v4M3 12h18v5H3zM6 17v2M18 17v2"/><path d="M7 14.5h.01M17 14.5h.01"/>',
      print: '<path d="M7 9V3h10v6M7 17H4v-8h16v8h-3"/><path d="M7 14h10v7H7z"/>',
      megaphone: '<path d="M3 10v4h3l8 4.5v-13L6 10z"/><path d="M17.5 9a4 4 0 0 1 0 6M20 6.5a7.5 7.5 0 0 1 0 11"/>',
      star: '<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
      bulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.3 1.1 2.2h5c0-.9.4-1.6 1.1-2.2A6 6 0 0 0 12 3z"/>',
      fork: '<path d="M12 21v-7M12 14 6 8M12 14l6-6M6 8V4M18 8V4M4 6l2-2 2 2M16 6l2-2 2 2"/>',
      chevron: '<path d="m9 6 6 6-6 6"/>',
      external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
      close: '<path d="M6 6l12 12M18 6 6 18"/>',
      plane: '<path d="M21 15.5v-2l-8-5V4a1.5 1.5 0 0 0-3 0v4.5l-7 5v2l7-2.2V18l-2 1.5V21l3.5-1 3.5 1v-1.5L13 18v-4.7z"/>',
      offline: '<path d="M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 4.2-2.6M19 13a10 10 0 0 0-2-1.6M2 9.5A15 15 0 0 1 6.5 6.6M22 9.5A15 15 0 0 0 11 5.1"/><path d="M12 20h.01"/>',
    };
    var html = '<svg xmlns="http://www.w3.org/2000/svg" style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true">' +
      Object.keys(P).map(function (k) { return '<symbol id="i-' + k + '" viewBox="0 0 24 24">' + P[k] + '</symbol>'; }).join('') + '</svg>';
    document.body.insertAdjacentHTML('afterbegin', html);
  }

  sprite();
  boot();
})();
