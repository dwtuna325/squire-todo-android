/* store.js — 투두(할 일) 로컬 저장소 + 순수 병합 로직.
 *
 * PC 쪽 `src/todos.py`를 그대로 포팅한 것. 데이터 모델(todos.json v1)·병합 규칙이
 * PC와 100% 호환되어야 드라이브 동기화 시 서로의 편집이 유실되지 않는다.
 *
 * 병합 규칙: 항목 id 별 **최종수정승리**(updated_at 큰 쪽). 삭제는 파괴가 아니라
 * **tombstone**(deleted:true + updated_at)로 남겨 다른 기기 사본에서 되살아나지 않게 한다.
 *
 * 저장: localStorage['squire.todos'] (WebView에서 영구). 드라이브 동본이 SSOT.
 * LLM 미사용(토큰 0).
 */
(function (global) {
  'use strict';

  var SCHEMA_VERSION = 1;
  var TAGS = ['업무', '개인'];
  var RECURS = ['weekly', 'monthly'];
  var TOMBSTONE_TTL_DAYS = 30;
  var WEEKDAY_LABELS = ['월', '화', '수', '목', '금', '토', '일']; // 0=월 … 6=일
  var LS_KEY = 'squire.todos';

  // ───────────────────────── 반복 정규화 ─────────────────────────

  function normRecur(recur) {
    recur = (recur || '').toString().trim().toLowerCase();
    return RECURS.indexOf(recur) >= 0 ? recur : null;
  }

  function normDays(days) {
    var out = {};
    (days || []).forEach(function (d) {
      var n = parseInt(d, 10);
      if (!isNaN(n) && n >= 0 && n <= 6) out[n] = true;
    });
    return Object.keys(out).map(Number).sort(function (a, b) { return a - b; });
  }

  function normDom(dom) {
    var n = parseInt((dom === null || dom === undefined ? '' : dom).toString().trim(), 10);
    return (!isNaN(n) && n >= 1 && n <= 31) ? n : null;
  }

  // ───────────────────────── 날짜 유틸(로컬 기준) ─────────────────────────
  // Python date/weekday()와 동일: 0=월 … 6=일. JS Date.getDay()는 0=일이라 변환한다.

  function pyWeekday(d) { return (d.getDay() + 6) % 7; }

  function daysInMonth(y, m0) { return new Date(y, m0 + 1, 0).getDate(); } // m0=0~11

  function todayLocal() {
    var n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate());
  }

  function ymd(d) {
    var mm = ('0' + (d.getMonth() + 1)).slice(-2);
    var dd = ('0' + d.getDate()).slice(-2);
    return d.getFullYear() + '-' + mm + '-' + dd;
  }

  function parseYmd(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec((s || '').toString());
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3]);
  }

  function addDays(d, n) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  }

  function addOneMonth(d) {
    var y = d.getFullYear() + (d.getMonth() === 11 ? 1 : 0);
    var m0 = d.getMonth() === 11 ? 0 : d.getMonth() + 1;
    var day = Math.min(d.getDate(), daysInMonth(y, m0));
    return new Date(y, m0, day);
  }

  function nextWeekly(days, today) {
    days = normDays(days);
    if (!days.length) return addDays(today, 7);
    for (var off = 1; off <= 7; off++) {
      if (days.indexOf((pyWeekday(today) + off) % 7) >= 0) return addDays(today, off);
    }
    return addDays(today, 7); // 도달 불가(방어)
  }

  function clampDom(y, m0, dom) {
    return new Date(y, m0, Math.min(dom, daysInMonth(y, m0)));
  }

  function nextMonthly(dom, today) {
    dom = normDom(dom);
    if (!dom) return addOneMonth(today);
    var cand = clampDom(today.getFullYear(), today.getMonth(), dom);
    if (cand.getTime() > today.getTime()) return cand;
    var y = today.getFullYear() + (today.getMonth() === 11 ? 1 : 0);
    var m0 = today.getMonth() === 11 ? 0 : today.getMonth() + 1;
    return clampDom(y, m0, dom);
  }

  function computeWake(it, today) {
    today = today || todayLocal();
    var recur = normRecur(it.recur);
    if (recur === 'weekly') return nextWeekly(it.recur_days, today);
    if (recur === 'monthly') return nextMonthly(it.recur_dom, today);
    return null;
  }

  // ───────────────────────── 시간 유틸 ─────────────────────────
  // now_iso: 로컬 타임존 ISO8601(초 단위) — 예 "2026-08-25T09:30:00+09:00".

  function nowIso() {
    var d = new Date();
    var off = -d.getTimezoneOffset(); // 분(동쪽이 +)
    var sign = off >= 0 ? '+' : '-';
    var abs = Math.abs(off);
    var oh = ('0' + Math.floor(abs / 60)).slice(-2);
    var om = ('0' + (abs % 60)).slice(-2);
    function p(n) { return ('0' + n).slice(-2); }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      'T' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) +
      sign + oh + ':' + om;
  }

  function parseTs(ts) {
    if (!ts) return 0;
    var t = Date.parse(ts);
    return isNaN(t) ? 0 : t / 1000; // epoch 초
  }

  function uuid12() {
    var buf = new Uint8Array(6);
    (global.crypto || global.msCrypto).getRandomValues(buf);
    var s = '';
    for (var i = 0; i < buf.length; i++) s += ('0' + buf[i].toString(16)).slice(-2);
    return s; // 12 hex
  }

  // ───────────────────────── 저장/로드 ─────────────────────────

  function emptyDoc() {
    return { version: SCHEMA_VERSION, updated_at: nowIso(), items: [] };
  }

  function load() {
    try {
      var raw = global.localStorage.getItem(LS_KEY);
      if (!raw) return emptyDoc();
      var doc = JSON.parse(raw);
      if (!doc || typeof doc !== 'object' || !Array.isArray(doc.items)) return emptyDoc();
      if (doc.version === undefined) doc.version = SCHEMA_VERSION;
      return doc;
    } catch (e) {
      return emptyDoc();
    }
  }

  function save(doc) {
    doc.updated_at = nowIso();
    global.localStorage.setItem(LS_KEY, JSON.stringify(doc));
    return doc;
  }

  // ───────────────────────── 조회 ─────────────────────────

  function listItems(opts) {
    opts = opts || {};
    var includeDone = opts.includeDone !== false;
    var includeDeleted = opts.includeDeleted === true;
    var tag = opts.tag || null;
    var doc = opts.doc || load();
    var out = [];
    (doc.items || []).forEach(function (it) {
      if (!includeDeleted && it.deleted) return;
      if (!includeDone && it.done) return;
      if (tag && it.tag !== tag) return;
      out.push(it);
    });
    // 미완료 먼저, 그 안에서 최신 생성순
    out.sort(function (a, b) {
      var ad = a.done ? 1 : 0, bd = b.done ? 1 : 0;
      if (ad !== bd) return ad - bd;
      return parseTs(b.created_at) - parseTs(a.created_at);
    });
    return out;
  }

  function find(doc, id) {
    var items = doc.items || [];
    for (var i = 0; i < items.length; i++) if (items[i].id === id) return items[i];
    return null;
  }

  // ───────────────────────── CRUD ─────────────────────────

  function add(fields) {
    fields = fields || {};
    var text = (fields.text || '').trim();
    if (!text) throw new Error('빈 할 일은 추가할 수 없습니다.');
    var tag = TAGS.indexOf(fields.tag) >= 0 ? fields.tag : '업무';
    var ts = nowIso();
    var item = {
      id: uuid12(),
      text: text,
      done: false,
      tag: tag,
      due: ((fields.due || '').trim() || null),
      recur: normRecur(fields.recur),
      recur_days: normDays(fields.recur_days),
      recur_dom: normDom(fields.recur_dom),
      note: (fields.note || '').trim(),
      created_at: ts,
      updated_at: ts,
      deleted: false
    };
    var doc = load();
    doc.items.push(item);
    save(doc);
    return item;
  }

  function edit(id, patch) {
    patch = patch || {};
    var doc = load();
    var it = find(doc, id);
    if (!it || it.deleted) return null;
    if (patch.text !== undefined && patch.text !== null) it.text = patch.text.trim();
    if (patch.tag !== undefined && patch.tag !== null && TAGS.indexOf(patch.tag) >= 0) it.tag = patch.tag;
    if (patch.due !== undefined) it.due = (patch.due || '').trim() || null;
    if (patch.recur !== undefined) it.recur = normRecur(patch.recur);
    if (patch.recur_days !== undefined && patch.recur_days !== null) it.recur_days = normDays(patch.recur_days);
    if (patch.recur_dom !== undefined) it.recur_dom = normDom(patch.recur_dom);
    if (patch.done !== undefined && patch.done !== null) it.done = !!patch.done;
    if (patch.note !== undefined && patch.note !== null) it.note = patch.note.trim();
    it.updated_at = nowIso();
    save(doc);
    return it;
  }

  function toggleDone(id) {
    var doc = load();
    var it = find(doc, id);
    if (!it || it.deleted) return null;
    var recur = normRecur(it.recur);
    if (recur && !it.done) {
      // 반복 업무 완료 → 지난 내역으로(done=true) + 다음 도래일(wake_at) 기록
      var wake = computeWake(it);
      it.done = true;
      it.done_at = nowIso();
      it.last_done_at = nowIso();
      it.wake_at = wake ? ymd(wake) : null;
    } else {
      it.done = !it.done;
      if (it.done) {
        it.done_at = nowIso();
      } else {
        delete it.done_at;
        delete it.wake_at; // 반복 업무 수동 되살리면 예약 도래일 해제
      }
    }
    it.updated_at = nowIso();
    save(doc);
    return it;
  }

  function wakeDueRecurring(doc, today) {
    var persist = !doc;
    doc = doc || load();
    today = today || todayLocal();
    var changed = false;
    (doc.items || []).forEach(function (it) {
      if (it.deleted || !it.done) return;
      if (!normRecur(it.recur)) return;
      if (!it.wake_at) return;
      var wa = parseYmd(it.wake_at);
      if (!wa) return;
      if (wa.getTime() <= today.getTime()) {
        it.done = false;
        delete it.done_at;
        delete it.wake_at;
        // 반복 도래 → 마감일(due)도 한 주기(주간 +7일 / 월간 +1개월) 뒤로 이동.
        // 오래 안 열어 여러 주기가 밀렸으면 오늘 이후가 될 때까지 반복해서 앞당긴다.
        var due = it.due ? parseYmd(it.due) : null;
        if (due) {
          var recur = normRecur(it.recur);
          do {
            due = recur === 'monthly' ? addOneMonth(due) : addDays(due, 7);
          } while (due.getTime() < today.getTime());
          it.due = ymd(due);
        }
        it.updated_at = nowIso();
        changed = true;
      }
    });
    if (changed && persist) save(doc);
    return doc;
  }

  function remove(id) {
    var doc = load();
    var it = find(doc, id);
    if (!it) return false;
    it.deleted = true;
    it.updated_at = nowIso();
    save(doc);
    return true;
  }

  // ───────────────────────── 순수 병합(드라이브 동기화 대상) ─────────────────────────

  function mergeDocs(a, b) {
    var merged = {};
    [a || {}, b || {}].forEach(function (src) {
      (src.items || []).forEach(function (it) {
        var iid = it.id;
        if (!iid) return;
        var cur = merged[iid];
        if (!cur || parseTs(it.updated_at) >= parseTs(cur.updated_at)) merged[iid] = it;
      });
    });
    return {
      version: SCHEMA_VERSION,
      updated_at: nowIso(),
      items: Object.keys(merged).map(function (k) { return merged[k]; })
    };
  }

  function purgeOldTombstones(doc, ttlDays) {
    ttlDays = ttlDays || TOMBSTONE_TTL_DAYS;
    var cutoff = Date.now() / 1000 - ttlDays * 86400;
    var kept = (doc.items || []).filter(function (it) {
      return !(it.deleted && parseTs(it.updated_at) < cutoff);
    });
    return { version: doc.version || SCHEMA_VERSION, updated_at: doc.updated_at, items: kept };
  }

  // 드라이브에서 받은 문서로 로컬을 교체(병합 결과 저장). drive.js가 호출.
  function replaceAll(doc) {
    save({ version: SCHEMA_VERSION, updated_at: nowIso(), items: (doc && doc.items) || [] });
  }

  global.Store = {
    SCHEMA_VERSION: SCHEMA_VERSION,
    TAGS: TAGS,
    RECURS: RECURS,
    WEEKDAY_LABELS: WEEKDAY_LABELS,
    // 유틸
    nowIso: nowIso,
    todayLocal: todayLocal,
    ymd: ymd,
    parseYmd: parseYmd,
    pyWeekday: pyWeekday,
    computeWake: computeWake,
    // 저장
    load: load,
    save: save,
    replaceAll: replaceAll,
    // 조회
    listItems: listItems,
    // CRUD
    add: add,
    edit: edit,
    toggleDone: toggleDone,
    wakeDueRecurring: wakeDueRecurring,
    remove: remove,
    // 병합
    mergeDocs: mergeDocs,
    purgeOldTombstones: purgeOldTombstones
  };
})(window);
