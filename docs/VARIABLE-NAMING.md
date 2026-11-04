---
# 변수명 작성과 호환성 안내

갱신일: 2026-11-04. PHP·JavaScript·테스트 코드의 사용자 정의 변수와 매개변수를 lowerCamelCase로 정리했다. 첫 단어는 소문자로 시작하고 다음 단어의 첫 글자는 대문자로 쓰며, 이름에 저장된 값의 역할을 드러낸다.

---
## 1. 변수명을 읽는 방법

| 정리 전 예시 | 정리 후 예시 | 의미 |
|---|---|---|
| `$pdo` | `$databaseConnection` | 실제 데이터베이스 연결 |
| `$user` | `$currentUser` | 현재 로그인 사용자 |
| `$body` | `$requestBody` | 화면에서 보낸 요청 본문 |
| `$channel_id` | `$channelId` | 검사한 채널 식별자 |

예시는 [메시지 전송 API](../backend/api/send_message.php)의 현재 흐름을 기준으로 한다. 같은 짧은 이름이라도 어떤 값을 담는지에 따라 다른 이름을 선택한다. `$email`, `$password`처럼 의미가 충분히 드러나는 이름은 불필요하게 늘리지 않는다.

```php
$databaseConnection = db(); // 데이터베이스 연결
$currentUser = require_user($databaseConnection); // 로그인 사용자 확인
$requestBody = read_json_body(); // 요청 내용 읽기
$channelId = validate_id($requestBody['channel_id'], 'channel_id'); // 채널 식별자 검사
```

---
## 2. 변수와 외부 계약 구분

`$channelId`는 PHP 파일 안에서 사용하는 변수다. `channel_id`는 HTTP 요청의 JSON 필드이자 DB 열 이름이므로 외부 연동을 위해 기존 표기를 사용한다. JavaScript에서 화면·API에 전달하는 객체의 공개 속성, HTML ID, 환경 변수 이름도 각 기존 계약에 맞춘다.

PHP의 `$_SESSION`, `$_SERVER`, `$_GET` 같은 슈퍼글로벌과 PowerShell의 자동 변수는 언어가 정한 이름이므로 변경 대상이 아니다. 기존 함수·클래스명과 URL도 이번 변수명 정리로 변경하지 않았다.

---
## 3. PHP 함수 호출 시 주의

PHP 8에서 함수의 매개변수 이름을 직접 적는 이름 지정 인수를 사용하는 외부 코드가 있다면 새 매개변수 이름과 일치시켜야 한다. 예를 들어 채널 소속 확인 함수의 매개변수는 `$databaseConnection`, `$channelId`, `$userId`다. 기존 이름으로 작성된 외부 호출은 확인이 필요하다.

매개변수를 순서대로 넘기는 저장소 내부 호출과 HTTP 요청·응답의 필드 이름은 기존 계약을 유지한다. API와 DB 계약의 상세 내용은 [API 명세](API.md), [DB 구조](DATABASE.md)를 따른다.

---
## 4. 변경 후 확인

- PHP 파일의 문법 검사와 기존 자동 검사를 실행한다.
- 로그인·메시지 저장·조회·서버/채널 관리 흐름에서 기존 요청과 응답이 유지되는지 확인한다.
- 다른 팀원이 PHP 함수를 이름 지정 인수로 직접 호출하는지 확인하고 필요한 호출을 수정한다.
- 계정·DB 비밀번호·세션·CSRF 토큰과 개인 실행 설정은 문서나 Git에 기록하지 않는다.

2026-11-04에 격리된 테스트 DB에서 전체 자동 검사 165개가 통과했다. PHP 42개, JavaScript 27개, PowerShell 3개 파일의 구문 검사도 통과했다.
