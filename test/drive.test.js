/* drive.js 계좌번호 가드 검증(노드). Capacitor/DOM 없이 순수 휴리스틱만 확인. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const win = {
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  crypto: { getRandomValues: (a) => { crypto.randomFillSync(Buffer.from(a.buffer)); return a; }, subtle: {} },
  document: { getElementById: () => null },
  btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
  TextEncoder: TextEncoder,
  URLSearchParams: URLSearchParams,
  fetch: () => Promise.reject(new Error('no net'))
};
win.window = win;
const ctx = { window: win, document: win.document, Math: Math, Date: Date, JSON: JSON };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'www', 'js', 'store.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'www', 'js', 'drive.js'), 'utf8'), ctx);
const D = ctx.window.Sync;

let pass = 0, fail = 0;
function ok(c, m) { if (c) pass++; else { fail++; console.log('  ✗ ' + m); } }

// 계좌번호로 보여야 하는 것
ok(D.looksLikeAccount('국민 110-234-567890 이체'), '하이픈 계좌형 감지');
ok(D.looksLikeAccount('1002123456789'), '13자리 연속 숫자 감지');
ok(D.looksLikeAccount('카드 1234 5678 9012 3456'), '공백 구분 16자리 감지');
// 계좌번호가 아니어야 하는 것
ok(!D.looksLikeAccount('보고서 초안 작성'), '일반 텍스트 통과');
ok(!D.looksLikeAccount('회의 3시'), '짧은 숫자 통과');
ok(!D.looksLikeAccount('2026-08-25 마감'), '날짜는 통과');
ok(!D.looksLikeAccount('방 5번 예약'), '단일 숫자 통과');

console.log('\n결과: ' + pass + ' 통과, ' + fail + ' 실패');
process.exit(fail ? 1 : 0);
