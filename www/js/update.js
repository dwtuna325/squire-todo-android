/* update.js — 최신버전 확인 + 새 버전 알림(방식 A: 확인 후 수동 설치).
 *
 * 시작 시 GitHub 최신 릴리스(APP_REPO)를 조회해 현재 앱 버전(APP_VERSION)과 비교하고,
 * 더 최신이면 상단에 "새 버전 있어요 · 받기" 배너를 띄운다. [받기]는 릴리스의 .apk 자산
 * (없으면 릴리스 페이지)을 Capacitor Browser(없으면 window.open)로 연다. 설치는 사용자가 수동.
 *
 * 원칙: 순수 fetch(토큰0)·개인정보 전송 없음·네트워크 실패나 릴리스 미존재(404)면 조용히 무시.
 * '닫기'로 무시한 버전은 localStorage에 기억해 다시 조를 때까지 재알림하지 않는다.
 */
(function (global) {
  'use strict';

  var REPO = global.APP_REPO || 'dwtuna325/squire-todo-android';
  var CURRENT = global.APP_VERSION || '0.0.0';
  var DISMISS_KEY = 'squire.update.dismissed';   // 사용자가 '닫기'한 버전
  var CHECK_TTL_MS = 6 * 60 * 60 * 1000;          // 조회 최소 간격(6시간) — API 예의상
  var CHECK_TS_KEY = 'squire.update.lastcheck';

  // ── 버전 비교(간단 semver) — "v1.2.0"·"1.2"·"1.2.0-beta" 허용. 숫자 세그먼트만 비교 ──
  function parseVer(s) {
    s = String(s == null ? '' : s).trim().replace(/^v/i, '');
    var core = s.split(/[-+]/)[0];                // 프리릴리스/빌드메타 절단
    return core.split('.').map(function (n) {
      var v = parseInt(n, 10); return isNaN(v) ? 0 : v;
    });
  }
  // a<b → -1, a==b → 0, a>b → 1
  function cmpVer(a, b) {
    var x = parseVer(a), y = parseVer(b);
    var len = Math.max(x.length, y.length);
    for (var i = 0; i < len; i++) {
      var d = (x[i] || 0) - (y[i] || 0);
      if (d) return d > 0 ? 1 : -1;
    }
    return 0;
  }

  function lsGet(k) { try { return global.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { global.localStorage.setItem(k, v); } catch (e) {} }

  function browserPlugin() {
    return global.Capacitor && global.Capacitor.Plugins && global.Capacitor.Plugins.Browser;
  }
  function openUrl(url) {
    var b = browserPlugin();
    if (b && b.open) { b.open({ url: url }); return; }
    try { global.open(url, '_blank'); } catch (e) {}
  }

  // 릴리스 자산에서 .apk 다운로드 URL을 고른다(없으면 릴리스 페이지).
  function pickDownloadUrl(rel) {
    var assets = (rel && rel.assets) || [];
    for (var i = 0; i < assets.length; i++) {
      if (/\.apk$/i.test(assets[i].name || '')) return assets[i].browser_download_url;
    }
    return (rel && rel.html_url) || ('https://github.com/' + REPO + '/releases/latest');
  }

  // ── 배너 렌더 ──
  function showBanner(latest, downloadUrl) {
    var box = global.document && global.document.getElementById('update-banner');
    if (!box) return;
    box.innerHTML = '';
    var msg = global.document.createElement('span');
    msg.textContent = '🎉 새 버전 ' + latest + ' 있어요 (현재 ' + CURRENT + ')';
    var actions = global.document.createElement('span');
    actions.className = 'u-actions';
    var get = global.document.createElement('button');
    get.type = 'button'; get.className = 'btn'; get.textContent = '받기';
    get.addEventListener('click', function () { openUrl(downloadUrl); });
    var close = global.document.createElement('button');
    close.type = 'button'; close.className = 'btn ghost'; close.textContent = '닫기';
    close.addEventListener('click', function () {
      lsSet(DISMISS_KEY, latest);
      box.hidden = true;
    });
    actions.appendChild(get); actions.appendChild(close);
    box.appendChild(msg); box.appendChild(actions);
    box.hidden = false;
  }

  // ── 최신 릴리스 조회 → 비교 → (필요시) 배너 ──
  function check(force) {
    if (!force) {
      var last = parseInt(lsGet(CHECK_TS_KEY) || '0', 10);
      // now_ms: Date.now 사용(런타임 브라우저). 최근 6시간 내 조회했으면 건너뜀.
      if (last && (nowMs() - last) < CHECK_TTL_MS) return Promise.resolve(null);
    }
    lsSet(CHECK_TS_KEY, String(nowMs()));
    var url = 'https://api.github.com/repos/' + REPO + '/releases/latest';
    return fetch(url, { headers: { 'Accept': 'application/vnd.github+json' } })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (rel) {
        if (!rel || !rel.tag_name) return null;
        var latest = String(rel.tag_name).replace(/^v/i, '');
        if (cmpVer(latest, CURRENT) <= 0) return null;      // 최신 아님
        if (lsGet(DISMISS_KEY) === latest) return null;      // 이 버전은 이미 '닫기'함
        showBanner(latest, pickDownloadUrl(rel));
        return latest;
      })
      .catch(function () { return null; });                  // 오프라인 등 → 조용히 무시
  }

  function nowMs() { try { return Date.now(); } catch (e) { return 0; } }

  function init() { check(false); }

  global.Update = { init: init, check: check, _cmpVer: cmpVer, _parseVer: parseVer };

  // 문서가 있으면(=실제 앱/브라우저) 자체 부팅. vm 테스트(document 없음)에선 건너뜀.
  if (global.document && global.document.addEventListener) {
    if (global.document.readyState === 'loading') {
      global.document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  }
})(window);
