---
# SystemMakers API 명세 초안

작성일: 2026-10-21 · 계약 버전: 0.2 · 구현 담당: B · 연동 대상: A·C

회원 인증과 채널별 메시지 저장·조회를 위한 API 계약이다. GET csrf.php·get_current_user.php·get_channels.php·health.php와 POST register.php·login.php·logout.php·send_message.php를 구현하고 웹 화면에 연결했다. 메시지 조회·폴링 API는 5단계이며 아래 조회 예시는 해당 구현의 기준이다. 서버·채널·프로필 관리 API 구현은 C의 담당이다. 0.2에서는 소속 채널 조회 계약을 추가했다.

---
## 1. 공통 규칙

| 항목 | 계약 |
|---|---|
| 기본 경로 | `/api/`; 실제 배포 호스트는 아직 미정 |
| 소스 위치 | `backend/api/`; 웹 서버에서 외부 `/api/`로 연결 |
| 요청 | POST는 `Content-Type: application/json`; GET은 쿼리 매개변수 사용 |
| 응답 | `Content-Type: application/json; charset=utf-8`, `Cache-Control: no-store` |
| 인증 | 같은 출처의 PHP 세션 쿠키; 토큰을 localStorage에 저장하지 않음 |
| 상태 변경 보호 | 모든 POST에 `X-CSRF-Token` 헤더 적용; 회원가입·로그인 포함 |
| 문자 | UTF-8; 잘못된 UTF-8 입력 거절 |
| ID | 모든 자원 ID는 JSON에서도 양의 10진수 문자열; `"1"` 형식 |
| ID 범위 | `1`~`18446744073709551615`; 부호·소수·공백·앞자리 0 불허 |
| 날짜 | UTC ISO 8601, 초 단위; 예: `2026-10-21T11:30:00Z` |
| 표시 시간 | A가 브라우저에서 이용자 현지 시간으로 변환 |
| 요청 크기 | JSON 본문 최대 32 KiB; 초과 시 413 |
| 알 수 없는 입력 필드 | POST는 422, GET은 400으로 거절 |

아래 예시는 줄별 설명을 위한 JSONC다. 실제 HTTP 요청·응답은 주석을 제거한 표준 JSON을 사용한다. GET에는 본문과 Content-Type 헤더가 필요하지 않다.

성공 응답 예시:

```jsonc
{ // 응답 객체 시작
  "success": true, // 성공 표시
  "data": // 결과 영역
  { // 결과 객체 시작
    "user": // 사용자 정보
    { // 사용자 객체 시작
      "id": "1", // 사용자 식별자
      "username": "user01", // 고유 사용자명
      "email": "user01@example.com", // 본인 이메일
      "created_at": "2026-10-21T11:30:00Z" // 가입 시각
    } // 사용자 객체 종료
  } // 결과 객체 종료
} // 응답 객체 종료
```

실패 응답 예시:

```jsonc
{ // 응답 객체 시작
  "success": false, // 실패 표시
  "error": // 오류 영역
  { // 오류 객체 시작
    "code": "VALIDATION_ERROR", // 화면 분기용 오류 코드
    "message": "입력값을 확인하세요.", // 안내 문구
    "fields": // 필드별 오류
    { // 필드 오류 객체 시작
      "email": "이메일 형식이 올바르지 않습니다." // 이메일 안내
    } // 필드 오류 객체 종료
  } // 오류 객체 종료
} // 응답 객체 종료
```

`error.fields`는 입력 오류에서만 선택적으로 반환한다. A는 `error.code`로 분기하고 문구의 정확한 일치에 의존하지 않는다. 비밀번호 해시, 세션 ID, SQL, 내부 경로는 응답에 포함하지 않는다. 이메일은 회원가입·로그인·현재 사용자 응답의 본인 정보에만 포함하며 메시지 응답에서는 제외한다.

---
## 2. 인증과 CSRF 흐름

