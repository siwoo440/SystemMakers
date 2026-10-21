---
# 8단계 서버·초대·참여 구현 계획

목표: 새 회원 두 명이 웹에서 서버 생성·초대·참여·대화·탈퇴를 완료하는 상태.

구조: 기존 PHP/PDO·세션·CSRF와 MessageFeed 재사용. 관리 업무·횟수 제한·공개 진입점을 분리하고 화면은 별도 서버 관리 모듈을 연결.

기술: PHP 8.4·MySQL 8.4·HTML/CSS/JavaScript, 프레임워크 추가 없음.

기준: [7단계 규칙](PHASE-7-RULES.md), API.md 9절, DATABASE.md 8절. 사용자가 확정 계획의 실행을 요청했으며 기존 main 체크아웃에서 직접 구현.

---
## 공통 제약과 검토 초점

- Allman·짧은 한글 줄 주석, 자격 증명·DB 파일 제외, 기존 자료 보존.
- 24시간·600초 경계, 코드 원문 비저장, 권한 잠금과 원자성, 응답 유실 시 자동 재전송 금지.
- 다른 계정의 늦은 응답, 빈 서버 목록, 중복 참여의 역할 보존, 삭제 중 전송, 코드 재발급 경합을 검증.
- 기존 90개 검사 유지. 채널 관리·프로필 구현은 9~10단계이며 이번 범위에서 제외.

---
## 작업 1 · 변경 파일과 서버 API

파일: backend/sql/migrations/001_server_invites_and_limits.sql, scripts/migrate.php·migrate.ps1, backend/includes/server_management.php·management_rate_limit.php·management_endpoint.php, backend/api의 서버 API 9개, router.php, tests/server-management.test.mjs.

인터페이스: run_management(PDO, string, string, array): array는 사용자·입력을 받아 data/status 반환. 공통 오류 예외는 API에서 JSON 변환. 별도 버킷 트랜잭션은 업무 재시도 전에 한 번 집계.

- [x] 공개 라우터·실제 가입·독립 MySQL의 신규 경로 404 실패 확인.
- [x] 변경 파일·실행 도구와 서버 목록·생성·초대·참여·탈퇴·미리보기·삭제 구현.
- [x] 정상·역할·초대 경계·중복·횟수·삭제·자료 보존과 기존 전체 검사 확인.

---
## 작업 2 · 실제 웹 화면

파일: frontend/server-manager.mjs, frontend/index.html·app.css·app.js, tests/server-manager.test.mjs, router.php.

인터페이스: 서버 관리 모듈은 request·현재 계정·소속 재조회·계정 종료·CSRF 복구 콜백을 받음. 기존 loadChannels에 서버 목록과 선택을 연결하고 계정 교체 시 모듈·선택 ID 정리.

- [x] 화면 상태 모듈의 계정 변경·지연 응답·중복 제출·빈 서버 선택 검사 실패 확인.
- [x] 서버 선택·생성·코드 참여·초대·폐기·탈퇴·이름 입력 삭제와 로컬 선택 ID 복원 구현.
- [x] 기존 메시지와 인증 회귀·모듈 검사 및 PHP/JS 문법 검사 확인.

---
## 작업 3 · 실제 적용·검증·문서

- [x] 개발 DB의 기존 계정·채널·대화 집계·백업 후 변경 파일 적용.
- [x] 실제 브라우저 생성·참여·대화·탈퇴·삭제 미리보기와 공개 API의 실제 삭제 확인, 기존 자료 보존.
- [x] 전체 검사·독립 최종 코드 검토·수정, API/DB/README·검증 결과 갱신.
- [x] 한국어 main 커밋·푸시 대상 정리, 테스트용 서버·계정 정리와 기존 자료 보존 확인. 실제 커밋·원격 결과는 Git 이력으로 확인.
