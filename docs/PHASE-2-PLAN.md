---
# 2단계 PHP 공통 처리와 웹 화면 구현 계획

사용자 요청에 따라 기존 PHP·MySQL 구조를 유지하고 실제 로컬 웹사이트를 추가한다. [API.md](API.md), [DATABASE.md](DATABASE.md), [UI-DIRECTION.md](UI-DIRECTION.md)를 기준으로 한다.

---
## 범위와 공통 규칙

이번 단계는 PDO 연결·JSON 응답·요청 검사·세션·CSRF·채널 멤버십 공통 함수와 이를 실제 호출하는 최소 웹 화면이다. 회원가입·로그인 저장 처리는 3단계, 메시지 저장은 4단계, 메시지 조회는 5단계다. 웹 화면의 예시 대화는 미리보기임을 표시하며 실제 가입·로그인·DB 메시지 저장 성공을 가장하지 않는다.

코드는 Allman 스타일과 줄별 짧은 한글 명사형 주석을 적용한다. 중괄호만 있는 줄의 주석은 생략할 수 있다. 비밀 설정은 .runtime 또는 Git에서 제외한 config.local.php에 보관한다. 기존 커밋 3개와 이후 커밋은 한국어 제목과 상세 본문을 사용하며 제목·본문 항목을 추가·수정·제거 등의 명사형으로 끝낸다.

---
## 작업 1 백엔드 공통 처리

소유 경로는 backend/config, backend/includes, backend/api, tests/backend.test.mjs다. PDO 연결은 MYSQL_HOST·MYSQL_PORT·MYSQL_DATABASE·MYSQL_USER·MYSQL_PASSWORD 환경 설정을 읽고 utf8mb4·UTC·예외 모드·실제 prepared statement를 적용한다. 테스트 환경은 프로젝트의 독립 MySQL 33360 포트를 사용한다.

공통 인터페이스는 db(): PDO, require_user(PDO): array, require_csrf(): void, require_channel_member(PDO, string, string): array, respond_success(array, int): never, respond_error(string, string, int, array): never다. API.md의 오류 구조와 세션 쿠키·만료 규칙을 따른다. 32 KiB 본문, JSON 객체, 허용 필드, 메서드 검증을 재사용 가능한 함수로 제공한다.

- [x] 실제 PHP·HTTP 또는 CLI 테스트를 먼저 작성하여 미구현 실패 확인.
- [x] DB 연결, 공통 예외·응답·요청 처리, 세션·CSRF·사용자·채널 권한 함수 구현.
- [x] GET /api/csrf.php, GET /api/get_current_user.php, GET /api/health.php 구현. health는 DB 연결 성공 여부만 반환하고 설정·버전·계정은 노출하지 않음.
- [x] 토큰 유지·세션별 분리, 비로그인 401, 메서드 405, 내부 오류 비노출, 본문·자료형·ID 입력 검증을 실제 실행으로 확인.

---
## 작업 2 웹 화면

소유 경로는 frontend/index.html, frontend/app.css, frontend/app.js, 필요 시 tests/frontend.test.mjs다. 프레임워크 없이 HTML·CSS·JavaScript를 사용하고 기존 UI 시안의 짙은 남색·청록색·서버 레일·채널 목록·대화 영역 구성을 구현한다.

- [x] 채널 선택, 예시 대화, 메시지 미리보기 전송·글자 수, 인증 폼 전환을 제공.
- [x] 첫 화면과 대화 영역에 미리보기 상태·새로고침 시 초기화를 명확히 표시. 비밀번호를 전송·저장하지 않고 인증 폼 제출은 준비 중 상태로 처리.
- [x] 실제 csrf.php·get_current_user.php·health.php를 fetch로 연결하되 401을 정상 비로그인 상태로 처리.
- [x] 모바일 레이아웃·키보드 포커스·필드 레이블·textContent 렌더링·사용자 스크롤 위치 유지 적용.

---
## 작업 3 통합과 이력 정리

루트 작업자가 router.php, 실행 설정, 문서와 Git 이력을 담당한다. PHP 개발 서버는 frontend만 문서 루트로 사용하고 허용한 API 경로만 backend에 연결한다. SQL·config·includes·.git·.runtime은 웹으로 제공하지 않는다.

- [x] 기존 커밋을 로컬 백업 참조에 보존한 뒤 트리·작성자 정보는 유지하고 한국어 메시지만 재작성.
- [x] 사용자 승인 범위인 main·작업 브랜치만 정확한 원격 SHA를 조건으로 force-with-lease 업데이트.
- [x] 전체 테스트·PHP 문법·브라우저 동작과 비공개 파일 접근 차단 검증.
- [x] 실제 웹사이트를 오른쪽 패널에 열고 실행 방법·남은 단계를 문서에 기록.
- [x] 한국어 제목·상세 본문으로 새 변경 커밋·푸시.

---
## 인터페이스 사전 점검

| 연결 | 합의 |
|---|---|
| 프론트 → 공통 API | /api/csrf.php, /api/get_current_user.php, /api/health.php만 실제 호출 |
| 서버 라우터 → backend | 정확한 API 경로 허용 목록; 그 외 API는 공통 JSON 404 |
| DB 테스트 → 공통 설정 | 서로 다른 임의 테스트 DB 사용, 기존 schema.test.mjs 유지 |
| 프론트 → 후속 API | 미리보기 상태를 명시하고 회원·메시지 DB 처리 미구현을 숨기지 않음 |
| 병렬 작업 경계 | 백엔드와 frontend 파일 분리, 라우터·문서·Git은 루트 전담 |