1. 화면 진입 시 `GET /api/csrf.php`로 세션 쿠키와 CSRF 토큰을 받는다.
2. 회원가입·로그인 POST에 `X-CSRF-Token`을 보낸다.
3. 회원가입 성공 후 별도의 로그인 요청을 보낸다. 가입만으로 서버 멤버십이나 로그인 상태가 생기지 않는다.
4. 로그인 성공 시 세션 ID와 CSRF 토큰을 갱신한다. A는 응답의 새 토큰으로 기존 토큰을 교체한다.
5. 새로고침 시 CSRF 토큰을 다시 조회하고 `get_current_user.php`로 로그인 상태를 확인한다.
6. 보호된 API가 401을 반환하면 폴링을 중지하고 로그인 화면을 표시한다.
7. `CSRF_INVALID` 발생 시 토큰을 다시 조회한다. 전송 중이던 POST는 자동 재전송하지 않고 사용자의 다음 제출을 기다린다.
8. 로그아웃 성공 시 폴링·화면의 사용자 정보·메시지 상태·보관한 CSRF 토큰을 비운다.

동일 출처 fetch의 `credentials` 값은 `same-origin`으로 통일한다. 개발 서버가 따로 있으면 프록시를 통해 동일 출처로 연결하는 방식을 우선한다. 교차 출처 배포는 현재 계약에 포함하지 않으며, 도입 시 허용 출처·쿠키·CORS를 함께 변경해야 한다.

세션 쿠키 이름은 `systemmakers_session`, Path는 `/`, Domain은 지정하지 않는다. HttpOnly와 SameSite=Lax를 적용하고 운영 HTTPS에서는 Secure를 적용한다. URL을 통한 세션 전달은 금지하며 strict mode를 활성화한다. 유휴 만료는 30분, 로그인 후 최대 수명은 12시간이다. 인증 요청 시 서버에서 시각을 검사하며 만료 시 401을 반환한다. 주기적인 인증된 폴링도 활동으로 취급한다. CSRF 발급만으로 로그인 유휴 시간을 연장하지 않는다.

---
## 3. 엔드포인트 목록

| 메서드 | 경로 | 로그인 | CSRF | 정상 상태 |
|---|---|---|---|---|
| GET | `/api/csrf.php` | 불필요 | 불필요 | 200 |
| POST | `/api/register.php` | 불필요 | 필요 | 201 |
| POST | `/api/login.php` | 불필요 | 필요 | 200 |
| POST | `/api/logout.php` | 필요 | 필요 | 200 |
| GET | `/api/get_current_user.php` | 필요 | 불필요 | 200 |
| GET | `/api/get_channels.php` | 필요 | 불필요 | 200 |
| GET | `/api/health.php` | 불필요 | 불필요 | 200 |
| POST | `/api/send_message.php` | 필요 | 필요 | 201 |
| GET | `/api/get_messages.php` | 필요 | 불필요 | 200 |

---
## 4. 회원 API

---
### 4.1 CSRF 토큰 발급

`GET /api/csrf.php` · 입력 없음 · 정상 200

응답의 `data.csrf_token`은 32바이트 이상의 난수를 소문자 16진수로 표현한 문자열이다. 구현 기준은 32바이트, 64자리 문자열로 고정한다. 기존 세션에 유효한 토큰이 있으면 그대로 반환하고 없으면 발급한다. 로그인 전에도 사용할 수 있으며 사용자 인증 성공을 의미하지 않는다. 토큰은 세션에 보관하고 일정 시간마다가 아니라 로그인·세션 교체 시 갱신한다.

---
### 4.2 회원가입

`POST /api/register.php` · 정상 201

| 필드 | 형식·검증 |
|---|---|
| username | 문자열; 앞뒤 공백 제거 후 영문·숫자·밑줄 3~32자; 소문자로 저장 |
| email | 문자열; 앞뒤 공백 제거 후 소문자로 저장; 최대 254자; PHP 이메일 검증 통과; MVP는 ASCII 이메일만 지원 |
| password | 문자열; 12~64 유니코드 코드 포인트이면서 UTF-8 최대 72바이트; NUL 불허; 공백 제거·소문자 변환 금지 |

