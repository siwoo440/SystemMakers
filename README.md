---
# SystemMakers

Discord 스타일 웹 채팅 프로젝트. HTML·CSS·JavaScript 프론트엔드와 PHP·MySQL 백엔드를 사용한다.

현재는 MySQL 스키마, PHP 공통 처리, 실제 회원 인증과 채널별 메시지 저장·조회를 웹 화면에 연결했다. 참여 채널의 최신 50개 대화를 불러오며 이전 기록 추가 조회와 요청 완료 후 2초 간격의 새 메시지 자동 갱신을 지원한다.

팀원 A는 프론트엔드, 팀원 B는 DB·인증·메시지 API, 팀원 C는 서버·채널·프로필 관리 기능을 담당한다. 프론트엔드는 백엔드 연동 확인에 필요한 최소 화면부터 구성한다.

---
## 공유 문서

- [API 명세](docs/API.md): 요청·응답, 세션·CSRF·기대 계정, 오류 코드와 메시지 폴링
- [DB 구조](docs/DATABASE.md): 테이블·인덱스·외래 키·삭제·트랜잭션 규칙
- [개발 방향](docs/DEVELOPMENT-DIRECTION.md): 역할 분담, 범위와 구현 순서
- [초기 스키마](backend/sql/schema.sql): 테이블 6개·외래 키·인덱스·본문 길이 제약
- [스키마 검증 결과](docs/SCHEMA-VERIFICATION.md): 실제 MySQL 8.4.13에서 전체 테스트 15개 통과
- [UI 시안](docs/UI-DIRECTION.md): 채팅 화면과 로그인·회원가입 이미지
- [UI 생성 프롬프트](docs/UI-PROMPTS.md): 이미지 생성·수정 기록
- [2단계 검증 결과](docs/PHASE-2-VERIFICATION.md): PHP·웹 통합 테스트 35개와 실제 화면 확인
- [3단계 검증 결과](docs/PHASE-3-VERIFICATION.md): 실제 회원 인증·횟수 제한·화면 연동 확인
- [4단계 검증 결과](docs/PHASE-4-VERIFICATION.md): 실제 메시지 저장·채널 권한·동시 전송·웹 연동 확인
- [5단계 검증 결과](docs/PHASE-5-VERIFICATION.md): 이전 대화 조회·신규 적체·폴링·실제 화면 확인
- [6단계 전체 인수 결과](docs/PHASE-6-VERIFICATION.md): 가입부터 로그아웃까지 전체 흐름·계정 변경·권한 상실·확인 범위
- [7단계 확정 규칙·화면 흐름](docs/PHASE-7-RULES.md): 역할·초대·삭제·화면 상태와 단계별 API/DB 계약
- [8단계 서버·소속 검증](docs/PHASE-8-VERIFICATION.md): 웹 서버 생성·초대·참여·탈퇴·삭제와 실제 동시성·110개 검사
- [9단계 채널 관리 검증](docs/PHASE-9-VERIFICATION.md): 채널 생성·이름 변경·삭제·빈 서버 재생성과 전체 130개 검사
- [10단계 프로필 검증](docs/PHASE-10-VERIFICATION.md): 본인 조회·사용자명 변경·작성 관계 보존과 전체 150개 검사
- [한국어 커밋 메시지](docs/COMMIT-MESSAGES.md): 기존 이력 변경과 이후 작성 규칙

---
## 로컬 웹사이트 실행

