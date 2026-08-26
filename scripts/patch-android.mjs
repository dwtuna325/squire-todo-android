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
