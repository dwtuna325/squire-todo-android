# Squire 할 일 (안드로이드)

스콰이어의 **투두(할 일)** 모듈을 안드로이드 앱으로 뽑은 것. 집·회사 PC와 **같은 구글 드라이브
`Squire-Sync/todos.json`** 을 공유해 어디서 고쳐도 동기화되고, **마감일이 되면 폰에 알림**이 뜬다.

- 외부 LLM 미사용(토큰 0), 인터넷 서버 없음 — 데이터는 소유자 구글 드라이브에만.
- 병합 규칙(항목별 최종수정승리 + 삭제 tombstone)은 PC(`src/todos.py`)와 100% 동일.
- 알림: 마감일이 **평일 → 09:30**, **주말 → 12:00** (설정에서 시각·on/off·미리알림 조정).

---

## 폴더 구조

```
www/                     앱 본체(웹)
  index.html             화면 셸(할 일 / 설정 탭)
  css/app.css            스타일(PC todo.html 이식)
  js/store.js            할 일 저장·병합·반복 로직 (todos.py 포팅)
  js/notifications.js    마감일 알림 엔진 (평일09:30/주말12:00)
  js/settings.js         설정 화면(알림 on/off·시각·동기화)
  js/drive.js            구글 드라이브 동기화 (todo_sync.py 포팅, OAuth PKCE)
  js/gconfig.js          ← 본인 OAuth 클라이언트 ID를 넣는 곳
  js/app.js              화면 렌더·이벤트
scripts/patch-android.mjs  네이티브 매니페스트 보정(OAuth 스킴)
.github/workflows/build-apk.yml  APK 자동 빌드(GitHub Actions)
test/                    순수 로직 테스트(노드)
```

## 빠른 확인(설치 없이 브라우저로)

`www/index.html` 를 브라우저로 열면 할 일 추가/수정/삭제/완료·반복·설정 UI가 그대로 동작한다.
(단 **알림·드라이브 동기화는 설치된 앱에서만** 작동 — 브라우저에선 안내만 표시.)

로직 회귀 테스트:
```bash
npm test
```

---

## APK 만들기 (GitHub Actions — 권장)

로컬에 아무 툴도 안 깔고, 코드를 올리면 GitHub이 APK를 만들어 준다.

### 1) 서명키(keystore) 1회 생성 — PC에서
> 서명키는 **앱 업데이트 때 데이터를 지키는 열쇠**다. 한 번 만들고 **절대 잃어버리지 말 것**(잃으면 기존 앱 위에 업데이트 불가 → 삭제·재설치).

```bash
keytool -genkeypair -v -keystore squire.keystore -alias squire \
  -keyalg RSA -keysize 2048 -validity 10000
# 비밀번호·이름 등을 물어보면 입력(비번은 기억할 것)
```

키의 **SHA-1 지문**을 확인(뒤에서 구글에 등록):
```bash
keytool -list -v -keystore squire.keystore -alias squire | grep SHA1
```

keystore 파일을 base64 문자열로 변환(깃 시크릿에 넣기 위함):
```bash
# Windows PowerShell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("squire.keystore")) | Set-Clipboard
```

### 2) GitHub 저장소에 시크릿 4개 등록
저장소 → Settings → Secrets and variables → Actions → New repository secret:

| 이름 | 값 |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | 위에서 만든 base64 문자열 |
| `ANDROID_KEYSTORE_PASSWORD` | keystore 비밀번호 |
| `ANDROID_KEY_ALIAS` | `squire` |
| `ANDROID_KEY_PASSWORD` | 키 비밀번호(보통 keystore와 동일) |

> 시크릿이 하나도 없으면 워크플로가 **debug APK**를 대신 만든다(앱·알림은 되지만 드라이브 OAuth는 안 됨 — OAuth는 안정적 서명키가 필수라서).

### 3) 빌드 실행 → APK 내려받기
Actions 탭 → **Build Android APK** → Run workflow. 끝나면 하단 **Artifacts**의 `squire-todo-apk`
를 내려받아 폰으로 옮겨 설치(“출처를 알 수 없는 앱” 허용 필요).

---

## 구글 드라이브 연결(OAuth) 준비

드라이브 동기화를 쓰려면 폰 앱용 OAuth 클라이언트가 필요하다(1회).

1. **Google Cloud Console** → 프로젝트 선택(가능하면 PC 동기화와 같은 계정 `vegatuna2`).
2. API 및 서비스 → **Google Drive API** 사용 설정.
3. OAuth 동의 화면 → 게시(테스트 사용자에 본인 계정 추가면 충분).
4. 사용자 인증 정보 → 만들기 → **OAuth 클라이언트 ID** → 유형 **Android**
   - 패키지 이름: `com.squire.todo`
   - SHA-1 인증서 지문: 위 1)에서 확인한 값
5. 발급된 **클라이언트 ID** 를 `www/js/gconfig.js` 의 `clientId` 에 붙여넣고 커밋
   (클라이언트 ID는 비밀이 아님 — 커밋해도 안전).
6. 다시 빌드 → 설치 → 설정 탭 → **구글 계정 연결**.

> **왜 `drive` 전체 스코프인가?** PC는 `drive.file` 스코프로 `todos.json`을 만들었는데, 그 스코프는
> *다른 앱이 만든 파일*을 못 본다. 폰이 같은 파일을 찾으려면 `drive` 스코프가 필요하다. 1인 개인용이라 안전상 문제 없음.

---

## 알림이 잘 뜨게 하려면

- 최초 실행 시 **알림 권한**을 허용(안드로이드 13+).
- 삼성 등 일부 폰은 절전이 예약 알림을 죽일 수 있음 → 설정 → 배터리 → 이 앱을 **제한 없음/최적화 제외**로.
- 알림은 **마감일 당일**(설정에 따라 며칠 전)에 뜬다. 이미 지난 시각은 울리지 않는다.

## PC와의 관계

- 진실(SSOT)은 드라이브 `Squire-Sync/todos.json` 하나. 폰·집PC·회사PC는 모두 그것과 동기화하는 클라이언트.
- 폰에서 편집 → 지금 동기화(또는 앱 전환 시 자동) → 다음에 PC가 동기화할 때 반영, 그 반대도 동일.
- **계좌번호로 보이는 항목**이 있으면 업로드가 중단된다(평문 반출 차단) — PC와 같은 방어.

## 유지보수 메모

- 빌드 재현성: 의존성 버전은 `package.json`에 고정, 빌드 절차는 워크플로 YAML에 고정 → 몇 달 뒤에도 동일 빌드.
- 서명키만 잃지 않으면(=시크릿 유지) 업데이트가 기존 앱 위에 덮여 설치되어 로컬 데이터가 유지된다.
- 로직 변경 시 `npm test`로 병합/반복/알림시각/계좌가드 회귀를 먼저 확인.
