/* gen-version.mjs — 앱 버전 단일 출처(package.json) → www/js/version.js 재생성.
 *
 * update.js 가 이 값을 GitHub 최신 릴리스와 비교한다. 버전을 올릴 땐 **package.json 의
 * version 만** 바꾸면 되고, 이 스크립트가 웹(version.js)·네이티브(patch-android)로 전파한다.
 *
 * CI에서 `cap sync` 전에 1회 실행(웹 자산에 최신 버전이 박히도록). 로컬에선 `npm run gen:version`.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
// 배포처 저장소(owner/repo) — CI면 GITHUB_REPOSITORY, 아니면 기본값. 릴리스 조회 API의 대상.
const repo = process.env.GITHUB_REPOSITORY || 'dwtuna325/squire-todo-android';

const out =
  '/* version.js — 자동생성물(scripts/gen-version.mjs). 직접 수정 금지.\n' +
  ' * 버전을 올리려면 package.json 의 "version" 을 바꾸고 재빌드하세요. */\n' +
  "window.APP_VERSION = '" + pkg.version + "';\n" +
  "window.APP_REPO = '" + repo + "';\n";

writeFileSync('www/js/version.js', out, 'utf8');
console.log('✓ www/js/version.js →', pkg.version, '(' + repo + ')');
