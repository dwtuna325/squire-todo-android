/* store.js 순수 로직 검증(노드). window/localStorage/crypto를 셰임한 뒤 실행.
 * PC의 selftest.py test_todos에 대응하는 최소 회귀 테스트. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ── 브라우저 API 셰임 ──
const mem = {};
const localStorage = {
  getItem: (k) => (k in mem ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); },
  removeItem: (k) => { delete mem[k]; }
};
const crypto = require('crypto');
const win = {
  localStorage,
  crypto: { getRandomValues: (arr) => { crypto.randomFillSync(Buffer.from(arr.buffer)); return arr; } }
};

const code = fs.readFileSync(path.join(__dirname, '..', 'www', 'js', 'store.js'), 'utf8');
const ctx = { window: win };
vm.createContext(ctx);
vm.runInContext(code, ctx);
const S = ctx.window.Store;

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.log('  ✗ ' + msg); } }
function eq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), msg + '  (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }

// 1) 기본 CRUD
mem['squire.todos'] = '';
const a = S.add({ text: '보고서 초안', tag: '업무', due: '2026-09-01' });
ok(a.id && a.id.length === 12, 'id는 12 hex');
ok(a.done === false && a.deleted === false, '신규는 미완료·미삭제');
let list = S.listItems();
eq(list.length, 1, '항목 1개');

// 2) 수정
S.edit(a.id, { text: '보고서 최종', tag: '개인' });
eq(S.listItems()[0].text, '보고서 최종', '텍스트 수정 반영');
eq(S.listItems()[0].tag, '개인', '태그 수정 반영');

// 3) 완료 토글 + 지난내역
S.toggleDone(a.id);
eq(S.listItems({ includeDone: false }).length, 0, '완료하면 미완료목록 0');
ok(S.listItems()[0].done === true, '완료 상태');
ok(!!S.listItems()[0].done_at, 'done_at 기록');

// 4) 삭제 = tombstone
S.remove(a.id);
eq(S.listItems().length, 0, '삭제하면 목록서 사라짐');
eq(S.listItems({ includeDeleted: true }).length, 1, 'tombstone은 남음');
ok(S.load().items[0].deleted === true, 'deleted=true');

// 5) 병합: 최종수정승리
const doc1 = { version: 1, items: [{ id: 'x1', text: '옛날', updated_at: '2026-08-01T10:00:00+09:00', deleted: false }] };
const doc2 = { version: 1, items: [{ id: 'x1', text: '최신', updated_at: '2026-08-20T10:00:00+09:00', deleted: false }] };
const merged = S.mergeDocs(doc1, doc2);
eq(merged.items.length, 1, '같은 id는 하나로');
eq(merged.items[0].text, '최신', 'updated_at 큰 쪽 승리');

// 6) 병합: 삭제(tombstone) 전파 — 삭제가 더 최신이면 삭제 유지
const docA = { items: [{ id: 'y1', text: '살아있음', updated_at: '2026-08-01T00:00:00+09:00', deleted: false }] };
const docB = { items: [{ id: 'y1', text: '삭제됨', updated_at: '2026-08-10T00:00:00+09:00', deleted: true }] };
const m2 = S.mergeDocs(docA, docB);
ok(m2.items[0].deleted === true, '더 최신인 삭제가 이김');

// 7) 반복(주간): 완료 시 wake_at 계산 + 도래일에 부활
mem['squire.todos'] = '';
const today = S.todayLocal();
const wk = S.add({ text: '주간회의', recur: 'weekly', recur_days: [S.pyWeekday(today)] }); // 오늘 요일 지정
S.toggleDone(wk.id);
let wkItem = S.load().items[0];
ok(wkItem.done === true && wkItem.wake_at, '주간 완료 → wake_at 설정');
// 오늘 요일 지정이면 다음 주 같은 요일(today+7)이어야
eq(wkItem.wake_at, S.ymd(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7)), 'wake_at = +7일');
// 도래일이 오늘이라고 치고 부활
const future = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7);
S.wakeDueRecurring(null, future);
ok(S.load().items[0].done === false, '도래일 도달 → 다시 할 일로 부활');

// 7b) 반복 도래 시 마감일(due)도 한 주기 앞당김 (주간 +7일)
mem['squire.todos'] = '';
const wk2 = S.add({ text: '고정팟 일정픽스', recur: 'weekly', recur_days: [0], due: '2026-09-02' });
S.toggleDone(wk2.id);
eq(S.load().items[0].due, '2026-09-02', '완료 직후엔 마감일 그대로');
S.wakeDueRecurring(null, new Date(2026, 8, 7)); // 2026-09-07(월) 도래
eq(S.load().items[0].due, '2026-09-09', '주간 도래 → 마감일 +7일');
ok(S.load().items[0].done === false, '도래로 다시 할 일');

// 7c) 여러 주기 밀렸으면 오늘 이후가 될 때까지 catch-up
mem['squire.todos'] = '';
const wk3 = S.add({ text: '밀린 주간업무', recur: 'weekly', recur_days: [0], due: '2026-09-02' });
S.toggleDone(wk3.id);
S.wakeDueRecurring(null, new Date(2026, 8, 28)); // 9/2→9/9→9/16→9/23→9/30
eq(S.load().items[0].due, '2026-09-30', '밀린 주기 catch-up → 오늘 이후 첫 마감일');

// 7d) 월간 도래 시 마감일 +1개월
mem['squire.todos'] = '';
const mo2 = S.add({ text: '월세납부', recur: 'monthly', recur_dom: 5, due: '2026-09-05' });
S.toggleDone(mo2.id);
S.wakeDueRecurring(null, new Date(2026, 9, 5)); // 2026-10-05
eq(S.load().items[0].due, '2026-10-05', '월간 도래 → 마감일 +1개월');

// 8) 반복(월간): 매월 dom
mem['squire.todos'] = '';
const mo = S.add({ text: '월세', recur: 'monthly', recur_dom: 5 });
S.toggleDone(mo.id);
const moItem = S.load().items[0];
ok(/^\d{4}-\d{2}-05$/.test(moItem.wake_at), '월간 완료 → 다음 5일로 wake_at (' + moItem.wake_at + ')');

// 9) tombstone 청소
const oldDoc = { version: 1, items: [
  { id: 'z1', deleted: true, updated_at: '2020-01-01T00:00:00+09:00' },
  { id: 'z2', deleted: false, updated_at: '2026-08-01T00:00:00+09:00' }
] };
const purged = S.purgeOldTombstones(oldDoc, 30);
eq(purged.items.length, 1, '오래된 tombstone 제거');
eq(purged.items[0].id, 'z2', '살아있는 항목은 유지');

console.log('\n결과: ' + pass + ' 통과, ' + fail + ' 실패');
process.exit(fail ? 1 : 0);
