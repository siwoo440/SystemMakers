---
# SystemMakers

Discord 스타일 웹 채팅 프로젝트. HTML·CSS·JavaScript 프론트엔드와 PHP·MySQL 백엔드를 사용한다.

현재는 MySQL 스키마, PHP 공통 처리, 실제 회원 인증과 채널별 메시지 저장을 웹 화면에 연결했다. 참여 채널을 조회하고 DB 저장에 성공한 메시지만 화면에 표시한다. 이전 대화 조회와 신규 메시지 폴링은 5단계다.

팀원 A는 프론트엔드, 팀원 B는 DB·인증·메시지 API, 팀원 C는 서버·채널·프로필 관리 기능을 담당한다. 프론트엔드는 백엔드 연동 확인에 필요한 최소 화면부터 구성한다.

---
## 공유 문서

- [API 명세 초안](docs/API.md): 요청·응답, 세션·CSRF, 오류 코드와 메시지 폴링
- [DB 구조 초안](docs/DATABASE.md): 테이블·인덱스·외래 키·삭제·트랜잭션 규칙
- [개발 방향](docs/DEVELOPMENT-DIRECTION.md): 역할 분담, 범위와 구현 순서
- [초기 스키마](backend/sql/schema.sql): 테이블 6개·외래 키·인덱스·본문 길이 제약
- [스키마 검증 결과](docs/SCHEMA-VERIFICATION.md): 실제 MySQL 8.4.13에서 전체 테스트 15개 통과
- [UI 시안](docs/UI-DIRECTION.md): 채팅 화면과 로그인·회원가입 이미지
- [UI 생성 프롬프트](docs/UI-PROMPTS.md): 이미지 생성·수정 기록
- [2단계 검증 결과](docs/PHASE-2-VERIFICATION.md): PHP·웹 통합 테스트 35개와 실제 화면 확인
- [3단계 검증 결과](docs/PHASE-3-VERIFICATION.md): 실제 회원 인증·횟수 제한·화면 연동 확인
- [4단계 검증 결과](docs/PHASE-4-VERIFICATION.md): 실제 메시지 저장·채널 권한·동시 전송·웹 연동 확인
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

회원가입만으로 서버 소속이 생기지 않는다. C의 서버 참여 기능을 연결하기 전에는 개발용 스크립트에 이미 가입한 사용자명을 명시한다. 아래 my_user·other_user는 실제 사용자명으로 바꾼다.

```powershell
.\scripts\seed-dev.ps1 -OwnerUsername 'my_user' # 기존 계정의 개발 서버와 채널 준비
.\scripts\seed-dev.ps1 -OwnerUsername 'my_user' -Members 'other_user' # 같은 개발 서버에 기존 계정 추가
```

APP_ENV가 development 또는 test인 CLI에서만 실행한다. 기존 사용자만 사용하며 개발 서버·소속·일반·개발·공지 채널을 준비한다. 재실행 시 기존 계정·대화·채널과 일반 멤버의 관리자 역할을 보존한다. 준비 후 웹사이트를 새로고침하거나 채널 목록 다시 확인을 누른다. 다른 PHP는 -PhpPath 인수로 지정한다. scripts/seed-dev.php를 직접 실행할 때는 같은 DB·환경 변수를 먼저 지정한다.

---
## 현재 진행 상태

1단계 DB 구조, 2단계 공통 처리, 3단계 회원 인증, 4단계 채널별 메시지 저장과 화면 연동을 완료했다. GET API는 csrf.php·get_current_user.php·get_channels.php·health.php, POST API는 register.php·login.php·logout.php·send_message.php다. 가입 후 별도로 로그인하며 인증된 사용자의 현재 서버 소속을 확인하고 원문 메시지를 저장한다. 비밀번호 원문은 DB·브라우저 저장소에 보관하지 않는다.

메시지는 새로고침 후에도 DB에 남지만 현재 화면은 이번 접속에서 저장 성공한 메시지만 표시한다. 5단계에서 이전 대화 불러오기·신규 메시지 폴링을 연결하고, 6단계에서 전체 흐름을 검증한다. 전송 결과를 확인하지 못했을 때는 중복 저장 가능성을 안내하며 자동으로 다시 보내지 않는다.

작업 저장소는 [siwoo440/SystemMakers](https://github.com/siwoo440/SystemMakers)다. 사용자 지시에 따라 기존 개발 커밋 전체를 main에 통합했으며 이후 작업·커밋·푸시도 main에서 진행한다. 공통 필드·응답 형식·삭제 정책을 바꾸면 API.md와 DATABASE.md를 같은 변경에서 갱신한다.
