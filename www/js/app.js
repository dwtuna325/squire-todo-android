/* app.js — 화면 컨트롤러(렌더링 + 상호작용).
 * PC의 templates/todo.html + todo_routes 렌더를 클라이언트 사이드로 옮긴 것.
 * 상태 변경 후엔 afterChange()가 재렌더 + (있으면) 알림 재예약 + 동기화 표시를 갱신한다.
 */
(function (global) {
  'use strict';

  var S = global.Store;
  var WD = S.WEEKDAY_LABELS;

  function $(sel, root) { return (root || document).querySelector(sel); }
  function el(id) { return document.getElementById(id); }

  function esc(s) {
    return (s === null || s === undefined ? '' : String(s))
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  var toastTimer = null;
  function toast(text) {
    var t = el('toast');
    t.textContent = text;
    t.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 1800);
  }
  global.toastMsg = toast;

  // 상태 변경 후 공통 후처리(다른 모듈이 있으면 훅 호출)
  function afterChange() {
    render();
    if (global.Notify && global.Notify.rescheduleAll) global.Notify.rescheduleAll();
    if (global.Sync && global.Sync.markDirty) global.Sync.markDirty();
  }
  global.afterChange = afterChange;

  // ───────────────────────── 항목 렌더 ─────────────────────────

  function recurBadges(it) {
    var h = '';
    if (it.recur === 'weekly') {
      var d = (it.recur_days || []).map(function (n) { return WD[n]; }).join('');
      h += '<span class="badge-recur weekly">🔁 주간' + (d ? ' · ' + esc(d) : '') + '</span>';
    }
    if (it.recur === 'monthly') {
      h += '<span class="badge-recur monthly">🔁 월간' + (it.recur_dom ? ' · ' + it.recur_dom + '일' : '') + '</span>';
    }
    return h;
  }

  function itemHtml(it, today) {
    var urgent = !it.done && it.due && it.due === today;
    var overdue = !it.done && it.due && it.due < today;
    var cls = 'item' + (it.done ? ' done' : '') + (urgent ? ' due-today' : '') + (overdue ? ' overdue' : '');

    var meta = '';
    meta += recurBadges(it);
    if (it.done && it.recur && it.wake_at) meta += '<span class="due">⏰ 다음 도래 ' + esc(it.wake_at) + '</span>';
    if (overdue) meta += '<span class="badge-overdue">⚠ 기한 초과</span>';
    if (urgent) meta += '<span class="badge-today">⚠ 오늘까지</span>';
    if (it.created_at) meta += '<span class="created">🗓 입력 ' + esc(it.created_at.slice(0, 10)) + '</span>';
    if (it.due) meta += '<span class="due">📅 마감 ' + esc(it.due) + '</span>';

    var wdBoxes = '';
    for (var i = 0; i < 7; i++) {
      var chk = (it.recur_days || []).indexOf(i) >= 0 ? ' checked' : '';
      wdBoxes += '<label class="wd-opt"><input type="checkbox" class="ed-wd" value="' + i + '"' + chk + '>' + WD[i] + '</label>';
    }

    return '' +
      '<li class="' + cls + '" data-id="' + esc(it.id) + '">' +
        '<div class="item-row">' +
          '<button class="chk act-toggle" type="button" title="완료 토글">' + (it.done ? '✓' : '') + '</button>' +
          '<div class="item-main">' +
            '<span class="txt act-note">' + esc(it.text) + (it.note ? ' <span class="note-ind" title="메모 있음">📝</span>' : '') + '</span>' +
            '<div class="meta">' + meta + '</div>' +
          '</div>' +
          '<div class="item-side">' +
            '<span class="tag ' + esc(it.tag) + '">' + esc(it.tag) + '</span>' +
            '<button class="edit act-edit" type="button">수정</button>' +
            '<button class="del act-delete" type="button">삭제</button>' +
          '</div>' +
        '</div>' +
        // 수정 패널
        '<div class="edit-panel">' +
          '<p class="note-hint">✏️ 수정 — 내용·태그·마감일·반복. 집·회사 어디서 고쳐도 동기화됩니다.</p>' +
          '<div class="edit-fields">' +
            '<input type="text" class="ed-text" value="' + esc(it.text) + '" placeholder="할 일 내용">' +
            '<select class="ed-tag">' + tagOptions(it.tag) + '</select>' +
            '<input type="date" class="ed-due" value="' + esc(it.due || '') + '" min="2000-01-01" max="9999-12-31">' +
            '<select class="ed-recur">' +
              '<option value=""' + (!it.recur ? ' selected' : '') + '>반복 없음</option>' +
              '<option value="weekly"' + (it.recur === 'weekly' ? ' selected' : '') + '>🔁 주간</option>' +
              '<option value="monthly"' + (it.recur === 'monthly' ? ' selected' : '') + '>🔁 월간</option>' +
            '</select>' +
            '<button class="note-save act-edit-save" type="button">저장</button>' +
          '</div>' +
          '<div class="recur-detail ed-weekly' + (it.recur === 'weekly' ? ' open' : '') + '">' +
            '<span class="rd-label">반복 요일</span>' + wdBoxes +
          '</div>' +
          '<div class="recur-detail ed-monthly' + (it.recur === 'monthly' ? ' open' : '') + '">' +
            '<span class="rd-label">매월</span>' +
            '<input class="dom-input ed-dom" type="number" min="1" max="31" placeholder="일자" value="' + esc(it.recur_dom || '') + '">' +
            '<span class="rd-label">일에 다시 뜸</span>' +
          '</div>' +
        '</div>' +
        // 메모 패널
        '<div class="note-panel">' +
          '<p class="note-hint">📝 메모 — 집·회사 어디서 적어도 동기화되어 보관됩니다.</p>' +
          '<textarea class="ed-note" placeholder="이 할 일에 대한 메모를 입력하세요…">' + esc(it.note || '') + '</textarea>' +
          '<div><button class="note-save act-note-save" type="button">메모 저장</button></div>' +
        '</div>' +
      '</li>';
  }

  function tagOptions(sel) {
    return S.TAGS.map(function (t) {
      return '<option value="' + t + '"' + (t === sel ? ' selected' : '') + '>' + t + '</option>';
    }).join('');
  }

  // ───────────────────────── 목록 렌더 ─────────────────────────

  function monthLabel(iso) {
    var d = S.parseYmd((iso || '').slice(0, 10));
    if (!d) return '기타';
    return d.getFullYear() + '년 ' + (d.getMonth() + 1) + '월';
  }

  function render() {
    S.wakeDueRecurring(); // 도래일 지난 반복업무 되살리기
    var today = S.ymd(S.todayLocal());
    var all = S.listItems({ includeDeleted: false });
    var active = all.filter(function (it) { return !it.done; });
    var done = all.filter(function (it) { return it.done; });

    // 활성 목록
    var list = el('todo-list');
    list.innerHTML = active.map(function (it) { return itemHtml(it, today); }).join('');
    el('empty-msg').hidden = !(active.length === 0 && done.length === 0);

    // 지난 내역(완료월별) — done_at(없으면 updated_at) 기준 내림차순
    var groups = {};
    var order = [];
    done.forEach(function (it) {
      var key = (it.done_at || it.updated_at || '').slice(0, 7); // YYYY-MM
      if (!groups[key]) { groups[key] = []; order.push(key); }
      groups[key].push(it);
    });
    order.sort(function (a, b) { return a < b ? 1 : (a > b ? -1 : 0); });
    var wrap = el('archive-wrap');
    if (!order.length) {
      wrap.hidden = true;
      el('archive-groups').innerHTML = '';
    } else {
      wrap.hidden = false;
      el('archive-groups').innerHTML = order.map(function (key) {
        var items = groups[key].sort(function (a, b) {
          return (b.done_at || '') < (a.done_at || '') ? -1 : 1;
        });
        return '<details class="archive">' +
          '<summary>' + esc(monthLabel(key + '-01')) + '<span class="arch-count">(' + items.length + ')</span></summary>' +
          '<ul class="todo" style="margin-top:12px">' + items.map(function (it) { return itemHtml(it, today); }).join('') + '</ul>' +
          '</details>';
      }).join('');
    }
  }
  global.renderTodos = render;

  // ───────────────────────── 이벤트(위임) ─────────────────────────

  function itemIdOf(node) {
    var li = node.closest('li.item');
    return li ? li.getAttribute('data-id') : null;
  }

  function onListClick(ev) {
    var t = ev.target;
    var id = itemIdOf(t);
    if (!id) return;
    var li = t.closest('li.item');

    if (t.closest('.act-toggle')) { S.toggleDone(id); afterChange(); return; }
    if (t.closest('.act-delete')) {
      if (confirm('이 할 일을 삭제할까요?')) { S.remove(id); afterChange(); toast('삭제됨'); }
      return;
    }
    if (t.closest('.act-note')) { $('.note-panel', li).classList.toggle('open'); return; }
    if (t.closest('.act-edit')) { $('.edit-panel', li).classList.toggle('open'); return; }

    if (t.closest('.act-note-save')) {
      var note = $('.ed-note', li).value;
      S.edit(id, { note: note });
      afterChange();
      toast('메모 저장됨');
      return;
    }
    if (t.closest('.act-edit-save')) {
      var recur = $('.ed-recur', li).value;
      var days = Array.prototype.map.call(li.querySelectorAll('.ed-wd:checked'), function (c) { return +c.value; });
      var dom = $('.ed-dom', li).value;
      S.edit(id, {
        text: $('.ed-text', li).value,
        tag: $('.ed-tag', li).value,
        due: $('.ed-due', li).value,
        recur: recur,
        recur_days: days,
        recur_dom: dom
      });
      afterChange();
      toast('수정 저장됨');
      return;
    }
  }

  // 수정 패널 안의 반복 select 변경 → 요일/일자 상세 토글
  function onListChange(ev) {
    var t = ev.target;
    if (!t.classList.contains('ed-recur')) return;
    var li = t.closest('li.item');
    var v = t.value;
    $('.ed-weekly', li).classList.toggle('open', v === 'weekly');
    $('.ed-monthly', li).classList.toggle('open', v === 'monthly');
  }

  // ───────────────────────── 추가 폼 ─────────────────────────

  function buildAddForm() {
    // 태그 옵션
    el('add-tag').innerHTML = S.TAGS.map(function (t) { return '<option value="' + t + '">' + t + '</option>'; }).join('');
    // 마감일 기본값 = 오늘
    el('add-due').value = S.ymd(S.todayLocal());
    // 요일 체크박스
    var boxes = '';
    for (var i = 0; i < 7; i++) {
      boxes += '<label class="wd-opt"><input type="checkbox" class="add-wd" value="' + i + '">' + WD[i] + '</label>';
    }
    el('weekday-boxes').innerHTML = boxes;

    var w = el('recur-weekly'), m = el('recur-monthly');
    w.addEventListener('change', function () {
      if (w.checked) m.checked = false;
      el('rd-weekly').classList.toggle('open', w.checked);
      el('rd-monthly').classList.toggle('open', m.checked);
    });
    m.addEventListener('change', function () {
      if (m.checked) w.checked = false;
      el('rd-weekly').classList.toggle('open', w.checked);
      el('rd-monthly').classList.toggle('open', m.checked);
    });

    el('add-form').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var f = ev.target;
      var text = f.text.value.trim();
      if (!text) return;
      var recur = w.checked ? 'weekly' : (m.checked ? 'monthly' : null);
      var days = Array.prototype.map.call(document.querySelectorAll('.add-wd:checked'), function (c) { return +c.value; });
      try {
        S.add({
          text: text,
          tag: el('add-tag').value,
          due: el('add-due').value,
          note: f.note.value,
          recur: recur,
          recur_days: days,
          recur_dom: el('add-dom').value
        });
      } catch (e) { toast(e.message || '추가 실패'); return; }
      // 폼 초기화(마감일은 오늘로 유지)
      f.text.value = '';
      f.note.value = '';
      w.checked = false; m.checked = false;
      el('rd-weekly').classList.remove('open');
      el('rd-monthly').classList.remove('open');
      Array.prototype.forEach.call(document.querySelectorAll('.add-wd'), function (c) { c.checked = false; });
      el('add-dom').value = '';
      afterChange();
      toast('추가됨');
      f.text.focus();
    });
  }

  // ───────────────────────── 탭 ─────────────────────────

  function buildTabs() {
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (tab) {
      tab.addEventListener('click', function () {
        var scr = tab.getAttribute('data-screen');
        Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (x) { x.classList.remove('active'); });
        tab.classList.add('active');
        el('screen-todo').classList.toggle('active', scr === 'todo');
        el('screen-settings').classList.toggle('active', scr === 'settings');
        if (scr === 'settings' && global.Settings && global.Settings.render) global.Settings.render();
      });
    });
  }

  // ───────────────────────── 부트 ─────────────────────────

  function boot() {
    buildTabs();
    buildAddForm();
    el('todo-list').addEventListener('click', onListClick);
    el('archive-groups').addEventListener('click', onListClick);
    el('todo-list').addEventListener('change', onListChange);
    el('archive-groups').addEventListener('change', onListChange);
    render();

    // 다른 모듈 초기화(존재할 때만) — 알림/설정/동기화
    if (global.Notify && global.Notify.init) global.Notify.init();
    if (global.Settings && global.Settings.init) global.Settings.init();
    if (global.Sync && global.Sync.init) global.Sync.init();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);
