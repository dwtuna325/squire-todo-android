/* gconfig.js — 구글 OAuth 설정. 여기 값을 본인 것으로 바꾸면 드라이브 동기화가 켜집니다.
 *
 * ⚠️ 여기 clientId는 **비밀이 아닙니다**(설치형 앱의 공개 클라이언트 ID). 커밋해도 됩니다.
 *    진짜 비밀(리프레시 토큰)은 기기 안에만 저장되고 어디에도 커밋되지 않습니다.
 *
 * 설정 방법은 README.md의 "구글 드라이브 연결(OAuth) 준비" 참고.
 *   1) Google Cloud Console → 사용자 인증 정보 → OAuth 클라이언트 ID(안드로이드)
 *      - 패키지 이름: com.squire.todo
 *      - SHA-1: 앱 서명키의 지문(CI 서명키 또는 로컬 키)
 *   2) 아래 clientId 에 발급된 값 붙여넣기
 */
window.GCONFIG = {
  // 예: "1234567890-abcdefg.apps.googleusercontent.com"
  clientId: "YOUR_ANDROID_OAUTH_CLIENT_ID.apps.googleusercontent.com",
  // 커스텀 스킴 리다이렉트(앱 딥링크). 안드로이드 매니페스트/‑build 설정과 일치해야 함.
  redirectUri: "com.squire.todo:/oauth2redirect",
  // 드라이브 전체 스코프 — PC가 만든 Squire-Sync/todos.json 을 찾으려면 필요(drive.file로는 안 보임)
  scope: "https://www.googleapis.com/auth/drive"
};
