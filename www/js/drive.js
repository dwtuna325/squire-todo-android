/* drive.js — 구글 드라이브 동기화(Squire-Sync/todos.json).
 *
 * PC의 src/todo_sync.py 를 폰(Capacitor)으로 옮긴 것. 같은 폴더/파일/병합 규칙을 써
 * 집·회사 PC와 폰이 하나의 todos.json 을 공유한다.
 *   - 병합: Store.mergeDocs(최종수정승리) + purgeOldTombstones — PC와 동일
 *   - 계좌번호(secret)로 보이는 활성 항목이 있으면 **업로드 중단**(평문 반출 차단)
 *   - 외부 LLM 미사용(순수 파일 동기화, 토큰 0)
 *
 * 인증: 설치형 앱 OAuth 2.0 + PKCE(공개 클라이언트, 시크릿 없음).
 *   시스템 브라우저로 동의 → 커스텀 스킴 리다이렉트(code) → 토큰 교환 → refresh_token 로컬 보관.
 *   드라이브는 fetch REST 호출. 브라우저 미리보기(플러그인 없음)에서는 안내만.
 */
(function (global) {
  'use strict';

  var S = global.Store;
  var CFG = global.GCONFIG || {};
  var FOLDER_NAME = 'Squire-Sync';
  var REMOTE_NAME = 'todos.json';
  var AUTH_KEY = 'squire.gauth';       // { refresh_token, access_token, expiry }
  var STATUS_KEY = 'squire.syncstatus'; // { ok, when, count, error }
  var PKCE_KEY = 'squire.pkce';         // 진행 중 인증의 code_verifier

  var TOKEN_URL = 'https://oauth2.googleapis.com/token';
  var AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
  var API = 'https://www.googleapis.com/drive/v3';
  var UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

  var _dirty = false;

  // ───────────────────────── 플러그인/환경 ─────────────────────────
  function browserPlugin() { return global.Capacitor && global.Capacitor.Plugins && global.Capacitor.Plugins.Browser; }
  function appPlugin() { return global.Capacitor && global.Capacitor.Plugins && global.Capacitor.Plugins.App; }
  function isNative() { return !!(global.Capacitor && global.Capacitor.isNativePlatform && global.Capacitor.isNativePlatform()); }
  function configured() { return CFG.clientId && CFG.clientId.indexOf('YOUR_') !== 0; }

  // 네트워크가 멈춰도 동기화가 무한 대기(모달 안 닫힘)하지 않도록 타임아웃 fetch.
  function timedFetch(url, opts, ms) {
    opts = opts || {};
    ms = ms || 30000;
    if (typeof AbortController === 'undefined') return fetch(url, opts); // 구형 폴백
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, ms);
    opts.signal = ctrl.signal;
    return fetch(url, opts).then(
      function (r) { clearTimeout(timer); return r; },
      function (e) {
        clearTimeout(timer);
        throw (e && e.name === 'AbortError') ? new Error('네트워크 응답 시간 초과(30초)') : e;
      }
    );
  }

  // ───────────────────────── 상태 저장 ─────────────────────────
  function loadAuth() { try { return JSON.parse(global.localStorage.getItem(AUTH_KEY) || '{}'); } catch (e) { return {}; } }
  function saveAuth(a) { global.localStorage.setItem(AUTH_KEY, JSON.stringify(a || {})); }
  function loadStatus() { try { return JSON.parse(global.localStorage.getItem(STATUS_KEY) || 'null'); } catch (e) { return null; } }
  function saveStatus(s) { global.localStorage.setItem(STATUS_KEY, JSON.stringify(s)); }

  function isLinked() { return !!(loadAuth().refresh_token); }

  function statusLine() {
    if (!configured()) return '☁️ 동기화: gconfig.js에 OAuth 클라이언트 ID를 넣어야 합니다.';
    if (!isLinked()) return '☁️ 동기화: 미연결 — 구글 계정을 연결하세요.';
    var d = loadStatus();
    if (!d) return '☁️ 동기화: 연결됨(아직 동기화 기록 없음)';
    if (d.ok) return '☁️ 동기화: ✅ ' + d.when + ' (항목 ' + (d.count == null ? '?' : d.count) + '개)';
    return '☁️ 동기화: ⚠️ 마지막 실패 — ' + (d.error || '');
  }

  // ───────────────────────── PKCE ─────────────────────────
  function b64url(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function randomVerifier() {
    var a = new Uint8Array(32);
    (global.crypto || global.msCrypto).getRandomValues(a);
    return b64url(a);
  }
  async function challengeOf(verifier) {
    var data = new TextEncoder().encode(verifier);
    var digest = await global.crypto.subtle.digest('SHA-256', data);
    return b64url(new Uint8Array(digest));
  }

  // ───────────────────────── 인증(연결) ─────────────────────────
  async function link() {
    if (!configured()) { toast('먼저 gconfig.js에 OAuth 클라이언트 ID를 넣어주세요.'); return; }
    if (!isNative() || !browserPlugin()) { toast('설치된 앱에서만 구글 로그인이 됩니다(브라우저 미리보기 불가).'); return; }
    var verifier = randomVerifier();
    global.localStorage.setItem(PKCE_KEY, verifier);
    var challenge = await challengeOf(verifier);
    var params = new URLSearchParams({
      client_id: CFG.clientId,
      redirect_uri: CFG.redirectUri,
      response_type: 'code',
      scope: CFG.scope,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      access_type: 'offline',
      prompt: 'consent'
    });
    try { await browserPlugin().open({ url: AUTH_URL + '?' + params.toString() }); }
    catch (e) { toast('브라우저를 열 수 없습니다.'); }
  }

  // 커스텀 스킴 리다이렉트 수신 → 코드 교환
  async function handleRedirect(url) {
    try {
      var q = url.split('?')[1] || '';
      var p = new URLSearchParams(q);
      var code = p.get('code');
      var err = p.get('error');
      if (browserPlugin() && browserPlugin().close) { try { await browserPlugin().close(); } catch (e) {} }
      if (err) { toast('로그인 취소/실패: ' + err); return; }
      if (!code) return;
      var verifier = global.localStorage.getItem(PKCE_KEY) || '';
      var body = new URLSearchParams({
        client_id: CFG.clientId,
        code: code,
        code_verifier: verifier,
        grant_type: 'authorization_code',
        redirect_uri: CFG.redirectUri
      });
      var res = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
      var tok = await res.json();
      if (!res.ok) { toast('토큰 교환 실패: ' + (tok.error || res.status)); return; }
      var auth = loadAuth();
      auth.access_token = tok.access_token;
      auth.expiry = Date.now() + (tok.expires_in || 3600) * 1000 - 60000;
      if (tok.refresh_token) auth.refresh_token = tok.refresh_token;
      saveAuth(auth);
      global.localStorage.removeItem(PKCE_KEY);
      toast('구글 드라이브 연결됨');
      refreshSettings();
      syncNow();
    } catch (e) { toast('연결 처리 오류'); }
  }

  function unlink() {
    saveAuth({});
    global.localStorage.removeItem(STATUS_KEY);
    toast('연결 해제됨');
    refreshSettings();
  }

  // ───────────────────────── 액세스 토큰 ─────────────────────────
  async function accessToken() {
    var auth = loadAuth();
    if (!auth.refresh_token) throw new Error('미연결');
    if (auth.access_token && auth.expiry && Date.now() < auth.expiry) return auth.access_token;
    var body = new URLSearchParams({
      client_id: CFG.clientId,
      refresh_token: auth.refresh_token,
      grant_type: 'refresh_token'
    });
    var res = await timedFetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
    var tok = await res.json();
    if (!res.ok) throw new Error('토큰 갱신 실패: ' + (tok.error || res.status));
    auth.access_token = tok.access_token;
    auth.expiry = Date.now() + (tok.expires_in || 3600) * 1000 - 60000;
    if (tok.refresh_token) auth.refresh_token = tok.refresh_token;
    saveAuth(auth);
    return auth.access_token;
  }

  async function api(url, opts) {
    var t = await accessToken();
    opts = opts || {};
    opts.headers = Object.assign({ Authorization: 'Bearer ' + t }, opts.headers || {});
    return timedFetch(url, opts);
  }

  // ───────────────────────── 드라이브 헬퍼 ─────────────────────────
  async function getOrCreateFolder() {
    var q = "name='" + FOLDER_NAME + "' and mimeType='application/vnd.google-apps.folder' and trashed=false";
    var res = await api(API + '/files?q=' + encodeURIComponent(q) + '&spaces=drive&fields=files(id,name)');
    var j = await res.json();
    if (j.files && j.files.length) return j.files[0].id;
    var meta = { name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' };
    var cr = await api(API + '/files?fields=id', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(meta) });
    var cj = await cr.json();
    return cj.id;
  }

  async function findRemote(folderId) {
    var q = "name='" + REMOTE_NAME + "' and '" + folderId + "' in parents and trashed=false";
    var res = await api(API + '/files?q=' + encodeURIComponent(q) + '&spaces=drive&fields=files(id,name)');
    var j = await res.json();
    return (j.files && j.files.length) ? j.files[0].id : null;
  }

  async function downloadRemote(fileId) {
    var res = await api(API + '/files/' + fileId + '?alt=media');
    if (!res.ok) return { version: S.SCHEMA_VERSION, items: [] };
    try {
      var doc = await res.json();
      if (doc && Array.isArray(doc.items)) return doc;
    } catch (e) {}
    return { version: S.SCHEMA_VERSION, items: [] };
  }

  async function uploadRemote(fileId, folderId, doc) {
    var content = JSON.stringify(doc, null, 2);
    if (fileId) {
      return api(UPLOAD + '/files/' + fileId + '?uploadType=media', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: content
      });
    }
    // 신규 생성 — 메타 + 내용 멀티파트
    var boundary = 'sq' + Math.abs(hash(content)).toString(16);
    var meta = { name: REMOTE_NAME, parents: [folderId] };
    var multipart =
      '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(meta) +
      '\r\n--' + boundary + '\r\nContent-Type: application/json\r\n\r\n' + content +
      '\r\n--' + boundary + '--';
    return api(UPLOAD + '/files?uploadType=multipart&fields=id', {
      method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }, body: multipart
    });
  }

  function hash(s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }

  // ───────────────────────── 계좌번호 가드(secret 평문 반출 차단) ─────────────────────────
  // PC data_policy.looks_like_account 와 같은 취지의 방어적 휴리스틱.
  function looksLikeAccount(text) {
    text = String(text || '');
    if (!/\d/.test(text)) return false;
    // 하이픈/공백으로 구분된 숫자 그룹(계좌·카드 형태) 또는 10~16자리 연속 숫자
    var groups = text.match(/\d[\d\- ]{8,}\d/g) || [];
    for (var i = 0; i < groups.length; i++) {
      var digits = groups[i].replace(/[^\d]/g, '');
      if (digits.length >= 10 && digits.length <= 16) return true;
    }
    return false;
  }

  function accountGuard(doc) {
    var bad = [];
    (doc.items || []).forEach(function (it) {
      if (it.deleted) return;
      if (looksLikeAccount(it.text)) bad.push(it.text);
    });
    return bad;
  }

  // ───────────────────────── 동기화 ─────────────────────────
  var syncing = false;
  async function syncNow(opts) {
    opts = opts || {};
    if (!configured() || !isLinked()) { if (!opts.silent) toast('먼저 구글 계정을 연결하세요.'); return; }
    if (syncing) { _dirty = true; return; }
    syncing = true;
    if (!opts.silent) showSyncProgress();
    var when = new Date();
    var out = { ok: false, count: null, error: null, when: fmt(when) };
    try {
      var folderId = await getOrCreateFolder();
      var fileId = await findRemote(folderId);
      var remote = fileId ? await downloadRemote(fileId) : { items: [] };
      var merged = S.purgeOldTombstones(S.mergeDocs(S.load(), remote));

      // 계좌번호 가드 — 로컬 병합은 반영하되 업로드는 멈춤
      var bad = accountGuard(merged);
      if (bad.length) {
        S.replaceAll(merged);
        if (global.renderTodos) global.renderTodos();
        out.error = '계좌번호로 보이는 항목이 있어 동기화를 멈췄습니다. 해당 할 일에서 번호를 지운 뒤 다시 시도하세요.';
        saveStatus(out); refreshSettings(); updateTodoSyncLine();
        if (!opts.silent) { hideSyncProgress(); showSyncResult(out); }
        syncing = false; return;
      }

      S.replaceAll(merged);
      await uploadRemote(fileId, folderId, merged);
      if (global.renderTodos) global.renderTodos();
      if (global.Notify && global.Notify.rescheduleAll) global.Notify.rescheduleAll();
      out.ok = true;
      out.count = (merged.items || []).filter(function (i) { return !i.deleted; }).length;
    } catch (e) {
      out.error = (e && e.message) || String(e);
    }
    saveStatus(out);
    refreshSettings();
    updateTodoSyncLine();
    if (!opts.silent) { hideSyncProgress(); showSyncResult(out); }
    syncing = false;
    if (_dirty) { _dirty = false; syncNow({ silent: true }); }
  }

  function markDirty() {
    _dirty = true;
    updateTodoSyncLine();
    // 로컬 편집은 즉시 자동 업로드하지 않는다(네트워크·레이트리밋 절약).
    // 앱 시작/포그라운드 복귀/‘지금 동기화’에서 반영. 필요 시 아래 주석 해제로 자동화 가능.
    // if (isLinked()) syncNow({ silent: true });
  }

  // ───────────────────────── UI 연동 ─────────────────────────
  function toast(m) { if (global.toastMsg) global.toastMsg(m); }

  // 동기화 진행중 모달(‘지금 동기화’ 등 수동 동기화에서만)
  function showSyncProgress() {
    var o = document.getElementById('sync-overlay');
    if (o) { o.hidden = false; o.setAttribute('aria-hidden', 'false'); }
    var r = document.getElementById('sync-result');
    if (r) r.hidden = true; // 이전 결과는 숨기고 시작
  }
  function hideSyncProgress() {
    var o = document.getElementById('sync-overlay');
    if (o) { o.hidden = true; o.setAttribute('aria-hidden', 'true'); }
  }
  // 동기화 결과를 상단 배너에 출력(성공=초록·6초 후 자동사라짐 / 실패=빨강·수동 닫기)
  var _srTimer = null;
  function showSyncResult(out) {
    var box = document.getElementById('sync-result');
    if (!box) return;
    box.className = 'msg' + (out.ok ? ' ok' : ' warn');
    box.innerHTML = '';
    var span = document.createElement('span');
    span.textContent = out.ok
      ? ('✅ 동기화 완료 · 항목 ' + out.count + '개 · ' + out.when)
      : ('⚠️ 동기화 실패 — ' + (out.error || '알 수 없는 오류'));
    var close = document.createElement('button');
    close.type = 'button'; close.className = 'sr-close'; close.textContent = '✕';
    close.setAttribute('aria-label', '닫기');
    close.addEventListener('click', function () { box.hidden = true; });
    box.appendChild(span); box.appendChild(close);
    box.hidden = false;
    if (_srTimer) { clearTimeout(_srTimer); _srTimer = null; }
    if (out.ok) _srTimer = setTimeout(function () { box.hidden = true; }, 6000);
  }
  function refreshSettings() {
    var scr = document.getElementById('screen-settings');
    if (scr && scr.classList.contains('active') && global.Settings && global.Settings.render) global.Settings.render();
  }
  function updateTodoSyncLine() {
    var line = document.getElementById('sync-line');
    var btn = document.getElementById('btn-sync-now');
    if (line) line.textContent = statusLine();
    if (btn) btn.hidden = !(configured() && isLinked());
  }
  function fmt(d) {
    function p(n) { return ('0' + n).slice(-2); }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  // ───────────────────────── 초기화 ─────────────────────────
  function init() {
    updateTodoSyncLine();
    var btn = document.getElementById('btn-sync-now');
    if (btn) btn.addEventListener('click', function () { syncNow(); });

    var App = appPlugin();
    if (App && App.addListener) {
      try {
        App.addListener('appUrlOpen', function (data) {
          if (data && data.url && data.url.indexOf(CFG.redirectUri) === 0) handleRedirect(data.url);
        });
        App.addListener('appStateChange', function (st) { if (st && st.isActive && isLinked()) syncNow({ silent: true }); });
      } catch (e) {}
    }
    // 앱 시작 시 1회 당겨오기(연결돼 있으면)
    if (isNative() && isLinked()) syncNow({ silent: true });
  }

  global.Sync = {
    init: init,
    link: link,
    unlink: unlink,
    syncNow: syncNow,
    markDirty: markDirty,
    isLinked: isLinked,
    statusLine: statusLine,
    looksLikeAccount: looksLikeAccount // 테스트용
  };
})(window);