사용자명과 이메일은 각각 대소문자를 구분하지 않는 고유 값으로 취급한다. 실명·표시 닉네임·프로필 편집은 이번 API에 포함하지 않는다. 비밀번호의 바이트 제한은 bcrypt의 입력 절단을 방지하기 위한 계약이다. [PHP 비밀번호 해시 문서](https://www.php.net/manual/en/function.password-hash.php)

```jsonc
{ // 가입 입력 시작
  "username": "user01", // 고유 사용자명
  "email": "user01@example.com", // 가입 이메일
  "password": "ExamplePass123!" // 설명용 비밀번호
} // 가입 입력 종료
```

성공 시 공통 성공 예시와 같은 `data.user`를 반환한다. 이메일·사용자명 중복은 각각 409 `EMAIL_TAKEN`·`USERNAME_TAKEN`이며 두 값이 모두 중복이면 이메일 오류를 우선한다. 사전 검사뿐 아니라 DB UNIQUE 충돌도 같은 오류로 변환한다.

---
### 4.3 로그인

`POST /api/login.php` · 정상 200

입력은 문자열 `email`, `password` 두 개다. 이메일 정규화는 가입과 같고, 비밀번호는 가입과 같은 형식·길이 조건을 검사한 뒤 원문 그대로 검증한다.

```jsonc
{ // 로그인 입력 시작
  "email": "user01@example.com", // 로그인 이메일
  "password": "ExamplePass123!" // 입력 비밀번호
} // 로그인 입력 종료
```

성공 응답의 `data`는 `user`와 `csrf_token`을 포함한다. `user`의 필드는 공통 성공 예시와 같다. `session_regenerate_id(true)` 이후 응답하며 실패 시 인증된 세션을 남기지 않는다.

없는 계정과 잘못된 비밀번호는 모두 401 `INVALID_CREDENTIALS`, 동일한 안내 문구로 반환한다. 이미 로그인한 세션의 재로그인 요청은 409 `ALREADY_AUTHENTICATED`로 거절한다.

유효한 CSRF와 입력 형식 검사를 통과한 로그인 시도는 이메일 기준 15분당 5회, 접속 IP 기준 15분당 30회로 제한한다. 6번째 이메일 시도 또는 31번째 IP 시도부터 429 `RATE_LIMITED`를 반환하며 `Retry-After` 헤더에 남은 초를 정수로 제공한다. 최초 허용 시도부터 시작하는 고정 창을 사용하고 성공·실패 모두 횟수에 포함한다. 성공으로 창을 초기화하지 않는다. 제한된 요청은 추가 횟수로 누적하지 않는다. 공유 MySQL 테이블을 사용하며 세션 삭제로 제한을 우회할 수 없게 한다.

서버의 AUTH_RATE_LIMIT_KEY에는 32바이트 이상의 비밀 값을 지정한다. 이메일·IP 원문을 제한 테이블에 저장하지 않고 HMAC 키로 구분한다. 누락·길이 오류는 공통 500이며 설정 값은 응답하지 않는다. 신뢰 프록시 설정이 없는 현재 구현은 REMOTE_ADDR를 사용하고 X-Forwarded-For는 신뢰하지 않는다.

---
### 4.4 로그아웃

`POST /api/logout.php` · 입력은 빈 JSON 객체 · 정상 200

성공 시 `data.message`에 로그아웃 안내를 반환한다. 세션 데이터 삭제, 세션 종료, 같은 쿠키 속성으로 세션 쿠키 만료를 수행한다. 비로그인 상태는 401이다. 다음 로그인 전에는 CSRF 발급부터 다시 시작한다.

---
### 4.5 현재 로그인 사용자

`GET /api/get_current_user.php` · 입력 없음 · 정상 200

공통 성공 예시와 같은 `data.user`를 반환한다. 유효한 로그인 세션이나 사용자 계정이 없으면 401 `UNAUTHORIZED`다. `user.id`가 C의 서버 생성자·멤버십 사용자 식별 기준이며, C의 PHP 코드는 클라이언트가 보낸 ID 대신 공통 인증 함수의 반환값을 사용한다.

일반 게스트의 401은 로그인 전 CSRF와 세션을 보존한다. 만료·손상·삭제 계정의 인증 상태는 폐기하고 세션 ID를 갱신한다. 따라서 화면은 csrf.php 조회 후 get_current_user.php를 호출해도 정상 게스트의 토큰을 계속 사용할 수 있다.

---
### 4.6 DB 연결 상태

`GET /api/health.php` · 입력 없음 · 정상 200

실제 PDO 연결로 SELECT 1을 실행한 뒤 success=true, data.status=ok를 반환한다. 실패는 공통 500 INTERNAL_ERROR이며 DB 호스트·계정·스키마·서버 버전은 반환하지 않는다. 회원·메시지 기능 전체의 준비 완료를 의미하지 않는다.

---
## 5. 메시지 API

---
### 5.0 소속 채널 목록

`GET /api/get_channels.php` · 쿼리 입력 없음 · 정상 200

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

`POST /api/send_message.php` · 정상 201

| 필드 | 형식·검증 |
|---|---|
| channel_id | 공통 ID 규칙의 문자열 |
| content | UTF-8 문자열; 1~2,000 유니코드 코드 포인트; 유니코드 공백만 있는 값과 NUL 거절 |

내용의 앞뒤 공백·개행은 저장 시 유지한다. 길이는 저장할 원문 기준이다. HTML로 해석하거나 HTML 엔티티로 바꿔 저장하지 않는다.

```jsonc
{ // 메시지 입력 시작
  "channel_id": "1", // 선택한 채널
  "content": "안녕하세요!" // 저장할 일반 텍스트
} // 메시지 입력 종료
```

채널 존재와 해당 서버의 현재 멤버십을 검사한다. 역할이 owner·admin·member 중 무엇이든 MVP에서는 채널 조회·전송이 가능하다. 작성자는 로그인 세션에서 결정한다. 요청에 `user_id`가 있으면 알 수 없는 필드로 422 처리한다.

성공 응답은 `data.message`에 다음 메시지 객체를 반환한다.

```jsonc
{ // 메시지 객체 시작
  "id": "101", // 메시지 식별자
  "channel_id": "1", // 소속 채널
  "user_id": "2", // 작성자 식별자
  "username": "user02", // 조회 시점의 사용자명
  "content": "안녕하세요!", // 원문 내용
  "created_at": "2026-10-21T11:30:00Z" // 저장 시각
} // 메시지 객체 종료
```

저장 트랜잭션을 커밋한 뒤 201을 반환한다. 자동 재전송에 대한 중복 방지 키는 MVP에 포함하지 않는다. 네트워크 단절 시 이미 저장됐을 수 있으므로 A는 전송을 자동 반복하지 않고 조회로 확인한다.

현재 4단계 화면은 확인된 저장 응답만 표시한다. 조회 API를 연결하기 전에는 응답 유실 시 저장 여부를 단정하지 않고 중복 가능성을 안내한다. CSRF 오류에서 토큰을 갱신하더라도 원래 POST는 자동 반복하지 않는다. 전송 중에는 중복 제출과 로그아웃을 막고, 채널을 이동해도 성공 응답은 원래 채널에만 반영한다.

---
### 5.2 메시지 조회와 커서

`GET /api/get_messages.php` · 정상 200

| 매개변수 | 필수 | 규칙 |
|---|---|---|
| channel_id | 예 | 공통 ID 규칙 |
| limit | 아니요 | 1~100 사이 정수 문자열; 기본 50; 부호·소수·공백·앞자리 0 불허 |
| before_id | 아니요 | 이 ID 미만의 이전 메시지; 공통 ID 규칙 |
| after_id | 아니요 | 이 ID 초과의 신규 메시지; 공통 ID 규칙 또는 초기 커서 `"0"` |

before_id와 after_id의 동시 사용은 400 `INVALID_QUERY`다. 커서는 범위 기준이며 실제 메시지 존재 여부를 요구하지 않는다. 모든 조회에는 channel_id 필터와 서버 멤버십 검사가 적용된다.

| 조회 종류 | 예시 | 선택 순서 | 반환 순서 |
|---|---|---|---|
| 최초 | `/api/get_messages.php?channel_id=1&limit=50` | 최신 N개 | ID 오름차순 |
| 이전 | `/api/get_messages.php?channel_id=1&before_id=51&limit=50` | 51 미만에서 가까운 N개 | ID 오름차순 |
| 신규 | `/api/get_messages.php?channel_id=1&after_id=100&limit=50` | 100 초과에서 작은 ID부터 N개 | ID 오름차순 |

응답의 구조와 커서 예시:

```jsonc
{ // 응답 객체 시작
  "success": true, // 성공 표시
  "data": // 조회 결과
  { // 결과 객체 시작
    "messages": // 메시지 목록
    [ // 목록 시작
      { // 메시지 객체 시작
        "id": "101", // 메시지 식별자
        "channel_id": "1", // 소속 채널
        "user_id": "2", // 작성자 식별자
        "username": "user02", // 작성자명
        "content": "안녕하세요!", // 메시지 원문
        "created_at": "2026-10-21T11:30:00Z" // 저장 시각
      } // 메시지 객체 종료
    ], // 목록 종료
    "pagination": // 다음 조회 기준
    { // 페이지 객체 시작
      "mode": "after", // initial 또는 before 또는 after
      "has_more": false, // 같은 방향의 남은 결과 여부
      "next_before_id": "101", // 반환된 최소 메시지 ID
      "next_after_id": "101" // 반환된 최대 메시지 ID
    } // 페이지 객체 종료
  } // 결과 객체 종료
} // 응답 객체 종료
```

- `mode`는 커서 없음이면 initial, before_id면 before, after_id면 after다.
- 결과가 있으면 next_before_id는 실제 반환 목록의 최솟값, next_after_id는 최댓값이다. 다른 채널의 메시지나 DB 전체 최댓값을 사용하지 않는다.
- 빈 결과는 messages를 빈 배열, next_before_id를 null, has_more를 false로 반환한다. next_after_id는 after 조회라면 요청 after_id, 그 외에는 `"0"`이다.
- has_more는 initial·before에서 더 오래된 결과가 있는지, after에서 더 최신 결과가 있는지 나타낸다. limit+1개를 조회하여 판정한다.
- A는 초기 조회로 최신 커서를 설정한 뒤 after 응답으로만 해당 채널의 폴링 커서를 전진시킨다. 이전 조회 응답으로 폴링 커서를 덮어쓰지 않는다.
- 메시지 ID는 연속일 필요가 없다. 비교가 필요하면 BigInt 또는 10진수 문자열 비교를 사용하고 Number로 변환하지 않는다.

---
### 5.3 폴링과 최소 화면

기본 폴링은 이전 요청 완료 후 2초 뒤에 다음 요청을 예약한다. after 조회에서 has_more가 true면 해당 응답의 next_after_id로 남은 페이지를 먼저 가져온 뒤 일반 폴링으로 복귀한다. 오류가 반복되면 대기 간격을 최대 30초까지 늘린다. 401은 로그인 요구, 403·404는 해당 채널 폴링 중지로 처리한다.

채널 이동 시 진행 중 요청을 취소하거나 이전 채널의 응답을 무시한다. 동일 메시지를 두 번 표시하지 않도록 ID로 중복을 제거한다. 전송 성공 응답을 화면에 먼저 추가했더라도 폴링 커서는 전송 응답으로 앞당기지 않는다. 전송 전에 도착한 다른 메시지가 누락될 수 있기 때문이다.

최소 프론트는 회원가입·로그인·로그아웃, 현재 사용자 표시, 채널 선택, 메시지 목록·전송·이전 조회를 제공한다. C의 채널 목록 API가 완성되기 전에는 개발용 샘플 채널 ID를 직접 입력하여 검증한다. 브라우저에서 내용을 textContent로 표시하여 HTML을 실행하지 않는다.

---
## 6. 오류 처리 기준

| HTTP | error.code | 발생 조건 |
|---|---|---|
| 400 | INVALID_JSON | JSON 문법 오류 또는 객체가 아닌 최상위 JSON |
| 400 | INVALID_QUERY | 잘못된 조회 값, 알 수 없는·중복된 쿼리 키, 커서 충돌 |
| 401 | UNAUTHORIZED | 보호된 API의 비로그인·세션 만료·존재하지 않는 세션 사용자 |
| 401 | INVALID_CREDENTIALS | 없는 계정 또는 비밀번호 불일치 |
| 403 | CSRF_INVALID | CSRF 토큰 누락·불일치 |
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

검사 우선순위는 메서드 → 보호된 API의 인증 → POST 크기·Content-Type·JSON 검사 → CSRF → 입력 검증 → 채널 존재 → 멤버십 → DB 동작이다. 로그인·회원가입은 메서드 검사 후 이미 로그인 중이면 409로 처리한다. 429 판정은 CSRF·로그인 입력 검증 뒤, 비밀번호 검사 전에 수행한다.

---
## 7. 팀원 C와 공유할 내부 계약

다음 함수는 2단계에서 구현한 공통 인터페이스다. 실제 검증 결과는 [PHASE-2-VERIFICATION.md](PHASE-2-VERIFICATION.md)에 기록했다.

| 예정 함수 | 위치 | 계약 |
|---|---|---|
| db(): PDO | backend/config/database.php | utf8mb4·UTC·예외 모드·실제 prepared statement를 사용하는 연결 |
| require_user(PDO): array | backend/includes/auth.php | 유효한 사용자 반환; 키는 id, username, email, created_at; 실패 시 공통 401 |
| require_csrf(): void | backend/includes/csrf.php | 세션 토큰과 X-CSRF-Token 비교; 실패 시 공통 403 |
| require_channel_member(PDO, string, string): array | backend/includes/permissions.php | 채널 ID·인증 사용자 ID로 권한 검사; id와 server_id를 문자열로 반환; 404·403 구분 |
| store_message(PDO, string, string, string): array | backend/includes/messages.php | 검증된 채널 ID·세션 사용자 ID·원문을 채널·멤버십 잠금과 함께 저장하고 커밋된 공개 메시지 반환 |
| respond_success(array, int): never | backend/includes/response.php | data와 HTTP 상태를 가진 공통 JSON 출력 |
| respond_error(string, string, int, array): never | backend/includes/response.php | 오류 코드·문구·HTTP 상태·선택적 fields 출력 |

require_channel_member의 전체 시그니처는 `require_channel_member(PDO $pdo, string $channel_id, string $user_id): array`다. user_id는 반드시 require_user가 반환한 값이며 요청 본문의 값을 전달하지 않는다.

단순 require_channel_member 조회는 트랜잭션 안의 저장 권한 검사를 대체하지 않는다. 메시지 저장은 store_message의 채널 FOR UPDATE·멤버십 FOR SHARE·INSERT·COMMIT 순서를 따른다. 외부 입력 검증은 호출 전에 수행하며, 권한 오류는 롤백 후 공통 JSON으로 변환한다.

세션을 시작·갱신하고 필요한 인증·CSRF 정보를 읽은 뒤 session_write_close로 잠금을 해제한다. 해제 이후 같은 요청에서 세션을 추가 수정하지 않도록 공통 처리 순서를 구성한다. [PHP 세션 잠금 문서](https://www.php.net/manual/en/function.session-write-close.php)

C는 서버 생성과 생성자 owner 멤버십 등록을 하나의 트랜잭션으로 처리한다. 채널별 별도 ACL과 읽기 전용 역할은 MVP에 없으며, 서버 소속만으로 모든 소속 채널 조회·전송을 허용한다. 외래 키·삭제·동시 전송 규칙은 [DATABASE.md](DATABASE.md)를 따른다.

---
## 8. 구현 후 검증 기준

가입·중복·잘못된 비밀번호·세션 교체·로그아웃·세션 만료, 비로그인 401, CSRF 403, 다른 서버 접근 403, 없는 채널 404, 작성자 ID 위조 거절, 메시지 저장·채널 분리·이전 및 신규 커서·빈 결과·100개 초과 적체·동시 전송 순서·로그인 429를 검증한다.

초기 DB·공통 계층·회원 인증에 이어 실제 메시지 저장·소속 채널 조회·동시 전송·멤버십 잠금과 웹 전송을 검증했다. 최신 결과는 [PHASE-4-VERIFICATION.md](PHASE-4-VERIFICATION.md), 인증 상세는 [PHASE-3-VERIFICATION.md](PHASE-3-VERIFICATION.md)에 기록했다. 메시지 조회·폴링 HTTP API는 후속 단계다.

---
## 검색 참고

- [PHP 비밀번호 해시와 bcrypt 입력 제한](https://www.php.net/manual/en/function.password-hash.php)
- [PHP 세션 보안 설정](https://www.php.net/manual/en/session.security.ini.php)
- [PHP 세션 저장과 잠금 해제](https://www.php.net/manual/en/function.session-write-close.php)
- [PHP PDO Prepared Statement](https://www.php.net/manual/en/pdo.prepared-statements.php)
