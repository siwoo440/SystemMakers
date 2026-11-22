---

# SystemMakers 코드 안내

브라우저는 화면을 그리며 PHP API로 로그인·조회·전송을 요청한다. MySQL은 대화를 보관하고 Ratchet은 구독 중인 브라우저에 변경을 알린다. 아래 표에서 수정할 기능의 진입점과 해당 동작을 확인하는 테스트를 찾을 수 있다.

---

## 기능별로 읽는 순서

| 확인할 동작 | 먼저 볼 코드 | 확인할 테스트 |
|---|---|---|
| 화면 열기 | [HTML](../index.html)이 공통·화면별 CSS와 [앱 진입점](../frontend/app.js)을 불러온다. [라우터](../router.php)는 공개 파일과 API를 허용 목록으로 연결한다. | [공개 경로와 캐시](../tests/router.test.mjs) · [인증 창과 화면 상태](../tests/app-session.test.mjs) |
| 로그인과 계정 전환 | [로그인](../backend/api/login.php)이 비밀번호를 확인한다. [세션](../backend/includes/session.php)과 [인증](../backend/includes/auth.php)은 현재 계정, [CSRF](../backend/includes/csrf.php)는 쓰기 요청의 토큰을 확인한다. | [인증](../tests/auth.test.mjs) · [탭의 계정 변경](../tests/app-session.test.mjs) |
| 서버와 채널 관리 | [서버 선택](../frontend/server-manager.mjs)에서 현재 서버를 정한다. [서버 관리](../backend/includes/server_management.php)는 초대·소속·소유자 권한, [채널 관리](../backend/includes/channel_management.php)는 채널 변경 권한을 확인한다. | [서버 권한](../tests/server-management.test.mjs) · [채널 권한](../tests/channel-management.test.mjs) |
| 채널에 메시지 보내기 | [전송 API](../backend/api/send_message.php)가 세션에서 작성자를 확인한다. [저장 함수](../backend/includes/messages.php)는 트랜잭션 안에서 채널과 소속을 확인한 뒤 메시지를 저장한다. | [저장과 동시 전송](../tests/messages.test.mjs) |
| 메시지 받기 | [Ratchet 중계기](../backend/realtime/MessageRelay.php)가 구독 권한과 최신 메시지 ID를 확인한다. [실시간 클라이언트](../frontend/realtime.mjs)가 알림을 받으면 브라우저가 PHP에 새 본문을 요청한다. [목록 처리](../frontend/message-feed.mjs)는 메시지 ID로 기존 말풍선을 재사용한다. | [기록과 커서](../tests/message-history.test.mjs) · [실시간 구독과 권한 회수](../tests/realtime-integration.test.mjs) |
| 개인 대화와 친구 | [개인 대화 화면](../frontend/direct-ui.mjs)과 [친구 목록](../frontend/friends-ui.mjs)에서 대화를 연다. [개인 대화 처리](../backend/includes/direct_messages.php)는 참여자와 차단 관계를 확인한다. | [개인 대화](../tests/direct-messages.test.mjs) · [친구 요청](../tests/friends.test.mjs) |
| 첨부와 프로필 | [첨부 처리](../backend/includes/attachments.php)는 대화 권한을 확인해 파일을 저장하거나 읽는다. [프로필 화면](../frontend/profile-ui.mjs)에서 사용자명·상태·사진·차단 목록을 관리한다. | [첨부 권한](../tests/attachments.test.mjs) · [프로필과 차단](../tests/profile-block.test.mjs) |

---

## 실행과 설계 문서

- **개발 PC에서 실행** — PHP·MySQL 준비, 스키마 적용, 같은 Wi-Fi 공유와 테스트 명령. [로컬 실행](LOCAL-SETUP.md)
- **NAS에 배포** — Caddy가 HTTPS 화면과 WSS 구독을 각각 웹·Ratchet으로 전달하는 구성, DB 이관과 복구, 외부망 검사. [Compose 구성](../compose.yaml) · [프록시 설정](../docker/Caddyfile) · [배포 절차](NAS-DEPLOYMENT.md)
- **API와 데이터** — 경로별 요청·응답·권한, 14개 테이블의 관계와 마이그레이션. [API 명세](API.md) · [DB 구조](DATABASE.md)
- **실시간 갱신** — 웹·Ratchet의 세션 공유, 연결 중단 시 재조회와 재연결. [실시간 연결](REALTIME.md)
- **디자인** — 다섯 CSS 파일의 역할, 화면별 수정 위치와 모바일 메뉴. [화면 안내](UI-DIRECTION.md) · [이전 테마 화면 예시](../README.md#화면-살펴보기)
- **운영 전 확인** — 실제 NAS·외부망·기기 검증 항목과 기존 최적화 측정치. [남은 작업](DEVELOPMENT-DIRECTION.md)
- **기여 규칙** — 관련 변경을 한 커밋에 묶고 한국어 제목과 본문에 변경 사항·검사 결과를 기록한다. [저장소 규칙](../AGENTS.md) · [변수명과 호환성](VARIABLE-NAMING.md)
