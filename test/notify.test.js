/* notifications.js fireAt 규칙 검증(노드). Capacitor 없음 → plugin은 null이지만
 * fireAt/DEFAULTS는 순수 계산이라 검증 가능. 평일 09:30 / 주말 12:00 / leadDays 확인. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const win = {
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  crypto: { getRandomValues: (a) => { crypto.randomFillSync(Buffer.from(a.buffer)); return a; } }
};
const ctx = { window: win };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'www', 'js', 'store.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'www', 'js', 'notifications.js'), 'utf8'), ctx);
const S = ctx.window.Store, N = ctx.window.Notify;

let pass = 0, fail = 0;
function ok(c, m) { if (c) pass++; else { fail++; console.log('  ✗ ' + m); } }

function expectRule(due, lead) {
  const c = Object.assign({}, N.DEFAULTS, { leadDays: lead || 0 });
  const at = N.fireAt(due, c);
  // 당겨진 날짜(발생일)의 요일로 기대 시각 결정
  const d = S.parseYmd(due);
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate() - (lead || 0));
  const wd = S.pyWeekday(day);
  const weekend = (wd === 5 || wd === 6);
  const wantH = weekend ? 12 : 9, wantM = weekend ? 0 : 30;
  ok(at.getFullYear() === day.getFullYear() && at.getMonth() === day.getMonth() && at.getDate() === day.getDate(),
    'fireAt 날짜 = 발생일 (' + due + ', lead ' + (lead || 0) + ')');
  ok(at.getHours() === wantH && at.getMinutes() === wantM,
    (weekend ? '주말 12:00' : '평일 09:30') + ' 규칙 (' + due + ' → ' + at.getHours() + ':' + at.getMinutes() + ')');
}

// 2026-08-26 수요일(평일), 08-29 토요일, 08-30 일요일
expectRule('2026-08-26', 0); // 평일
expectRule('2026-08-28', 0); // 금요일 평일
expectRule('2026-08-29', 0); // 토요일 주말
expectRule('2026-08-30', 0); // 일요일 주말
expectRule('2026-08-29', 1); // 토요일 마감, 하루전=금요일 → 평일 09:30
expectRule('2026-08-31', 1); // 월요일 마감, 하루전=일요일 → 주말 12:00

// notifId: 결정적·양수·동일 입력 동일 출력
const id1 = N.notifId('abc123def456');
const id2 = N.notifId('abc123def456');
ok(id1 === id2 && id1 > 0, 'notifId 결정적·양수');
ok(N.notifId('abc123def456') !== N.notifId('abc123def457'), '다른 id → 다른 정수(일반적으로)');

console.log('\n결과: ' + pass + ' 통과, ' + fail + ' 실패');
process.exit(fail ? 1 : 0);
