---
# Discord 채팅 백엔드 개발 방향

작성일: 2026-10-21

상태: 구현 순서 1의 API·DB 계약 초안 작성. PHP API·SQL·화면은 아직 구현하지 않음. 구체적인 필드·검증·인증·삭제 규칙은 [API.md](API.md)와 [DATABASE.md](DATABASE.md)를 우선하며 이 문서는 개발 범위를 설명한다.

---
## 1. 확인 결과와 목표

- 첨부 지시서 기준 기술: HTML, CSS, JavaScript, PHP, MySQL.
- 상위 저장소는 별개인 DEVFORGE 홈페이지용 Next.js 프로젝트.
- 사용자 결정에 따라 상위 작업 폴더 아래 discord-chat 폴더에서 별도 프로젝트로 진행.
- PHP, mysql, mariadb, docker 명령은 현재 PATH에서 확인되지 않음. 설치 여부와 별도 서버 유무는 확인 필요.
- 작업 대상 GitHub 저장소는 [siwoo440/SystemMakers](https://github.com/siwoo440/SystemMakers). DEVFORGE 저장소의 원격 주소를 변경하지 않으며 discord-chat을 별도 Git 저장소로 연결.
- 이번 단계의 결과물은 API.md·DATABASE.md 초안과 개발 방향 정리. PHP API·DB·화면은 아직 구현하지 않음.
- 성공 기준: 팀원 A가 fetch로 회원가입·로그인·채널별 채팅을 연동하고, 팀원 C가 공통 DB와 인증 코드를 재사용할 수 있는 상태.

---
## 2. 구조와 범위

권장안은 프레임워크 없는 PHP + PDO + MySQL과 동일 출처 배포다. 브라우저가 프론트엔드와 PHP API에 같은 출처로 접근하도록 구성한다. 프론트엔드 개발 서버를 따로 사용하는 경우 API 프록시 또는 명시적인 CORS·쿠키 설정이 추가로 필요하다.

메시지는 짧은 주기의 HTTP 폴링으로 구현한다. WebSocket 도입은 이번 MVP 범위에서 제외한다.

예정 경로는 다음과 같다. 현재는 docs 문서와 프로젝트 소개만 존재한다.

| 경로 | 역할 |
|---|---|
| backend/api/ | 브라우저에 공개할 PHP API |
| backend/config/database.php | 환경 설정 읽기와 PDO 연결 |
| backend/includes/ | 인증, 권한, CSRF, 입력 검증, JSON 응답 공통 처리 |
| backend/sql/schema.sql | 테이블·외래 키·인덱스 정의 |
| backend/sql/seed.dev.sql | 개발·테스트 전용 서버·멤버·채널 샘플 |
| frontend/ | 팀원 A의 화면 파일 위치, 기존 파일이 전달되면 해당 구조 우선 |
| docs/API.md | 팀원 A·C용 요청·응답 및 인증 계약 |
| docs/DATABASE.md | 팀원 C용 테이블·관계·삭제 정책 |
| tests/ | PHP API와 MySQL 통합 검증 |
| README.md | 실행 환경, 설정, DB 생성, 테스트 방법 |

웹 서버는 프론트엔드와 API 경로만 공개하고 config, includes, sql, 비밀 설정 파일에 대한 외부 접근을 차단한다. 실제 자격 증명은 Git에서 제외하고 값이 없는 설정 예시만 공유한다.

팀원 B는 인증·메시지 API와 공통 DB 구조를 담당한다. 사용자 지시에 따라 프론트는 회원가입·로그인·채널 선택·메시지 송수신 확인용 최소 화면만 예정한다. 팀원 C의 서버·채널 생성 및 관리 API는 별도로 구현하지 않는다. 개발용 샘플 데이터는 팀원 C의 API 구현 전 통합 테스트에만 사용한다.

---
## 3. 데이터베이스 초안

모든 테이블은 InnoDB와 utf8mb4를 사용한다. ID 및 외래 키의 자료형을 통일하고, 시간은 UTC로 저장한다. 테이블별 상세 자료형은 실행할 MySQL 버전을 확인한 뒤 schema.sql에 확정한다.

| 테이블 | 주요 열과 제약 |
|---|---|
| users | id, username, email, password_hash, created_at; 사용자명·이메일 각각 UNIQUE |
| servers | id, name, owner_id, created_at; owner_id는 users 참조 |
| server_members | server_id, user_id, role, joined_at; 서버·사용자 조합을 기본 키로 사용 |
| channels | id, server_id, name, created_at; server_id는 servers 참조 |
| messages | id, channel_id, user_id, content, created_at; 채널·사용자 외래 키와 (channel_id, id) 인덱스 |

사용자명은 영문·숫자·밑줄 3~32자, 이메일은 유효한 ASCII 주소로 제한한다. 두 값 모두 앞뒤 공백 제거·소문자 저장·대소문자 구분 없는 중복 판정을 적용한다. DB 비교 규칙과 애플리케이션 검증을 일치시키고, 동시 가입 시 UNIQUE 위반도 중복 오류로 처리한다. 비밀번호는 공백 제거 등으로 임의 변형하지 않는다. 로그인 요청 제한을 위한 auth_rate_limits 보조 테이블도 둔다.

외래 키 삭제 정책 제안:

- 서버 삭제 시 해당 멤버십·채널 삭제, 채널 삭제 시 메시지 삭제: CASCADE.
- 서버 소유자 및 메시지 작성자 계정의 참조가 남아 있으면 계정 삭제 제한: RESTRICT.
- 회원 탈퇴·익명화와 메시지 수정·삭제는 이번 MVP 범위 밖이며 별도 정책이 필요함.
- 서버 생성자는 서버 생성과 멤버십 등록을 하나의 트랜잭션에서 처리하며 owner 역할을 부여. 해당 기능의 구현 담당은 C.
- 서버 탈퇴 시 작성 메시지는 유지하되 이후 조회·전송 권한은 차단.

---
## 4. API 계약 초안

기본 주소는 /api/를 제안하며 배포 라우팅에 맞춰 API.md에 확정한다. 저장 경로 backend/api와 외부 URL을 구분한다.

| 메서드·파일 | 입력 | 주요 동작 |
|---|---|---|
| GET csrf.php | 없음 | 로그인 전에도 세션별 CSRF 토큰 발급 |
| POST register.php | username, email, password | 검증·중복 확인·해시 저장; 가입 후 로그인은 별도 |
| POST login.php | email, password | 비밀번호 확인·세션 ID 재생성·사용자와 갱신된 CSRF 토큰 반환 |
| POST logout.php | 없음 | 세션 데이터와 세션 쿠키 제거 |
| GET get_current_user.php | 없음 | 현재 사용자 조회, 비로그인 시 401 |
| POST send_message.php | channel_id, content | 인증·서버 멤버십 확인 후 세션 사용자로 저장 |
| GET get_messages.php | channel_id, limit, before_id 또는 after_id | 최초·이전·신규 메시지 조회 |

POST 본문은 JSON으로 전달하고 상태 변경 요청에는 X-CSRF-Token 헤더를 사용한다. 로그인·회원가입에도 로그인 전 발급한 토큰을 적용한다. 모든 응답은 첨부 지시서의 success/data 또는 success/error 구조를 따른다.

HTTP 상태 코드 기준은 생성 201, 정상 조회·로그인·로그아웃 200, 잘못된 요청 400, 비로그인 401, 권한·CSRF 오류 403, 없는 채널 404, 메서드 오류 405, 중복 409, 지원하지 않는 본문 형식 415, 입력 검증 오류 422, 요청 제한 429, 내부 오류 500으로 제안한다.

메시지 규칙 제안:

- 본문 최대 2,000자, 공백만 있는 본문 거절.
- 기본 조회 50개, 최대 100개.
- 최초 조회: 해당 채널의 최신 N개를 선택한 뒤 ID 오름차순으로 반환.
- 이전 조회: before_id보다 작은 메시지 중 가까운 N개를 ID 오름차순으로 반환.
- 신규 조회: after_id보다 큰 메시지를 ID 오름차순으로 N개까지 반환.
- before_id와 after_id를 함께 사용하면 400.
- 응답에 다음 조회용 커서와 has_more를 포함하고, 커서는 DB 전체 최댓값이 아닌 실제 반환한 메시지에서 계산.
- 신규 메시지가 여러 페이지면 남은 페이지를 순서대로 요청한 뒤 일반 폴링으로 복귀.
- 기본 폴링 간격은 2초, 이전 요청이 끝난 뒤 다음 요청을 예약하여 중복 요청 방지.
- 채널 이동 시 이전 요청 취소 또는 응답 무시, 커서는 채널별로 관리.
- 메시지 ID는 JSON에서 문자열로 통일하여 JavaScript 정수 정밀도 문제를 방지. 첨부 예시의 숫자 ID와 달라지는 제안이므로 팀원 A·C와 계약에 명시.
- 날짜는 UTC ISO 8601 형식으로 반환하고 화면에서 현지 시간으로 표시.

---
## 5. 보안과 협업 규칙

- PDO Prepared Statement와 비밀번호 해시·검증 사용.
- HttpOnly, SameSite=Lax, 운영 HTTPS에서 Secure, 세션 strict mode 적용.
- 상태 변경 요청의 CSRF 토큰 검사 및 로그인 성공 시 토큰 갱신.
- 사용자 ID는 요청 본문이 아닌 세션에서 결정.
- 메시지 조회·전송마다 채널 존재와 해당 서버 멤버십 검사.
- 조회 API는 인증 정보를 읽은 뒤 세션 잠금을 신속히 해제하여 다른 요청 지연 방지.
- 로그인 요청 제한은 IP·계정 기준의 공유 저장소를 사용하며 세션 재발급만으로 우회되지 않도록 구성. MySQL 보조 테이블 등 실제 수단은 실행 환경에 맞춰 확정.
- 내부 SQL 오류는 서버 로그에 기록하고 API에는 공통 오류만 반환.
- 팀원 A는 메시지 본문을 textContent 등 일반 텍스트로 표시.
- 팀원 C는 공통 인증·멤버십 검사 함수를 재사용.
- PHP 코드에는 Allman 스타일과 줄마다 짧은 한글 명사형 주석 적용.
- 작업 브랜치는 codex/backend-auth-messages. 사용자가 지정한 SystemMakers 저장소에 문서 변경을 커밋·푸시하고 이후 같은 저장소에서 작업.

---
## 6. 구현 순서와 완료 기준

1. PHP·MySQL 버전, PHP의 pdo_mysql·mbstring 확장, 웹 서버·배포 출처 확인.
2. API.md와 DATABASE.md 초안에서 필드명·ID 형식·삭제 정책·인증 규칙 정리.
3. schema.sql, 개발용 샘플 데이터, DB 연결·JSON 응답·세션·CSRF 공통 처리 구현.
4. 회원가입·로그인·로그아웃·현재 사용자 API 구현.
5. 채널 권한 검사와 메시지 저장·조회·폴링 구현.
6. 독립된 테스트 DB에서 실제 API 검증 후 문서와 실행 방법 확정.

완료 검증에는 정상 가입·중복 가입·로그인 실패·로그아웃·비로그인 401·다른 서버 접근 403·없는 채널 404·CSRF 거절·메시지 저장·채널 간 조회 분리·커서 페이지 누락 및 중복·로그인 요청 제한을 포함한다. DB 외래 키와 삭제 정책도 테스트 DB에서 검증한다.

실행 환경이 없는 항목은 미실행으로 기록한다. PHP 문법 검사만으로 DB 연동 성공을 판정하지 않는다.

---
## 검색 참고

- [PHP PDO Prepared Statement](https://www.php.net/manual/en/pdo.prepared-statements.php)
- [PHP 세션 보안 설정](https://www.php.net/manual/en/session.security.ini.php)
- [PHP 세션 잠금 해제](https://www.php.net/manual/en/function.session-write-close.php)
- [MySQL 외래 키와 삭제 정책](https://dev.mysql.com/doc/refman/8.4/en/create-table-foreign-keys.html)
