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
  // Google Cloud Console → 클라이언트(Android). 시크릿 없음·공개값이라 커밋 OK.
  clientId: "1017849585642-k4i5c2o64oc4l9d9orj60gcvdb4dk4cc.apps.googleusercontent.com",
  // Android 클라이언트는 **역순 클라이언트 ID 스킴**을 리다이렉트로 쓴다(구글이 이 형태만 허용).
  // = "com.googleusercontent.apps." + (클라이언트ID에서 .apps.googleusercontent.com 앞부분)
  // 이 스킴은 scripts/patch-android.mjs 가 AndroidManifest intent-filter로 자동 등록한다.
  redirectUri: "com.googleusercontent.apps.1017849585642-k4i5c2o64oc4l9d9orj60gcvdb4dk4cc:/oauth2redirect",
  // 드라이브 전체 스코프 — PC가 만든 Squire-Sync/todos.json 을 찾으려면 필요(drive.file로는 안 보임)
  scope: "https://www.googleapis.com/auth/drive"
};
