---

# SystemMakers API 명세

서버는 여러 채널을 묶으며, 유효한 초대로 서버에 참여한 회원은 `get_channels.php`에서 해당 서버의 전체 채널을 조회한다. 각 채널의 기존 대화는 `get_messages.php?channel_id=...`로 조회하며, 서버에 소속되지 않은 사용자의 접근은 거절한다. 서버 참여 성공 후 화면은 참여한 서버와 채널 목록을 다시 불러온다.

현재 PHP API 경로는 35개다. 같은 파일이 여러 HTTP 메서드를 지원해도 경로 하나로 센다. 두 실행 환경 모두 같은 허용 목록을 사용한다. [라우터](../router.php)

Windows 개발과 NAS Docker는 같은 API와 세션·CSRF·접근 권한 검사를 사용한다. NAS에서는 같은 HTTPS 출처로 API를 호출하고 WSS는 새 메시지 알림에 사용한다. [실시간 연결](REALTIME.md)

경로별 설명은 3절의 기본 API 목록, 9절의 관리 API, 개인 대화·첨부·프로필·친구 API 표에 나누어 실었다. [확장 API 표](#개인-대화첨부프로필-api)

---

## 1. 공통 규칙

| 항목 | 계약 |
|---|---|
| 기본 경로 | 프로젝트 진입 화면 기준 `./backend/api/`; 개발 주소에서는 `/Team006/backend/api/` |
| 소스 위치 | Windows 개발 서버와 NAS Apache가 같은 라우터의 허용 목록에서 `backend/api/` 파일을 실행 |
| 요청 | GET은 쿼리 매개변수, 일반 쓰기는 JSON 사용. 첨부와 프로필 사진 업로드는 `multipart/form-data` 사용 |
| 응답 | 기본은 JSON과 `Cache-Control: no-store`. 첨부 다운로드와 프로필 사진 조회는 권한 확인 후 파일 바이트 반환 |
| 인증 | 같은 출처의 PHP 세션 쿠키; 토큰을 localStorage에 저장하지 않음 |
| 상태 변경 보호 | 회원가입·로그인을 포함한 POST와 PATCH·DELETE 요청에 `X-CSRF-Token` 헤더 적용 |
| 화면 계정 보호 | 로그인한 웹 화면은 `X-Expected-User-Id` 헤더에 확인한 사용자 ID 전달; 보호된 API는 현재 세션과 불일치 시 403 SESSION_CHANGED |
| 문자 | UTF-8; 잘못된 UTF-8 입력 거절 |
| ID | 모든 자원 ID는 JSON에서도 양의 10진수 문자열; `"1"` 형식 |
| ID 범위 | `1`~`18446744073709551615`; 부호·소수·공백·앞자리 0 불허 |
| 날짜 | UTC ISO 8601, 초 단위; 예: `2026-10-21T11:30:00Z` |
| 표시 시간 | 브라우저에서 이용자 현지 시간으로 변환 |
| 요청 크기 | JSON 본문 최대 32 KiB; 초과 시 413 |
| 알 수 없는 입력 필드 | POST는 422, GET은 400으로 거절 |

아래 예시는 줄별 설명을 위한 JSONC다. 실제 HTTP 요청·응답은 주석을 제거한 표준 JSON을 사용한다. GET에는 본문과 Content-Type 헤더가 필요하지 않다.

성공 응답 예시:

```jsonc
{
  "success": true, // 성공 표시
  "data": // 결과 영역
  {
    "user": // 사용자 정보
    {
      "id": "1", // 사용자 식별자
      "username": "user01", // 고유 사용자명
      "email": "user01@example.com", // 본인 이메일
      "created_at": "2026-10-21T11:30:00Z" // 가입 시각
    }
  }
}
```

실패 응답 예시:

```jsonc
{
  "success": false, // 실패 표시
  "error": // 오류 영역
  {
    "code": "VALIDATION_ERROR", // 화면 분기용 오류 코드
    "message": "입력값을 확인하세요.", // 안내 문구
    "fields": // 필드별 오류
    {
      "email": "이메일 형식이 올바르지 않습니다." // 이메일 안내
    }
  }
}
```

`error.fields`는 입력 오류에서만 선택적으로 반환한다. 브라우저는 `error.code`로 분기하고 문구의 정확한 일치에 의존하지 않는다. 비밀번호 해시, 세션 ID, SQL, 내부 경로는 응답에 포함하지 않는다. 이메일은 회원가입·로그인·현재 사용자 응답과 본인 프로필 응답에만 포함하며 메시지 응답에서는 제외한다.

---

## 2. 인증과 CSRF 흐름

1. 화면 진입 시 `GET ./backend/api/csrf.php`로 세션 쿠키와 CSRF 토큰을 받는다.
2. 회원가입·로그인 POST에 `X-CSRF-Token`을 보낸다.
3. 회원가입 성공 후 별도의 로그인 요청을 보낸다. 가입만으로 서버 멤버십이나 로그인 상태가 생기지 않는다.
4. 로그인 성공 시 세션 ID와 CSRF 토큰을 갱신한다. 브라우저는 응답의 새 토큰으로 기존 토큰을 교체한다.
5. 새로고침 시 CSRF 토큰을 다시 조회하고 `get_current_user.php`로 로그인 상태를 확인한다.
6. 보호된 API가 401 또는 SESSION_CHANGED를 반환하면 폴링·이전 계정 기록을 정리하고 로그인 재확인 화면을 표시한다. 같은 계정의 만료 초안만 메모리에 보관하며 다른 계정에 복원하지 않는다.
7. `CSRF_INVALID` 발생 시 토큰을 조회한 뒤 현재 계정을 기대 사용자 헤더로 다시 확인한다. 같은 계정일 때만 토큰을 적용하고 초안을 유지한다. 전송 중이던 POST는 자동 재전송하지 않는다.
8. 로그아웃 성공 시 폴링·화면의 사용자 정보·메시지 상태·보관한 CSRF 토큰을 비운다.

동일 출처 fetch의 `credentials` 값은 `same-origin`으로 통일한다. 개발 서버가 따로 있으면 프록시를 통해 동일 출처로 연결하는 방식을 우선한다. 교차 출처 배포는 현재 계약에 포함하지 않으며, 도입 시 허용 출처·쿠키·CORS를 함께 변경해야 한다.

X-Expected-User-Id는 화면이 의도한 계정과 서버 세션의 일치 조건을 추가한다. require_user가 실제 인증을 확인한 뒤 같은 PHP 세션 잠금 안에서 검사한다. 보호된 조회·메시지 전송·로그아웃 모두 적용하며, 명시한 값이 빈 값·잘못된 ID·다른 계정이면 본문 처리와 자료 조회·저장 전에 거절한다. 실제 사용자의 ID·이메일은 오류에 노출하지 않는다. 헤더를 생략한 기존 API 클라이언트는 기존 계약을 유지하지만 웹 화면처럼 계정을 기억하는 클라이언트는 이 헤더를 함께 보내야 한다. 조회한 사용자와 토큰 사이에 계정이 다시 바뀌더라도 다음 보호 요청의 서버 검사에서 차단한다.

세션 쿠키 이름은 `systemmakers_session`, Path는 `/`, Domain은 지정하지 않는다. HttpOnly와 SameSite=Lax를 적용하고 운영 HTTPS에서는 Secure를 적용한다. URL을 통한 세션 전달은 금지하며 strict mode를 활성화한다. 유휴 만료는 30분, 로그인 후 최대 수명은 12시간이다. 인증 요청 시 서버에서 시각을 검사하며 만료 시 401을 반환한다. 주기적인 인증된 폴링도 활동으로 취급한다. CSRF 발급만으로 로그인 유휴 시간을 연장하지 않는다.

---

## 3. 엔드포인트 목록

아래 표는 기본 인증·채널 대화·서버 경로를 다룬다. 채널 관리와 본인 프로필은 9절, 개인 대화·첨부·프로필 확장·친구 경로는 [확장 API 표](#개인-대화첨부프로필-api)에서 확인한다.

| 메서드 | 경로 | 로그인 | CSRF | 정상 상태 |
|---|---|---|---|---|
| GET | `./backend/api/csrf.php` | 불필요 | 불필요 | 200 |
| POST | `./backend/api/register.php` | 불필요 | 필요 | 201 |
| POST | `./backend/api/login.php` | 불필요 | 필요 | 200 |
| POST | `./backend/api/logout.php` | 필요 | 필요 | 200 |
| GET | `./backend/api/get_current_user.php` | 필요 | 불필요 | 200 |
| GET | `./backend/api/get_channels.php` | 필요 | 불필요 | 200 |
| GET | `./backend/api/health.php` | 불필요 | 불필요 | 200 |
| POST | `./backend/api/send_message.php` | 필요 | 필요 | 201 |
| GET | `./backend/api/get_messages.php` | 필요 | 불필요 | 200 |
| GET | `./backend/api/list_servers.php` | 필요 | 불필요 | 200 |
| POST | `./backend/api/create_server.php` | 필요 | 필요 | 201 |
| GET | `./backend/api/get_server_invite.php` | 소유자 | 불필요 | 200 |
| POST | `./backend/api/create_server_invite.php` | 소유자 | 필요 | 201 |
| POST | `./backend/api/revoke_server_invite.php` | 소유자 | 필요 | 200 |
| POST | `./backend/api/join_server.php` | 필요 | 필요 | 201 / 200 |
| POST | `./backend/api/leave_server.php` | 소유자 제외 소속 | 필요 | 200 |
| GET | `./backend/api/get_deletion_preview.php` | 대상 관리 권한 | 불필요 | 200 |
| POST | `./backend/api/delete_server.php` | 소유자 | 필요 | 200 |

---

## 4. 회원 API

---

### 4.1 CSRF 토큰 발급

`GET ./backend/api/csrf.php` · 입력 없음 · 정상 200

응답의 `data.csrf_token`은 32바이트 이상의 난수를 소문자 16진수로 표현한 문자열이다. 구현 기준은 32바이트, 64자리 문자열로 고정한다. 기존 세션에 유효한 토큰이 있으면 그대로 반환하고 없으면 발급한다. 로그인 전에도 사용할 수 있으며 사용자 인증 성공을 의미하지 않는다. 토큰은 세션에 보관하고 일정 시간마다가 아니라 로그인·세션 교체 시 갱신한다.

---

### 4.2 회원가입

`POST ./backend/api/register.php` · 정상 201

| 필드 | 형식·검증 |
|---|---|
| username | 문자열; 앞뒤 공백 제거 후 한글·영문·숫자·밑줄 2~32자; 소문자로 저장 |
| email | 문자열; 앞뒤 공백 제거 후 소문자로 저장; 최대 254자; PHP 이메일 검증 통과; MVP는 ASCII 이메일만 지원 |
| password | UTF-8 문자열; 8~64 유니코드 코드 포인트; NUL 불허; 문자 조합 제한 및 72바이트 제한 없음; 공백 제거·소문자 변환 금지 |

사용자명과 이메일은 각각 대소문자를 구분하지 않는 고유 값으로 취급한다. 회원가입 후 사용자명 편집은 9.4의 profile.php에서 제공한다. 새 비밀번호는 Argon2id로 저장해 다국어 원문을 보존한다. 기존 bcrypt 해시도 로그인할 수 있지만 잘린 입력이 인증되지 않도록 72바이트를 초과하는 입력은 거절한다. [PHP 비밀번호 해시 문서](https://www.php.net/manual/en/function.password-hash.php)

```jsonc
{
  "username": "user01", // 고유 사용자명
  "email": "user01@example.com", // 가입 이메일
  "password": "ExamplePass123!" // 설명용 비밀번호
}
```

성공 시 공통 성공 예시와 같은 `data.user`를 반환한다. 이메일·사용자명 중복은 각각 409 `EMAIL_TAKEN`·`USERNAME_TAKEN`이며 두 값이 모두 중복이면 이메일 오류를 우선한다. 사전 검사뿐 아니라 DB UNIQUE 충돌도 같은 오류로 변환한다.

---

### 4.3 로그인

`POST ./backend/api/login.php` · 정상 200

입력은 문자열 `email`, `password` 두 개다. 이메일 정규화는 가입과 같고, 비밀번호는 가입과 같은 형식·길이 조건을 검사한 뒤 원문 그대로 검증한다.

```jsonc
{
  "email": "user01@example.com", // 로그인 이메일
  "password": "ExamplePass123!" // 입력 비밀번호
}
```

성공 응답의 `data`는 `user`와 `csrf_token`을 포함한다. `user`의 필드는 공통 성공 예시와 같다. 최종 세션 잠금에서 기존 인증·CSRF를 빈 상태로 바꾸고 session_regenerate_id(false)로 새 식별자를 발급한다. 빈 기존 세션을 먼저 저장하여 잠금을 기다리던 동시 로그인이 이전 CSRF로 성공하지 못하도록 한다. 새 인증·CSRF는 교체된 세션에만 기록하며 기존 빈 게스트 파일은 PHP 세션 정리 대상이다. 교체 실패 시 인증된 세션을 남기지 않는다.

없는 계정과 잘못된 비밀번호는 모두 401 `INVALID_CREDENTIALS`, 동일한 안내 문구로 반환한다. 이미 로그인한 세션의 재로그인 요청은 409 `ALREADY_AUTHENTICATED`로 거절한다.

유효한 CSRF와 입력 형식 검사를 통과한 로그인 시도는 이메일 기준 15분당 5회, 접속 IP 기준 15분당 30회로 제한한다. 6번째 이메일 시도 또는 31번째 IP 시도부터 429 `RATE_LIMITED`를 반환하며 `Retry-After` 헤더에 남은 초를 정수로 제공한다. 최초 허용 시도부터 시작하는 고정 창을 사용하고 성공·실패 모두 횟수에 포함한다. 성공으로 창을 초기화하지 않는다. 제한된 요청은 추가 횟수로 누적하지 않는다. 공유 MySQL 테이블을 사용하며 세션 삭제로 제한을 우회할 수 없게 한다.

로그인 시도 제한 키는 32바이트 이상의 비밀 값인 `AUTH_RATE_LIMIT_KEY`다. 이메일과 IP는 HMAC으로 식별한다. PHP는 `REMOTE_ADDR`를 사용하고 Docker의 Apache는 지정한 Caddy 프록시가 전달한 접속 주소만 반영한다. [로그인 제한](../backend/includes/login_rate_limit.php) · [Apache 설정](../docker/apache.conf)

---

### 4.4 로그아웃

`POST ./backend/api/logout.php` · 입력은 빈 JSON 객체 · 정상 200

성공 시 `data.message`에 로그아웃 안내를 반환한다. 세션 데이터 삭제, 세션 종료, 같은 쿠키 속성으로 세션 쿠키 만료를 수행한다. 비로그인 상태는 401이다. 다음 로그인 전에는 CSRF 발급부터 다시 시작한다.

---

### 4.5 현재 로그인 사용자

`GET ./backend/api/get_current_user.php` · 입력 없음 · 정상 200

공통 성공 예시와 같은 `data.user`를 반환한다. 유효한 로그인 세션이나 사용자 계정이 없으면 401 `UNAUTHORIZED`다. 서버 생성과 소속 관리에 쓰는 `user.id`는 PHP 인증 함수가 세션에서 확인한 값이다.

일반 게스트의 401은 로그인 전 CSRF와 세션을 보존한다. 만료·손상·삭제 계정의 인증 상태는 폐기하고 세션 ID를 갱신한다. 따라서 화면은 csrf.php 조회 후 get_current_user.php를 호출해도 정상 게스트의 토큰을 계속 사용할 수 있다.

---

### 4.6 서비스 DB 준비 상태

`GET ./backend/api/health.php` · 입력 없음 · 정상 200

현재 앱 계정에서 마이그레이션 001~007에 필요한 테이블 15개와 첨부 저장 열을 확인하면 `200`과 `data.status=ok`를 반환한다. 스키마 누락은 `503 SERVICE_UNAVAILABLE`, DB 연결 오류는 `500 INTERNAL_ERROR`로 응답한다. 응답에는 DB 이름이나 테이블 목록을 포함하지 않는다.

---

## 5. 메시지 API

---

### 5.0 소속 채널 목록

`GET ./backend/api/get_channels.php` · 쿼리 입력 없음 · 정상 200

로그인 사용자의 server_members를 기준으로 소속 서버의 채널만 조회한다. 응답의 data.channels는 배열이며 참여 서버·채널이 없으면 빈 배열이다. 목록 조회가 멤버십이나 채널을 생성하지 않는다. 외부 user_id·server_id 등 쿼리는 400 INVALID_QUERY로 거절하고 비로그인은 먼저 401을 반환한다.

| 채널 필드 | 형식·의미 |
|---|---|
| id | 실제 채널 ID 문자열 |
| server_id | 소속 서버 ID 문자열 |
| server_name | 소속 서버 이름 |
| name | 채널 이름 |

서버 ID·채널 ID 오름차순으로 반환한다. 같은 이름의 채널이 여러 서버에 있을 수 있으므로 화면에서 서버 이름도 표시한다. 목록은 화면 선택용이며 실제 전송은 현재 멤버십을 다시 검사한다. 서버·채널 생성·참여 관리 기능은 포함하지 않는다.

---

### 5.1 메시지 전송

`POST ./backend/api/send_message.php` · 정상 201

| 필드 | 형식·검증 |
|---|---|
| channel_id | 공통 ID 규칙의 문자열 |
| content | UTF-8 문자열; 1~2,000 유니코드 코드 포인트; 유니코드 공백만 있는 값과 NUL 거절 |

내용의 앞뒤 공백·개행은 저장 시 유지한다. 길이는 저장할 원문 기준이다. HTML로 해석하거나 HTML 엔티티로 바꿔 저장하지 않는다.

```jsonc
{
  "channel_id": "1", // 선택한 채널
  "content": "안녕하세요!" // 저장할 일반 텍스트
}
```

채널 존재와 해당 서버의 현재 멤버십을 검사한다. 역할이 owner·admin·member 중 무엇이든 MVP에서는 채널 조회·전송이 가능하다. 작성자는 로그인 세션에서 결정한다. 요청에 `user_id`가 있으면 알 수 없는 필드로 422 처리한다.

성공 응답은 `data.message`에 다음 메시지 객체를 반환한다.

```jsonc
{
  "id": "101", // 메시지 식별자
  "channel_id": "1", // 소속 채널
  "user_id": "2", // 작성자 식별자
  "username": "user02", // 조회 시점의 사용자명
  "content": "안녕하세요!", // 원문 내용
  "created_at": "2026-10-21T11:30:00Z" // 저장 시각
}
```

저장 트랜잭션을 커밋한 뒤 201을 반환한다. 자동 재전송에 대한 중복 방지 키는 MVP에 포함하지 않는다. 네트워크 단절 시 이미 저장됐을 수 있으므로 브라우저는 전송을 자동 반복하지 않고 조회로 확인한다.

화면은 확인된 저장 응답과 조회 응답을 ID 기준으로 병합한다. 응답 유실 시 저장 여부를 단정하지 않고 자동 갱신된 대화를 확인하도록 안내한다. CSRF 오류에서 토큰을 갱신하더라도 원래 POST는 자동 반복하지 않는다. 전송 중에는 중복 제출과 로그아웃을 막고, 채널을 이동해도 성공 응답은 원래 채널에만 반영한다. 권한 상실이 확인된 뒤 도착한 전송 응답은 표시하지 않는다.

---

### 5.2 메시지 조회와 커서

`GET ./backend/api/get_messages.php` · 정상 200

| 매개변수 | 필수 | 규칙 |
|---|---|---|
| channel_id | 예 | 공통 ID 규칙 |
| limit | 아니요 | 1~100 사이 정수 문자열; 기본 50; 부호·소수·공백·앞자리 0 불허 |
| before_id | 아니요 | 이 ID 미만의 이전 메시지; 공통 ID 규칙 |
| after_id | 아니요 | 이 ID 초과의 신규 메시지; 공통 ID 규칙 또는 초기 커서 `"0"` |
| include_attachments | 아니요 | `1`이면 메시지마다 `attachment`를 반환한다. 생략하면 기존 메시지 필드를 유지한다. 다른 값은 400이다. |

before_id와 after_id의 동시 사용은 400 `INVALID_QUERY`다. 커서는 범위 기준이며 실제 메시지 존재 여부를 요구하지 않는다. 모든 조회에는 channel_id 필터와 서버 멤버십 검사가 적용된다.
확장 응답의 `attachment`는 첨부가 없으면 `null`이다. 파일이 있으면 `id`, `message_id`, `original_name`, `file_size`만 담는다. 채널·개인 대화의 초기·이전·신규 페이지에 같은 규칙을 적용한다. 원본 바이트는 `download_attachment.php`에서 현재 참여 권한을 다시 확인한 뒤 전송한다.

| 조회 종류 | 예시 | 선택 순서 | 반환 순서 |
|---|---|---|---|
| 최초 | `./backend/api/get_messages.php?channel_id=1&limit=50` | 최신 N개 | ID 오름차순 |
| 이전 | `./backend/api/get_messages.php?channel_id=1&before_id=51&limit=50` | 51 미만에서 가까운 N개 | ID 오름차순 |
| 신규 | `./backend/api/get_messages.php?channel_id=1&after_id=100&limit=50` | 100 초과에서 작은 ID부터 N개 | ID 오름차순 |

응답의 구조와 커서 예시:

```jsonc
{
  "success": true, // 성공 표시
  "data": // 조회 결과
  {
    "messages": // 메시지 목록
    [ // 목록 시작
      {
        "id": "101", // 메시지 식별자
        "channel_id": "1", // 소속 채널
        "user_id": "2", // 작성자 식별자
        "username": "user02", // 작성자명
        "content": "안녕하세요!", // 메시지 원문
        "created_at": "2026-10-21T11:30:00Z" // 저장 시각
      }
    ], // 목록 종료
    "pagination": // 다음 조회 기준
    {
      "mode": "after", // initial 또는 before 또는 after
      "has_more": false, // 같은 방향의 남은 결과 여부
      "next_before_id": "101", // 반환된 최소 메시지 ID
      "next_after_id": "101" // 반환된 최대 메시지 ID
    }
  }
}
```

- `mode`는 커서 없음이면 initial, before_id면 before, after_id면 after다.
- 결과가 있으면 next_before_id는 실제 반환 목록의 최솟값, next_after_id는 최댓값이다. 다른 채널의 메시지나 DB 전체 최댓값을 사용하지 않는다.
- 빈 결과는 messages를 빈 배열, next_before_id를 null, has_more를 false로 반환한다. next_after_id는 after 조회라면 요청 after_id, 그 외에는 `"0"`이다.
- has_more는 initial·before에서 더 오래된 결과가 있는지, after에서 더 최신 결과가 있는지 나타낸다. limit+1개를 조회하여 판정한다.
- 브라우저는 초기 조회로 최신 커서를 설정한 뒤 after 응답으로만 해당 채널의 폴링 커서를 전진시킨다. 이전 조회 응답으로 폴링 커서를 덮어쓰지 않는다.
- 메시지 ID는 연속일 필요가 없다. 비교가 필요하면 BigInt 또는 10진수 문자열 비교를 사용하고 Number로 변환하지 않는다.

---

### 5.3 실시간 알림과 주기 조회

WebSocket 서버가 변경을 알리면 기존 조회를 즉시 요청하고 조회 중에 받은 알림은 완료 직후 다시 확인한다. 구독이 승인된 동안에는 이전 요청 완료 후 15초 뒤 안전망 조회를 예약하며 연결 종료 시 2초 간격으로 복구한다. after 조회에서 has_more가 true면 해당 응답의 next_after_id로 남은 페이지를 먼저 가져온 뒤 일반 폴링으로 복귀한다. 오류가 반복되면 대기 간격을 최대 30초까지 늘린다. 401은 로그인 요구, 403·404는 해당 채널 폴링 중지로 처리한다.

채널 이동 시 진행 중 요청을 취소하거나 이전 채널의 응답을 무시한다. 동일 메시지를 두 번 표시하지 않도록 ID로 중복을 제거한다. 전송 성공 응답을 화면에 먼저 추가했더라도 폴링 커서는 전송 응답으로 앞당기지 않는다. 전송 전에 도착한 다른 메시지가 누락될 수 있기 때문이다.

채널 화면은 회원가입·로그인·로그아웃, 현재 사용자 표시, 실제 소속 채널 선택, 메시지 목록·전송·이전 조회·연결 오류 재시도를 제공한다. 소속은 get_channels.php에서 확인하며 임의의 채널 ID를 화면에 만들지 않는다. 브라우저에서 내용을 textContent로 표시하여 HTML을 실행하지 않는다. 최초 50개를 불러오고 이전 기록 버튼으로 50개씩 추가한다. 이전 기록을 추가할 때 기존 메시지의 화면 위치를 보존하고, 신규 메시지는 하단을 읽는 경우에만 자동으로 이동한다. 과거 기록을 읽는 중에는 새 메시지 수와 이동 버튼을 표시한다. 뒤로 가기 캐시에서 화면이 복구되면 기존 커서에서 조회를 재개한다.

---

## 6. 오류 처리 기준

| HTTP | error.code | 발생 조건 |
|---|---|---|
| 400 | INVALID_JSON | JSON 문법 오류 또는 객체가 아닌 최상위 JSON |
| 400 | INVALID_QUERY | 잘못된 조회 값, 알 수 없는·중복된 쿼리 키, 커서 충돌 |
| 401 | UNAUTHORIZED | 보호된 API의 비로그인·세션 만료·존재하지 않는 세션 사용자 |
| 401 | INVALID_CREDENTIALS | 없는 계정 또는 비밀번호 불일치 |
| 403 | CSRF_INVALID | CSRF 토큰 누락·불일치 |
| 403 | SESSION_CHANGED | 명시한 기대 계정 헤더의 형식 오류 또는 현재 로그인 계정과 불일치 |
| 403 | FORBIDDEN | 존재하는 채널의 서버에 소속되지 않음 |
| 404 | CHANNEL_NOT_FOUND | 해당 채널 없음 |
| 404 | NOT_FOUND | 라우터에 없는 API 경로 |
| 405 | METHOD_NOT_ALLOWED | 지원하지 않는 메서드; Allow 헤더 제공 |
| 409 | EMAIL_TAKEN / USERNAME_TAKEN | 가입 고유 값 중복 |
| 409 | ALREADY_AUTHENTICATED | 로그인 중 재로그인 또는 회원가입 시도 |
| 413 | PAYLOAD_TOO_LARGE | POST 본문 32 KiB 초과 |
| 415 | UNSUPPORTED_MEDIA_TYPE | JSON이 아닌 POST Content-Type |
| 422 | VALIDATION_ERROR | POST 필수 필드·자료형·길이·허용 필드 검증 실패 |
| 429 | RATE_LIMITED | 로그인 횟수 제한; Retry-After 헤더 제공 |
| 500 | INTERNAL_ERROR | DB·세션 저장 등 내부 실패; 내부 원인 숨김 |

검사 우선순위는 메서드 → 보호된 API의 인증·기대 계정 일치 → POST 크기·Content-Type·JSON 검사 → CSRF → 입력 검증 → 채널 존재 → 멤버십 → DB 동작이다. 로그인·회원가입은 메서드 검사 후 이미 로그인 중이면 409로 처리한다. 429 판정은 CSRF·로그인 입력 검증 뒤, 비밀번호 검사 전에 수행한다. 조회 또는 전송에서 FORBIDDEN·CHANNEL_NOT_FOUND를 확인한 화면은 해당 채널의 저장된 기록과 조회 예약을 함께 지운다.

---

## 7. PHP 공통 함수

보호된 API는 아래 함수를 조합해 사용자 확인, 요청 검증, DB 접근과 응답 처리를 수행한다.

| 공통 함수 | 위치 | 계약 |
|---|---|---|
| db(): PDO | backend/config/database.php | utf8mb4·UTC·예외 모드·실제 prepared statement를 사용하는 연결 |
| require_user(PDO): array | backend/includes/auth.php | 유효한 사용자 반환; 키는 id, username, email, created_at; 비로그인 401, 명시된 기대 계정 불일치 403 SESSION_CHANGED |
| require_csrf(): void | backend/includes/csrf.php | 세션 토큰과 X-CSRF-Token 비교; 실패 시 공통 403 |
| store_message(PDO, string, string, string): array | backend/includes/messages.php | 검증된 채널 ID·세션 사용자 ID·원문을 채널·멤버십 잠금과 함께 저장하고 커밋된 공개 메시지 반환 |
| read_messages(PDO, string, string, int, ?string, ?string, bool = false): array | backend/includes/message_history.php | 검증된 채널·세션 사용자·개수·이전/신규 커서로 현재 소속과 실제 페이지 조회, 응답 전 전체 잠금 해제 |
| respond_success(array, int): never | backend/includes/response.php | data와 HTTP 상태를 가진 공통 JSON 출력 |
| respond_error(string, string, int, array): never | backend/includes/response.php | 오류 코드·문구·HTTP 상태·선택적 fields 출력 |

채널 기록 조회와 저장에 전달하는 `$userId`는 `require_user`가 세션에서 확인한 값이다. 존재하지 않는 채널에는 404, 소속이 없는 채널에는 403을 반환한다.

PHP의 사용자 정의 변수·매개변수는 lowerCamelCase를 사용한다. HTTP JSON·쿼리의 `channel_id`·`user_id`와 DB 열 이름은 기존 계약을 유지한다. PHP 함수를 외부 코드에서 이름 지정 인수로 직접 호출했다면 변경된 매개변수 이름으로 수정해야 한다. 위치 순서로 전달하는 기존 호출과 HTTP API 계약은 유지한다. 자세한 기준은 [변수명 안내](VARIABLE-NAMING.md)를 따른다.

메시지 저장은 store_message의 채널 FOR UPDATE·멤버십 FOR SHARE·INSERT·COMMIT 순서를 따른다. 외부 입력 검증은 호출 전에 수행하며, 권한 오류는 롤백 후 공통 JSON으로 변환한다.

세션을 시작·갱신하고 필요한 인증·CSRF 정보를 읽은 뒤 session_write_close로 잠금을 해제한다. 해제 이후 같은 요청에서 세션을 추가 수정하지 않도록 공통 처리 순서를 구성한다. [PHP 세션 잠금 문서](https://www.php.net/manual/en/function.session-write-close.php)

서버 생성 API는 새 서버·소유자 소속·기본 채널 등록을 하나의 트랜잭션으로 처리한다. 채널별 별도 ACL과 읽기 전용 역할은 MVP에 없으며, 서버 소속만으로 모든 소속 채널 조회·전송을 허용한다. 외래 키·삭제·동시 전송 규칙은 [DATABASE.md](DATABASE.md)를 따른다.

---

## 8. 회귀 검사

가입·중복·잘못된 비밀번호·세션 교체·로그아웃·세션 만료, 비로그인 401, CSRF 403, 다른 서버 접근 403, 없는 채널 404, 작성자 ID 위조 거절, 메시지 저장·채널 분리·이전 및 신규 커서·빈 결과·100개 초과 적체·동시 전송 순서·로그인 429를 검증한다.

가입부터 대화까지 이어지는 동작과 각 실패 조건은 실제 API를 호출하는 테스트에서 확인한다. [통합 흐름](../tests/integration-flow.test.mjs) · [인증](../tests/auth.test.mjs) · [메시지 저장](../tests/messages.test.mjs) · [기록 조회](../tests/message-history.test.mjs)

---

## 9. 서버·채널·프로필 관리 API

서버 소속과 역할은 요청마다 검사한다. 서버 생성자는 소유자가 되고 초대로 참여한 새 회원은 일반 회원이 된다. 채널 목록은 `get_channels.php`에서 조회한다.

---

### 9.1 공통 요청·응답과 공개 객체

이 절의 관리 API는 로그인과 기대 계정을 확인한다. POST·PATCH는 최대 32 KiB의 JSON 객체와 CSRF 토큰을 받는다. GET은 쿼리 매개변수만 받는다. 미허용 필드는 변경 요청에서 422, GET에서 400으로 거절한다. 사용자·역할·소유자는 세션과 DB에서 확인한다. 아래 표는 성공 응답의 `data` 형식을 보여 준다. 집계 값은 십진 문자열, 참·거짓 값은 JSON 불리언이다.

| 공개 객체 | 필드 |
|---|---|
| server | id, name, owner_id, role, created_at; role은 현재 사용자의 owner/admin/member |
| channel | id, server_id, server_name, name; 기존 get_channels의 항목과 동일 |
| user | id, username, email, created_at; 본인 프로필에서만 사용 |
| invite | server_id, active, expires_at, revoked_at; 미발급의 날짜는 null, 원문·해시 제외 |

ID는 기존 양의 uint64 문자열, 시각은 UTC ISO 8601이다. invite.active는 revoked_at이 null이고 현재 DB 시각이 expires_at 미만인 경우만 true다. 서버·채널 이름은 제어 문자(C0/C1)를 먼저 거절하고 앞뒤 유니코드 구분 공백 제거 후 1~100 코드 포인트다. 내부 공백과 대소문자는 보존한다. 같은 서버 채널명의 중복은 기존 DB 비교 규칙으로 409 CHANNEL_NAME_TAKEN이다. 사용자명 정규화는 기존 가입과 같다.

검사 순서는 메서드 → 인증·기대 계정 → 크기·유형·JSON → CSRF → 필드/형식 → 자원 존재·소속·역할 → DB 동작이다. 초대 참여만 필드/형식 다음 요청 제한 → 초대 유효성 → 소속을 검사하고, 서버 정보를 코드 검증 전에 노출하지 않는다. 발급 제한은 소유자 확인 뒤 적용한다. 역할 없는 기존 자원은 403 FORBIDDEN, 자원 자체가 없으면 해당 404다. owner 정보 불일치는 500으로 변경을 중단한다.

---

### 9.2 서버·초대·참여

| 메서드·경로 | 허용 입력 | 권한 | 정상 data·상태 |
|---|---|---|---|
| GET ./backend/api/list_servers.php | 없음 | 로그인 본인 | servers: server[]; ID 오름차순, 소속 없으면 빈 배열; 200 |
| POST ./backend/api/create_server.php | name | 로그인 본인 | server, channel; 소유자·일반 채널까지 원자적 생성; 201 |
| GET ./backend/api/get_server_invite.php | server_id | 소유자 | invite; 미발급도 active=false·날짜 null; 200 |
| POST ./backend/api/create_server_invite.php | server_id | 소유자 | server_id, code, expires_at; 매번 새 코드로 교체; 201 |
| POST ./backend/api/revoke_server_invite.php | server_id | 소유자 | server_id, revoked: true; 미발급·기폐기도 동일; 200 |
| POST ./backend/api/join_server.php | code | 로그인 본인 | server, already_member; 신규 201·기참여 200 |
| POST ./backend/api/leave_server.php | server_id | 본인 소속·소유자 제외 | server_id, left: true; 200 |
| GET ./backend/api/get_deletion_preview.php | resource_type, resource_id | server는 소유자, channel은 소유자·관리자 | 아래 삭제 미리보기; 200 |
| POST ./backend/api/delete_server.php | server_id, confirm_name | 소유자 | server_id, deleted: true; 200 |

`list_servers.php`는 참여 중인 서버 전체를 반환하며 채널이 없는 서버도 포함한다. 서로 다른 서버가 같은 이름을 쓸 수 있다. 서버를 만들면 서버 한 개, 소유자 소속 한 건, ‘일반’ 채널 한 개를 같은 트랜잭션에 저장한다. 화면은 응답이 유실되면 생성을 자동 재전송하지 않는다.

code는 32바이트 난수의 소문자 16진수 64자리이며 앞뒤 ASCII 공백만 제거한 뒤 검증한다. 형식 오류는 422, 정상 형식의 미존재·만료·폐기는 모두 400 INVALID_INVITE다. 만료는 발급 DB 시각 + 86,400초, 경계 시각은 만료다. 한 서버에 현재 코드 1개만 두며 재발급은 이전 코드를 즉시 무효화한다. 코드는 발급 응답에만 표시하고 GET·서버 목록·로그·URL·localStorage에 넣지 않는다.

유효 코드로 재참여 요청 시 이미 회원이면 already_member=true, 기존 role·joined_at 유지, 200이다. 신규는 already_member=false·member 역할·201이다. 코드 폐기/재발급은 이미 가입한 멤버십을 제거하지 않는다. 폐기는 멱등적 200, 탈퇴·삭제는 이후 미참여 403·없는 자원 404로 바뀌므로 성공 응답 유실 후 목록부터 확인한다.

초대 발급: 계정 10회/600초. 초대 참여: 계정 10회/600초·IP 100회/600초. 유효 형식의 허용 시도를 성공 여부와 무관하게 집계한다. 창은 첫 시도에 시작하고 성공 시 초기화하지 않는다. 제한된 요청은 카운터를 추가하지 않는다. 어느 한 버킷이 제한되면 429 RATE_LIMITED, Retry-After는 제한된 창들 중 가장 큰 남은 초다. IP 기준은 4.3절의 로그인 시도 제한과 같다.

---

### 9.3 삭제 확인 계약

get_deletion_preview의 resource_type은 server 또는 channel, resource_id는 문자열 ID다. data에는 resource_type, resource_id, name, message_count를 반환한다. server에는 channel_count, member_count도 포함한다. 집계는 조회 시점 문자열이며 이후 메시지/소속 변경을 잠그거나 삭제 범위를 예약하지 않는다. 소유자·관리자 여부는 삭제 API에서 다시 검사한다.

confirm_name은 삭제 미리보기에서 확인한 현재 이름이다. 화면에서 대상과 영향을 확인하고 네를 선택하면 해당 이름을 요청에 넣는다. API는 생성 이름과 같은 유효성·앞뒤 공백 처리를 적용한 뒤 DB 현재 이름과 코드 포인트 단위로 정확하게 비교한다. DB의 대소문자 무시 비교로 대체하지 않는다. 다르면 409 NAME_MISMATCH이며 새 미리보기를 표시하고 다시 선택해야 한다. ID가 실제 삭제 대상을 결정한다. 서버 삭제는 멤버십·현재 초대·채널·대화를, 채널 삭제는 해당 메시지를 CASCADE로 정리한다. 계정과 다른 서버 자료는 보존한다. 응답에는 삭제된 원문 대화를 포함하지 않는다.

---

### 9.4 채널·프로필

| 메서드·경로 | 허용 입력 | 권한 | 정상 data·상태 |
|---|---|---|---|
| GET ./backend/api/get_channels.php | 없음 | 기존 본인 소속 | 기존 응답 유지; 200 |
| POST ./backend/api/create_channel.php | server_id, name | 소유자·관리자 | channel; 201 |
| POST ./backend/api/update_channel.php | channel_id, name | 소유자·관리자 | channel; 200 |
| POST ./backend/api/delete_channel.php | channel_id, confirm_name | 소유자·관리자 | channel_id, deleted: true; 200 |
| GET ./backend/api/profile.php | 없음 | 로그인 본인 | user; 200 |
| PATCH ./backend/api/profile.php | username | 로그인 본인 | user; 200 |

일반 회원은 직접 호출해도 403이며 소유자·관리자만 관리한다. 이름 변경은 ID·작성 대화·서버 소속을 유지하고 같은 이름 재저장도 200이다. 서버 ID 변경 입력은 거절한다. 같은 서버의 대소문자 무시 중복은 409이며 다른 서버의 같은 이름은 허용한다. 대상이나 부모가 동시 삭제되면 변경·삭제는 404 CHANNEL_NOT_FOUND다.

마지막 채널 삭제는 허용하고 서버는 남긴다. 삭제 성공 응답을 받으면 해당 기록·초안·조회 예약·저장 선택을 목록 재조회 전에 정리하므로 후속 통신 실패에도 복원하지 않는다. 관리자는 빈 서버에서 새 채널을 만들 수 있다. NAME_MISMATCH는 같은 ID의 최신 미리보기를 다시 확인하며 자동 재전송하지 않는다. 다른 탭은 다음 조회·전송에서 삭제를 확인하고 기록과 입력을 차단한다. 실시간 구독 중 안전망 조회는 15초, 연결이 없을 때 정상 조회는 2초 간격이며 최대 반영 시간 보장은 아니다.

`profile.php`는 현재 세션의 계정만 조회·수정한다. GET은 조회 조건 없이 user를 반환하고 미허용 조회 조건은 400이다. PATCH는 username만 허용하며 user_id·email·password·role 등은 422로 거절한다. GET에는 본문·CSRF가 없고 PATCH는 기존 32 KiB JSON·CSRF·기대 계정 검사를 적용한다. 다른 메서드는 405, Allow: GET, PATCH다.

사용자명은 가입과 같은 trim·한글/영문/숫자/밑줄 2~32자·소문자 규칙이다. 같은 정규화 이름 재저장도 200, 다른 계정과 중복이면 409 USERNAME_TAKEN과 username 필드 안내를 반환한다. 본인 users 행 잠금→UPDATE→공개 정보 조회→COMMIT 뒤 user를 반환한다. 경쟁 중복은 DB UNIQUE로 거절하고 DB 실패는 전체 롤백 뒤 공통 500이다.

이메일·비밀번호·가입일·사용자 ID·기존 작성자 관계는 유지한다. 이메일은 본인에게만 제공하고 변경하지 않는다. 과거 메시지 API 재조회는 최신 username을 사용한다. 현재 탭의 사용자명·이니셜·메모리 본인 메시지 이름도 갱신하며 대화·초안·조회 커서는 유지한다. 다른 탭은 페이지 새로고침 또는 본인 프로필을 포함한 전체 재조회 때 반영한다. 즉시 동기화는 보장하지 않는다.

조회 실패 시 저장을 막고 다시 조회를 제공한다. 중복·형식·같은 계정 CSRF 오류는 입력을 유지하며 자동 PATCH 재제출하지 않는다. 저장 응답이 유실되면 GET으로 실제 본인 상태를 확인하고 입력은 보존한다. 닫기·로그아웃 시 프로필 이메일·입력을 폐기하고 이전 계정의 늦은 응답과 중첩 CSRF 복구 실패를 새 계정에 적용하지 않는다. 프로필을 브라우저 영구 저장소에 추가하지 않는다.

---

### 9.5 관리 오류

| HTTP | error.code | 조건 |
|---|---|---|
| 400 | INVALID_INVITE | 정상 형식 코드의 미존재·만료·폐기; 동일 안내 |
| 403 | FORBIDDEN | 서버 미소속 또는 동작에 필요한 역할 없음 |
| 404 | SERVER_NOT_FOUND | 서버가 존재하지 않음 |
| 404 | CHANNEL_NOT_FOUND | 채널이 존재하지 않음; 기존 코드 재사용 |
| 409 | OWNER_CANNOT_LEAVE | 현재 소유자의 탈퇴 요청 |
| 409 | NAME_MISMATCH | 삭제 확인 이름과 현재 이름 불일치 |
| 409 | CHANNEL_NAME_TAKEN | 같은 서버의 정규화 채널명 중복 |
| 409 | USERNAME_TAKEN | 다른 계정의 사용자명과 중복 |
| 429 | RATE_LIMITED | 초대 발급·참여 제한, Retry-After 포함 |

역할별 접근과 소속 종료 후의 처리는 관련 통합 검사에서 확인한다. [서버 관리](../tests/server-management.test.mjs) · [채널 관리](../tests/channel-management.test.mjs) · [프로필](../tests/profile.test.mjs)

---

### 9.6 접근 종료와 늦은 응답 처리

- 메시지 조회·전송의 403 FORBIDDEN은 해당 서버의 소속 종료로 처리한다. 채널별 별도 권한은 현재 없으므로 비활성 채널까지 같은 서버의 기록·초안·읽지 않은 상태·조회 예약·선택을 폐기하고 관리 창을 닫는다. 다른 API의 관리 역할 거절을 서버 소속 종료로 확대하지 않는다.
- 404 CHANNEL_NOT_FOUND는 해당 채널의 기록·초안·입력을 폐기하고 전송을 막는다. 목록에서 사라지기 전에도 기존 초안을 복원하지 않는다.
- 서버 탈퇴·삭제 성공 응답은 후속 목록 조회보다 먼저 해당 서버 자료와 저장한 선택을 폐기한다. 후속 통신 실패가 이미 확정한 접근 종료를 되돌리지 않는다.
- list_servers.php 성공 응답에서 기존 소속 서버가 사라진 경우에도 get_channels.php 재조회 전에 해당 자료를 폐기한다. 일반 네트워크 실패만으로 소속 종료를 추정하지 않는다.
- 전송의 CSRF 복구 성공·실패를 적용하기 전에 시작 당시 인증 세대·사용자 ID·채널 객체를 확인한다. 이전 계정의 늦은 복구 실패로 새 계정을 로그아웃시키거나 새 토큰을 덮어쓰지 않는다. 자동 전송 재제출은 하지 않는다.
- 이 처리는 응답을 받은 뒤의 화면 보호다. 실시간 구독 중 15초 안전망과 연결 종료 후 2초 조회는 즉시 동기화나 최대 반영 시간을 보장하지 않는다. 서버 목록 재조회로 다시 참여가 확인돼도 폐기한 초안을 되살리지 않는다.

---

## 개인 대화·첨부·프로필 API

모든 경로는 `/Team006/`의 `./backend/api/`를 기준으로 하며 인증된 세션을 사용한다. 쓰기 요청에는 기존 CSRF 토큰을 포함한다. ID는 정밀도 보존을 위해 십진 문자열이다.

| 메서드와 파일 | 입력 | 결과 |
| --- | --- | --- |
| GET `search_users.php` | `q`: 사용자명 검색어 | 공개 `users` 목록, 이메일 제외 |
| POST `create_dm.php` | JSON `user_id` | `conversation`: 본인과 대상의 고유 대화, 기존 대화 재사용 |
| GET `list_dms.php` | 없음 | 본인의 `conversations` 목록, `unread`와 가장 최근 미확인 메시지 ID `unread_message_id` 포함 |
| POST `mark_dm_read.php` | JSON `conversation_id`, `message_id` | 해당 참여자의 읽은 위치를 전진시키고 `last_read_message_id` 반환 |
| POST `send_dm.php` | JSON `conversation_id`, `content` | 저장된 `message` |
| GET `get_dm_messages.php` | `conversation_id`, 선택 `limit`, `before_id` 또는 `after_id`, `include_attachments=1` | `messages`와 `pagination` |
| POST `upload_attachment.php` | multipart `kind` (`channel` 또는 `direct`), `target_id`, `file` | 원자적으로 저장한 `message`, `attachment` |
| GET `list_attachments.php` | `kind`, `target_id`, `message_ids` (쉼표로 구분한 최대 50개) | 허용된 대화의 첨부 ID·메시지 ID·파일명·크기·선택적 `preview_mime` |
| GET `download_attachment.php` | `id`, 선택 `preview=1` | 현재 참여 권한을 확인한 원본 다운로드 또는 검증된 이미지 표시 |
| GET `profile_details.php` | `user_id` | 공개 사용자명·상태 메시지·사진 유무 |
| PATCH `profile_details.php` | JSON `status_message` | 본인 상태 메시지 저장; 최대 200자 |
| GET `profile_picture.php` | `user_id` | 검증 후 재인코딩한 PNG 또는 JPEG |
| POST `profile_picture.php` | multipart `picture` | 본인 사진 저장; 최대 1,048,576바이트(화면 표시: 약 1.05 MB) |
| DELETE `profile_picture.php` | 없음 | 본인 사진 제거 |
| GET `user_blocks.php` | 없음 | 본인이 차단한 사용자 목록 |
| POST/DELETE `user_blocks.php` | JSON `user_id` | 본인 차단 추가·해제 |
| GET `friends.php` | 없음 | 수락된 `friends`, 받은 `incoming`, 보낸 `outgoing` 목록 |
| POST `friends.php` | JSON `user_id`, `action` | `request`, `accept`, `decline`, `cancel`, `remove` 동작 |

테스트용 첨부 한도는 1~200,000,000바이트다. 새 파일은 비공개 첨부 저장소에 보관하고, 기존 MySQL 원본도 같은 주소로 내려받을 수 있다. 다운로드는 `application/octet-stream`, `Content-Disposition: attachment`, `nosniff`를 사용한다. 실제 디코딩을 통과한 PNG·JPEG·WebP에 `preview_mime`이 포함된다. 미리보기 한도는 원본 20 MB, 가로와 세로 각각 8,192픽셀, 전체 1,600만 픽셀이다. 미리보기 범위를 넘은 원본은 다운로드로 제공한다. 두 요청 모두 같은 권한 검사를 적용한다.

개인 대화는 두 사용자만 조회할 수 있다. 한쪽이 차단하면 양쪽의 새 텍스트·파일 전송을 거부하며 기존 대화 및 파일 조회는 유지한다. WebSocket은 내용 없는 새 메시지 알림을 보내며 실제 내용은 권한을 다시 확인하는 HTTP 조회로 받는다.

친구 요청은 받은 사람이 수락한다. 브라우저의 ‘모두 수락’은 화면에 표시된 받은 요청마다 같은 수락 API를 한 번씩 호출하고, 보낸 요청의 ‘상태 확인’은 최신 목록을 조회한다. 수락 후 양쪽 친구 목록에 표시된다. 차단 중인 두 계정은 새 요청과 수락을 할 수 없다. 요청과 차단 변경은 같은 사용자 잠금 순서로 처리한다.

---

## 검색 참고

- [PHP 비밀번호 해시와 bcrypt 입력 제한](https://www.php.net/manual/en/function.password-hash.php)
- [PHP 세션 보안 설정](https://www.php.net/manual/en/session.security.ini.php)
- [PHP 세션 저장과 잠금 해제](https://www.php.net/manual/en/function.session-write-close.php)
- [PHP PDO Prepared Statement](https://www.php.net/manual/en/pdo.prepared-statements.php)
