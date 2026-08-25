/* settings.js — 설정 화면(알림 on/off·시각·미리알림 + 동기화 카드).
 * 설정은 localStorage['squire.settings']에 동기 저장(브라우저·WebView 공통).
 * notifyConfig()는 notifications.js가 동기로 읽어간다. 변경 시 즉시 알림 재예약. */
(function (global) {
  'use strict';

  var SKEY = 'squire.settings';
  var DEF = (global.Notify && global.Notify.DEFAULTS) || { enabled: true, weekdayTime: '09:30', weekendTime: '12:00', leadDays: 0 };

  function load() {
    try {
      var raw = global.localStorage.getItem(SKEY);
      var s = raw ? JSON.parse(raw) : {};
      return {
        enabled: s.enabled !== undefined ? !!s.enabled : DEF.enabled,
        weekdayTime: s.weekdayTime || DEF.weekdayTime,
        weekendTime: s.weekendTime || DEF.weekendTime,
        leadDays: s.leadDays !== undefined ? (parseInt(s.leadDays, 10) || 0) : DEF.leadDays
      };
    } catch (e) {
      return Object.assign({}, DEF);
    }
  }

  function save(s) {
    global.localStorage.setItem(SKEY, JSON.stringify(s));
  }

  // notifications.js가 호출 — 현재 알림 설정
  function notifyConfig() { return load(); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  }

  function leadOptions(sel) {
    var opts = [[0, '당일만'], [1, '하루 전'], [2, '이틀 전'], [3, '3일 전']];
    return opts.map(function (o) {
      return '<option value="' + o[0] + '"' + (o[0] === sel ? ' selected' : '') + '>' + o[1] + '</option>';
    }).join('');
  }

  function render() {
    var body = document.getElementById('settings-body');
    if (!body) return;
    var s = load();
    var syncLine = (global.Sync && global.Sync.statusLine) ? global.Sync.statusLine() : '☁️ 동기화 모듈은 다음 단계(M4)에서 연결됩니다.';
    var linked = !!(global.Sync && global.Sync.isLinked && global.Sync.isLinked());

    body.innerHTML =
      '<div class="card">' +
        '<h2>🔔 마감일 알림</h2>' +
        '<p class="hint">할 일의 <b>마감일</b>이 되면 폰에 알림이 뜹니다. 평일과 주말 시각을 따로 정할 수 있어요. (앱이 꺼져 있어도 발생)</p>' +
        '<div class="row">' +
          '<div class="label">알림 켜기' +
            '<small>끄면 예약된 알림이 모두 취소됩니다.</small></div>' +
          '<label class="switch"><input type="checkbox" id="set-enabled"' + (s.enabled ? ' checked' : '') + '><span class="slider"></span></label>' +
        '</div>' +
        '<div class="row">' +
          '<div class="label">평일 알림 시각<small>월~금 마감일 당일</small></div>' +
          '<input type="time" id="set-weekday" value="' + esc(s.weekdayTime) + '">' +
        '</div>' +
        '<div class="row">' +
          '<div class="label">주말 알림 시각<small>토·일 마감일 당일</small></div>' +
          '<input type="time" id="set-weekend" value="' + esc(s.weekendTime) + '">' +
        '</div>' +
        '<div class="row">' +
          '<div class="label">미리 알림<small>마감일보다 앞서 알림(당겨진 날의 평일/주말 시각 적용)</small></div>' +
          '<select id="set-lead">' + leadOptions(s.leadDays) + '</select>' +
        '</div>' +
        (global.Notify && global.Notify.isAvailable && !global.Notify.isAvailable()
          ? '<p class="hint" style="margin-top:12px">ℹ️ 지금은 브라우저 미리보기라 실제 알림은 예약되지 않습니다. 설치된 앱에서 동작합니다.</p>'
          : '') +
      '</div>' +

      '<div class="card">' +
        '<h2>☁️ 구글 드라이브 동기화</h2>' +
        '<p class="hint">집·회사 PC와 같은 <code>Squire-Sync/todos.json</code>을 공유합니다. 여기서 편집하면 PC에도 반영돼요.</p>' +
        '<div class="row"><div class="label">' + esc(syncLine) + '</div></div>' +
        '<div class="time-inline" style="margin-top:12px">' +
          (linked
            ? '<button class="btn" id="set-sync-now" type="button">🔄 지금 동기화</button>' +
              '<button class="btn ghost" id="set-unlink" type="button">연결 해제</button>'
            : '<button class="btn" id="set-link" type="button">구글 계정 연결</button>') +
        '</div>' +
      '</div>' +

      '<div class="card">' +
        '<h2>ℹ️ 정보</h2>' +
        '<p class="hint">Squire 할 일 · 로컬 저장 + 소유자 구글 드라이브 동기화. 외부 LLM 미사용(토큰 0), 인터넷 서버 없음.</p>' +
      '</div>';

    wire();
  }

  function wire() {
    var enabled = document.getElementById('set-enabled');
    var wd = document.getElementById('set-weekday');
    var we = document.getElementById('set-weekend');
    var lead = document.getElementById('set-lead');

    function commit() {
      var s = load();
      s.enabled = enabled.checked;
      if (wd.value) s.weekdayTime = wd.value;
      if (we.value) s.weekendTime = we.value;
      s.leadDays = parseInt(lead.value, 10) || 0;
      save(s);
      if (global.Notify && global.Notify.rescheduleAll) global.Notify.rescheduleAll();
      if (global.toastMsg) global.toastMsg('저장됨');
    }
    if (enabled) enabled.addEventListener('change', commit);
    if (wd) wd.addEventListener('change', commit);
    if (we) we.addEventListener('change', commit);
    if (lead) lead.addEventListener('change', commit);

    // 동기화 버튼(있으면)
    var b;
    if ((b = document.getElementById('set-link')) && global.Sync) b.addEventListener('click', function () { global.Sync.link(); });
    if ((b = document.getElementById('set-unlink')) && global.Sync) b.addEventListener('click', function () { global.Sync.unlink(); });
    if ((b = document.getElementById('set-sync-now')) && global.Sync) b.addEventListener('click', function () { global.Sync.syncNow(); });
  }

  function init() { /* 설정은 지연 로드(탭 열 때 render). 별도 초기화 불필요 */ }

  global.Settings = {
    init: init,
    render: render,
    notifyConfig: notifyConfig,
    load: load,
    save: save
  };
})(window);
