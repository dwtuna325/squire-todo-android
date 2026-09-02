/* update.js 순수 로직 검증(노드) — 버전 비교(semver)만 격리 실행.
 * document 를 주지 않으므로 자체 부팅/네트워크는 건너뛰고 Update._cmpVer/_parseVer 만 검사. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const code = fs.readFileSync(path.join(__dirname, '..', 'www', 'js', 'update.js'), 'utf8');
const win = { APP_VERSION: '1.1.0', APP_REPO: 'x/y' }; // document 없음 → 부팅 스킵
const ctx = { window: win };
vm.createContext(ctx);
vm.runInContext(code, ctx);
const U = ctx.window.Update;

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.log('  ✗ ' + msg); } }
function eq(a, b, msg) { ok(a === b, msg + '  (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }

// 파싱: v 접두·프리릴리스 절단
eq(JSON.stringify(U._parseVer('v1.2.3')), JSON.stringify([1, 2, 3]), 'v접두 제거');
eq(JSON.stringify(U._parseVer('1.2')), JSON.stringify([1, 2]), '두 자리');
eq(JSON.stringify(U._parseVer('1.2.0-beta.1')), JSON.stringify([1, 2, 0]), '프리릴리스 절단');

// 비교: -1/0/1
eq(U._cmpVer('1.1.0', '1.1.0'), 0, '동일 → 0');
eq(U._cmpVer('1.2.0', '1.1.0'), 1, '상위 → 1');
eq(U._cmpVer('1.0.9', '1.1.0'), -1, '하위 → -1');
eq(U._cmpVer('v1.1.1', '1.1.0'), 1, 'v접두 상위');
eq(U._cmpVer('1.1', '1.1.0'), 0, '자리수 달라도 동일');
eq(U._cmpVer('2.0.0', '1.9.9'), 1, '메이저 우선');
// "새 버전이면 알림" 판정과 동일한 방향(remote > current 일 때만 알림)
ok(U._cmpVer('1.2.0', '1.1.0') > 0, '원격이 최신이면 >0(알림 대상)');
ok(U._cmpVer('1.1.0', '1.1.0') <= 0, '같은 버전은 무알림');

console.log('\n결과: ' + pass + ' 통과, ' + fail + ' 실패');
process.exit(fail ? 1 : 0);