현재 개발 환경은 [http://127.0.0.1:8088/](http://127.0.0.1:8088/)에서 실행한다. PHP와 MySQL 프로세스가 켜져 있어야 한다. 저장소 루트에서 다음 명령을 사용한다.

```powershell
.\scripts\start-dev.ps1 # 현재 로컬 설정으로 웹 서버 시작
```

다른 PHP 설치를 사용할 때는 -PhpPath, 다른 포트를 사용할 때는 -Port 인수를 지정한다. 사용 중인 포트가 있으면 기존 서버를 건드리지 않고 실행을 중단한다.

PHP에는 pdo_mysql·mbstring이 필요하다. MySQL 8.4 DB에 초기 스키마를 별도로 적용하고 MYSQL_HOST·MYSQL_PORT·MYSQL_DATABASE·MYSQL_USER·MYSQL_PASSWORD 환경 변수를 모두 지정한다. 실제 비밀번호와 접속 정보는 Git에 올리지 않는다. 현재 컴퓨터의 .runtime/web-env.json과 PHP 설정·실행 도구는 Git에서 제외하며 새 체크아웃에는 포함되지 않는다. 로컬 HTTP에서는 APP_ENV=development와 SESSION_COOKIE_SECURE=0을 명시하고, 운영에서는 기본 Secure 설정과 HTTPS를 사용한다.

로그인에는 별도로 AUTH_RATE_LIMIT_KEY 환경 변수가 필요하다. 암호학적 난수로 생성한 32바이트 이상의 비밀 값을 지정하고 요청마다 바꾸지 않는다. 이메일·IP 제한 키를 HMAC 처리하는 용도이며 비밀번호 해시 키가 아니다. 값이 없거나 너무 짧으면 로그인은 공통 내부 오류로 종료한다. 키를 교체하면 기존 제한 버킷과 연결되지 않으므로 배포 환경에서도 안정적으로 보관한다.

개발 서버는 공개 정적 파일과 명시된 API만 제공한다. 운영 배포에는 PHP 웹 서버에서 같은 공개 범위와 비공개 파일 접근 차단을 별도로 설정해야 한다.

---
## 개발용 채널 준비

회원가입만으로 서버 소속이 생기지 않는다. 8단계부터 웹에서 서버 만들기·초대 코드로 참여를 사용할 수 있다. 개발 자료를 별도로 준비할 때는 아래 CLI에 기존 사용자명을 명시한다. my_user·other_user는 실제 사용자명으로 바꾼다.

```powershell
.\scripts\seed-dev.ps1 -OwnerUsername 'my_user' # 기존 계정의 개발 서버와 채널 준비
.\scripts\seed-dev.ps1 -OwnerUsername 'my_user' -Members 'other_user' # 같은 개발 서버에 기존 계정 추가
```

APP_ENV가 development 또는 test인 CLI에서만 실행한다. 기존 사용자만 사용하며 개발 서버·소속·일반·개발·공지 채널을 준비한다. 재실행 시 기존 계정·대화·채널과 일반 멤버의 관리자 역할을 보존한다. 준비 후 웹사이트를 새로고침하거나 채널 목록 다시 확인을 누른다. 다른 PHP는 -PhpPath 인수로 지정한다. scripts/seed-dev.php를 직접 실행할 때는 같은 DB·환경 변수를 먼저 지정한다.

---
## 현재 진행 상태

1단계 DB 구조부터 5단계 대화 조회·자동 갱신과 6단계 로컬 전체 인수 검증을 완료했다. GET API는 csrf.php·get_current_user.php·get_channels.php·get_messages.php·health.php, POST API는 register.php·login.php·logout.php·send_message.php다. 가입 후 별도로 로그인하며 인증된 사용자의 현재 서버 소속을 확인하고 원문 메시지를 저장·조회한다. 비밀번호 원문은 DB·브라우저 저장소에 보관하지 않는다.

메시지는 새로고침 후에도 DB에서 복원된다. 최신 50개보다 오래된 기록은 이전 대화 더 보기로 추가하고, 새 메시지는 이전 조회 완료 후 2초 뒤에 확인한다. 50개 초과 신규 기록은 페이지를 연속 조회하고 통신 오류 시 최대 30초까지 대기한다. 채널 이동·로그아웃 시 이전 요청을 취소하며, 과거 대화를 읽는 위치·채널별 초안·문자열 ID 정밀도를 유지한다. 전송 성공 응답은 중복 없이 표시하되 조회 커서를 앞당기지 않는다.

브라우저는 확인한 사용자 ID를 X-Expected-User-Id 헤더로 보내고 서버는 현재 세션과 다르면 자료 조회·저장·로그아웃 전에 SESSION_CHANGED로 거절한다. 다른 탭의 계정 변경 시 이전 계정 기록·초안을 화면에서 지우고 재확인을 안내한다. 같은 계정의 CSRF 교체는 초안을 보존하며 자동 재전송하지 않는다. 조회 또는 전송에서 채널 권한 상실을 확인하면 해당 기록을 지우고 조회·전송을 차단한다.

6단계까지 기존 B 담당 API와 웹 연동을 검증했고 8단계 서버·초대·소속, 9단계 채널 관리, 10단계 본인 프로필까지 확장했다. 다음은 11단계 전체 연결·실제 기기 검증과 12단계 운영 호스팅·HTTPS·프록시·부하 검증이다. 상세 범위는 최신 10단계 결과를 따른다.

7단계 규칙에 따라 서버·채널 관리와 본인 프로필을 실제 API와 웹에 연결했다. API는 0.8·공개 경로 22개, DB 문서 계약은 0.5·테이블은 기존 8개다. 9~10단계 추가 스키마 변경은 없다. 초대 원문은 발급 시만 표시하며 24시간 유효·재발급 시 이전 코드 무효화, 소유자만 초대·서버 삭제 가능하다. 일반 탈퇴는 대화를 보존한다.

채널 관리는 해당 서버의 소유자·관리자만 허용한다. 이름 변경은 ID·대화를 보존하고 같은 서버의 중복 이름을 거절한다. 삭제는 현재 영향과 정확한 이름을 확인하며 해당 채널 대화만 제거한다. 마지막 채널이 없어도 서버는 남고 관리자가 새 채널을 만들 수 있다. 삭제 성공 뒤 목록 통신이 실패해도 기존 기록·초안·선택을 복원하지 않는다.

로그인 후 하단 내 프로필에서 사용자명·이메일·가입일을 확인하고 사용자명만 수정할 수 있다. 사용자명은 가입과 같은 소문자·영문/숫자/밑줄 3~32자이며 중복 이름은 거절한다. 계정 ID·이메일·비밀번호·소속·기존 대화는 보존한다. 현재 탭의 본인 작성자명도 갱신하고, 다른 탭은 새로고침 또는 프로필을 포함한 재조회 때 반영한다. 중복·형식 오류는 입력을 유지하며 응답 유실 시 GET으로 확인하고 PATCH를 자동 반복하지 않는다.

신규 DB는 기존 schema.sql을 적용한 뒤 backend/sql/migrations/001_server_invites_and_limits.sql을 적용한다. 기존 DB는 백업 후 scripts/migrate.ps1 또는 scripts/migrate.php를 사용한다. 명시적인 MYSQL_HOST·MYSQL_PORT·MYSQL_DATABASE·MYSQL_USER·MYSQL_PASSWORD 환경 변수와 MySQL 8.4·PDO 확장이 필요하며, 생성 권한이 있는 변경 전용 계정을 사용한다. 개인 웹 설정을 자동 로드하거나 실행 계정의 권한을 승격하지 않는다. 도구는 기존 6개 구조와 신규 이름 충돌을 확인하고, 중복·부분 적용 상태면 중단한다. 완료 시 변경 파일 해시를 출력하므로 적용 DB·시각과 함께 별도 배포 기록에 보관한다. 운영 DDL의 자동 전체 롤백은 보장하지 않는다.

---
## 전체 검사 실행

실제 PHP 8.4와 MySQL 8.4가 필요하다. PHP_TEST_BIN·MYSQL_TEST_CLIENT·MYSQL_TEST_PORT에 실행 도구와 전용 검사 DB 포트를 지정한다. 기존 통합 검사는 로컬 root·빈 비밀번호를 사용하는 별도 테스트 MySQL 인스턴스에서 실행한다. 개발용 33360 포트와 분리한 33361 포트를 사용할 수 있다. 검사마다 무작위 DB를 생성하고 해당 DB만 정리한다. 실제 웹 라우터 검사에는 MYSQL_HOST·MYSQL_PORT·MYSQL_DATABASE·MYSQL_USER·MYSQL_PASSWORD·APP_ENV·SESSION_COOKIE_SECURE 환경 변수도 필요하다. .runtime/php.ini에는 pdo_mysql·mbstring과 세션 저장 위치를 설정한다.

```powershell
node --test # 기존 인증·저장과 신규 조회 전체 검사
node --test tests/acceptance.test.mjs # 실제 공개 API 전체 인수 검사
node --test tests/app-session.test.mjs tests/message-feed.test.mjs # 계정 변경과 조회 수명 회귀 검사
node --check frontend/app.js # 실제 화면 스크립트 문법 검사
node --check frontend/message-feed.mjs # 조회 상태 모듈 문법 검사
```

다른 컴퓨터에서는 Git에서 제외된 PHP·MySQL 실행 도구·DB·개인 설정을 별도로 준비한다. 이번 컴퓨터의 .runtime/start-local.ps1은 이미 구성한 DB와 웹을 다시 시작하는 개인 실행 도구이며 저장소에는 포함하지 않는다.

현재 검증 기준은 전체 150개 통과다. 기존 가입 계정의 seed-dev 인수 검사와 별도로 8~10단계 검사는 실제 공개 라우터에서 서버·초대·소속·채널·프로필 관리와 잠금 경합을 실행하고 무작위 DB만 정리한다. 화면 회귀는 실제 app.js·MessageFeed·ServerManager·각 관리 화면을 실행하며 DOM·네트워크·시계·선택 저장소 경계만 대체한다. PHP 문법 41개·JS 문법 6개도 통과했다. 운영·실제 휴대폰 검사는 이 숫자에 포함하지 않는다.

작업 저장소는 [siwoo440/SystemMakers](https://github.com/siwoo440/SystemMakers)다. 사용자 지시에 따라 기존 개발 커밋 전체를 main에 통합했으며 이후 작업·커밋·푸시도 main에서 진행한다. 공통 필드·응답 형식·삭제 정책을 바꾸면 API.md와 DATABASE.md를 같은 변경에서 갱신한다.
