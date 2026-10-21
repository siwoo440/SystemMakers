---
# SystemMakers

Discord 스타일 웹 채팅 프로젝트. HTML·CSS·JavaScript 프론트엔드와 PHP·MySQL 백엔드를 사용한다.

현재는 MySQL 스키마, PHP 공통 처리와 실제 메신저 웹 화면을 구현했다. 웹 화면은 미리보기이며 회원가입·로그인 처리와 메시지 DB 저장·조회는 후속 단계다.

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
- [한국어 커밋 메시지](docs/COMMIT-MESSAGES.md): 기존 이력 변경과 이후 작성 규칙

---
## 로컬 웹사이트 실행

현재 개발 환경은 [http://127.0.0.1:8088/](http://127.0.0.1:8088/)에서 실행한다. PHP와 MySQL 프로세스가 켜져 있어야 한다. 저장소 루트에서 다음 명령을 사용한다.

```powershell
.\scripts\start-dev.ps1 # 현재 로컬 설정으로 웹 서버 시작
```

다른 PHP 설치를 사용할 때는 -PhpPath, 다른 포트를 사용할 때는 -Port 인수를 지정한다. 사용 중인 포트가 있으면 기존 서버를 건드리지 않고 실행을 중단한다.

PHP에는 pdo_mysql·mbstring이 필요하다. MySQL 8.4 DB에 초기 스키마를 별도로 적용하고 MYSQL_HOST·MYSQL_PORT·MYSQL_DATABASE·MYSQL_USER·MYSQL_PASSWORD 환경 변수를 모두 지정한다. 실제 비밀번호와 접속 정보는 Git에 올리지 않는다. 현재 컴퓨터의 .runtime/web-env.json과 PHP 설정·실행 도구는 Git에서 제외하며 새 체크아웃에는 포함되지 않는다. 로컬 HTTP에서는 APP_ENV=development와 SESSION_COOKIE_SECURE=0을 명시하고, 운영에서는 기본 Secure 설정과 HTTPS를 사용한다.

개발 서버는 공개 정적 파일과 명시된 API만 제공한다. 운영 배포에는 PHP 웹 서버에서 같은 공개 범위와 비공개 파일 접근 차단을 별도로 설정해야 한다.

---
## 현재 진행 상태

1단계 DB 구조와 2단계 PHP 공통 처리를 완료했다. 실제 GET API는 csrf.php·get_current_user.php·health.php다. 인증 폼은 입력 형식만 확인하며 비밀번호를 전송·저장하지 않고, 미리보기 메시지는 새로고침하면 초기화된다. 다음 단계는 3단계 회원가입·로그인·로그아웃 처리와 화면 연동이다.

작업 저장소는 [siwoo440/SystemMakers](https://github.com/siwoo440/SystemMakers)다. 사용자 지시에 따라 기존 개발 커밋 전체를 main에 통합했으며 이후 작업·커밋·푸시도 main에서 진행한다. 공통 필드·응답 형식·삭제 정책을 바꾸면 API.md와 DATABASE.md를 같은 변경에서 갱신한다.
