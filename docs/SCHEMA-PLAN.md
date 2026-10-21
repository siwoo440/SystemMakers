---
# 1단계 DB 구조 구현 계획

기준: [DATABASE.md](DATABASE.md), [API.md](API.md). 범위는 MySQL 스키마와 관계 검증, 메신저 UI 시안 이미지다. PHP API와 프론트엔드 코드 구현은 다음 단계다.

---
## 공통 조건

MySQL 8.4, InnoDB, utf8mb4_0900_as_ci, BIGINT UNSIGNED 식별자, UTC 저장을 적용한다. SQL·테스트 코드는 각 줄에 짧은 한글 주석을 붙이고 블록은 여는 괄호·중괄호를 다음 줄에 배치한다. 기존 데이터를 삭제하거나 DB 계정 정보를 커밋하지 않는다.

---
## 작업 1 스키마와 관계 검증

- [x] 테스트 전용 DB에 빈 구조를 준비하고 테이블 존재·고유 키·부모 참조·삭제 정책을 검사하는 통합 테스트를 먼저 작성.
- [x] 스키마 부재로 테스트가 실패하는지 확인.
- [x] backend/sql/schema.sql에 users·servers·server_members·channels·messages·auth_rate_limits 생성문 작성.
- [x] 같은 테스트를 실행하여 생성·중복 차단·외래 키·삭제 정책·본문 길이 제약을 검증.
- [x] 실제 서버 버전과 실행 명령·결과를 docs/SCHEMA-VERIFICATION.md에 기록.

테스트는 전용 DB 이름을 강제하고 사용자 데이터가 없는 새 DB에서 실행한다. 스키마는 DB 자체를 생성·삭제하지 않으며 테이블 생성만 담당한다. 소유자와 owner 멤버십의 일치, 입력 정규화, 공백 본문 거절, 로그인 횟수 제한 로직은 PHP 단계의 검증 항목으로 분리한다.

---
## 작업 2 UI 시안과 공유

- [x] Discord·Slack 공식 자료의 서버·채널 탐색과 시간순 대화 구성을 참고.
- [x] imagegen 기본 도구로 채팅 화면과 로그인·회원가입 시안 이미지 제작.
- [x] 결과 이미지를 docs/assets/ui에 보관하고 실제 이미지 내용을 확인.
- [x] docs/UI-DIRECTION.md에 시안의 범위, API 대응 관계, 생성 프롬프트와 참고 링크 기록.
- [x] README·DATABASE.md에 구현 상태와 링크 갱신 후 SystemMakers의 codex/backend-auth-messages 브랜치에 반영.

---
## 검토 중점

동일 이메일의 대소문자 중복, 다른 서버의 같은 채널명 허용, 채널 삭제의 메시지 연쇄 삭제, 서버 탈퇴 후 메시지 유지, 기존 소유자·작성자 삭제 차단을 실제 데이터로 검사한다. UI는 이번에 구현하지 않는 음성 통화·파일 전송·검색 기능을 표시하지 않는다.
