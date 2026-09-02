/* patch-android.mjs — `npx cap add android` 로 생성된 네이티브 프로젝트를 보정한다.
 *
 * 하는 일:
 *   1) OAuth 커스텀 스킴 리다이렉트(com.squire.todo:/oauth2redirect)를 받도록
 *      MainActivity 에 intent-filter(VIEW/BROWSABLE, scheme=com.squire.todo)를 추가.
 *   (알림 권한 POST_NOTIFICATIONS / SCHEDULE_EXACT_ALARM 등은 @capacitor/local-notifications
 *    라이브러리 매니페스트가 자동 병합하므로 여기서 손대지 않는다.)
 *
 * CI에서 `cap add android` 직후, `cap sync` 전에 1회 실행한다. 멱등(이미 있으면 건너뜀).
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const MANIFEST = 'android/app/src/main/AndroidManifest.xml';

// OAuth 리다이렉트 스킴을 gconfig.js(단일 출처)에서 뽑는다 → gconfig만 고치면 매니페스트도 따라감.
function readScheme() {
  const g = readFileSync('www/js/gconfig.js', 'utf8');
  const m = /redirectUri:\s*["']([^"':]+):/.exec(g); // "<scheme>:/oauth2redirect" 의 <scheme>
  if (!m) {
    console.error('✗ gconfig.js 에서 redirectUri 스킴을 못 읽음');
    process.exit(1);
  }
  return m[1];
}
const SCHEME = readScheme();

if (!existsSync(MANIFEST)) {
  console.error('✗ AndroidManifest.xml 없음: ' + MANIFEST + ' — 먼저 `npx cap add android` 실행');
  process.exit(1);
}

let xml = readFileSync(MANIFEST, 'utf8');

if (xml.includes('android:scheme="' + SCHEME + '"')) {
  console.log('· OAuth 스킴 intent-filter 이미 존재 — 건너뜀');
} else {
  const filter =
    '            <intent-filter>\n' +
    '                <action android:name="android.intent.action.VIEW" />\n' +
    '                <category android:name="android.intent.category.DEFAULT" />\n' +
    '                <category android:name="android.intent.category.BROWSABLE" />\n' +
    '                <data android:scheme="' + SCHEME + '" />\n' +
    '            </intent-filter>\n';

  // MainActivity </activity> 앞에 삽입(매니페스트의 첫 activity = MainActivity)
  const idx = xml.indexOf('</activity>');
  if (idx < 0) {
    console.error('✗ </activity> 를 찾지 못함 — 매니페스트 구조 변경?');
    process.exit(1);
  }
  xml = xml.slice(0, idx) + filter + xml.slice(idx);
  writeFileSync(MANIFEST, xml, 'utf8');
  console.log('✓ OAuth 스킴 intent-filter 추가됨 (' + SCHEME + ')');
}

// ── 앱 버전 주입: package.json version → build.gradle versionName / versionCode ──
// `cap add android` 가 생성한 build.gradle 은 versionCode 1·versionName "1.0" 로 고정이라,
// 여기서 단일 출처(package.json)와 CI 빌드번호로 덮어써 업데이트가 항상 상위 버전으로 잡히게 한다.
// versionName = 사용자 표시/최신비교용, versionCode = 안드로이드 설치 판정용(단조 증가 필수).
const GRADLE = 'android/app/build.gradle';
if (existsSync(GRADLE)) {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const versionName = pkg.version;
  // CI 빌드번호(GITHUB_RUN_NUMBER)가 있으면 그걸로, 없으면 버전에서 파생(x*10000+y*100+z).
  const parts = String(versionName).split('.').map((n) => parseInt(n, 10) || 0);
  const derived = (parts[0] || 0) * 10000 + (parts[1] || 0) * 100 + (parts[2] || 0);
  const versionCode = parseInt(process.env.GITHUB_RUN_NUMBER || '', 10) || derived || 1;

  let g = readFileSync(GRADLE, 'utf8');
  const before = g;
  g = g.replace(/versionCode\s+\d+/, 'versionCode ' + versionCode);
  g = g.replace(/versionName\s+"[^"]*"/, 'versionName "' + versionName + '"');
  if (g !== before) {
    writeFileSync(GRADLE, g, 'utf8');
    console.log('✓ 버전 주입: versionName ' + versionName + ' / versionCode ' + versionCode);
  } else {
    console.error('⚠️ build.gradle 에서 versionCode/versionName 패턴을 못 찾음 — 템플릿 변경?');
  }
} else {
  console.log('· build.gradle 없음(로컬 매니페스트-only 실행) — 버전 주입 건너뜀');
}
