/* notifications.js — 마감일 로컬 알림 엔진(Capacitor Local Notifications).
 *
 * 규칙(사용자 지정):
 *   - 마감일(due)이 **평일** → 그날 09:30
 *   - 마감일이 **주말(토·일)** → 그날 12:00
 *   - '며칠 전 미리 알림'(leadDays)이 있으면 그만큼 당겨서, 당겨진 날짜의 요일 기준으로 시각 적용
 *
 * 앱이 꺼져 있어도 안드로이드 AlarmManager로 발생(서버·토큰 0).
 * 항목이 바뀔 때마다 rescheduleAll()로 전량 재예약(todo id ↔ 안정적 정수 알림 id).
 * 브라우저(플러그인 없음)에서는 전부 no-op.
 */
(function (global) {
  'use strict';

  var S = global.Store;
  var CHANNEL_ID = 'squire-due';
  var DEFAULTS = { enabled: true, weekdayTime: '09:30', weekendTime: '12:00', leadDays: 0 };

  function plugin() {
    return (global.Capacitor && global.Capacitor.Plugins && global.Capacitor.Plugins.LocalNotifications) || null;
  }

  function cfg() {
    if (global.Settings && global.Settings.notifyConfig) return global.Settings.notifyConfig();
    return Object.assign({}, DEFAULTS);
  }

  // 12hex 문자열 id → 안정적인 양의 정수(안드 알림 id는 int). djb2 해시.
  function notifId(hex) {
    var h = 5381;
    for (var i = 0; i < hex.length; i++) h = ((h << 5) + h + hex.charCodeAt(i)) | 0;
    return Math.abs(h) % 2000000000 + 1;
  }

  function parseHM(s) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(s || '');
    if (!m) return null;
    var hh = +m[1], mm = +m[2];
    if (hh > 23 || mm > 59) return null;
    return { h: hh, m: mm };
  }

  // 마감일(YYYY-MM-DD) → 알림 발생 Date. 주말/평일 규칙 + leadDays 적용.
  function fireAt(dueYmd, c) {
    var due = S.parseYmd(dueYmd);
    if (!due) return null;
    var day = new Date(due.getFullYear(), due.getMonth(), due.getDate() - (c.leadDays || 0));
    var wd = S.pyWeekday(day);            // 0=월 … 6=일
    var weekend = (wd === 5 || wd === 6); // 토·일
    var hm = parseHM(weekend ? c.weekendTime : c.weekdayTime) || { h: 9, m: 0 };
    return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hm.h, hm.m, 0, 0);
  }

  // 현재 할 일 목록 → 예약할 알림 배열. 마감일 있고·미완료·미삭제·미래 시각인 것만.
  function buildNotifications() {
    var c = cfg();
    if (!c.enabled) return [];
    var doc = S.wakeDueRecurring();
    var now = Date.now();
    var out = [];
    (doc.items || []).forEach(function (it) {
      if (it.deleted || it.done || !it.due) return;
      var at = fireAt(it.due, c);
      if (!at || at.getTime() <= now) return; // 이미 지난 시각은 즉시 울리지 않게 건너뜀
      out.push({
        id: notifId(it.id),
        title: (c.leadDays ? '📝 마감 임박' : '📝 오늘 마감') + ' · ' + (it.tag || ''),
        body: it.text + (it.due ? '  (마감 ' + it.due + ')' : ''),
        schedule: { at: at, allowWhileIdle: true },
        channelId: CHANNEL_ID
      });
    });
    return out;
  }

  async function ensurePermission() {
    var p = plugin();
    if (!p) return false;
    try {
      var st = await p.checkPermissions();
      if (st.display !== 'granted') st = await p.requestPermissions();
      return st.display === 'granted';
    } catch (e) { return false; }
  }

  async function ensureChannel() {
    var p = plugin();
    if (!p || !p.createChannel) return;
    try {
      await p.createChannel({
        id: CHANNEL_ID, name: '마감 알림',
        description: '할 일 마감일 알림', importance: 5, visibility: 1
      });
    } catch (e) { /* 채널 미지원 OS는 무시 */ }
  }

  async function cancelAll() {
    var p = plugin();
    if (!p) return;
    try {
      var pend = await p.getPending();
      var ns = (pend && pend.notifications) || [];
      if (ns.length) await p.cancel({ notifications: ns.map(function (n) { return { id: n.id }; }) });
    } catch (e) { /* noop */ }
  }

  var running = false, again = false;
  async function rescheduleAll() {
    var p = plugin();
    if (!p) return;                 // 브라우저: no-op
    if (running) { again = true; return; } // 재진입 방지(마지막 상태로 한 번 더)
    running = true;
    try {
      await cancelAll();
      var c = cfg();
      if (c.enabled) {
        var granted = await ensurePermission();
        if (granted) {
          var list = buildNotifications();
          if (list.length) {
            await ensureChannel();
            await p.schedule({ notifications: list });
          }
        }
      }
    } catch (e) { /* swallow */ }
    running = false;
    if (again) { again = false; rescheduleAll(); }
  }

  async function init() {
    if (!plugin()) return; // 브라우저
    await ensureChannel();
    await rescheduleAll();
    // 포그라운드 복귀 시 재예약(날짜 경과·시각 변경 반영)
    var App = global.Capacitor && global.Capacitor.Plugins && global.Capacitor.Plugins.App;
    if (App && App.addListener) {
      try {
        App.addListener('appStateChange', function (st) { if (st && st.isActive) rescheduleAll(); });
      } catch (e) { /* noop */ }
    }
  }

  global.Notify = {
    init: init,
    rescheduleAll: rescheduleAll,
    fireAt: fireAt,           // 설정 미리보기용(순수 계산)
    notifId: notifId,
    DEFAULTS: DEFAULTS,
    isAvailable: function () { return !!plugin(); }
  };
})(window);
