---
# NAS Docker 구현 계획

> 실행 방식: executing-plans에 따라 현재 main에서 직접 구현하고 마지막에 독립 코드 검토 수행.

**목표:** 기존 데이터·인증을 보존하는 Compose 실행 환경과 같은 출처 HTTPS·WSS 연결 준비.

**구조:** Caddy, PHP 8.3 Apache, Ratchet, MySQL 8.4. 웹·Ratchet은 공통 세션 볼륨 사용.

**설계:** [승인한 설계](../specs/2026-11-19-nas-docker-design.md). 2026-11-19 사용자 승인.

---
## 전체 제약

- SystemMakers main에서 작업·한국어 커밋·푸시. 상위 저장소 변경 금지.
- Allman 스타일·짧은 한국어 명사형 줄 주석. 설정 파서의 문법 우선.
- 기존 인증·CSRF·권한·HTTP 안전망 유지. DB 자동 초기화·마이그레이션 금지.
- NAS·도메인·외부망 미확인. 실제 배포 성공 주장 금지.

---
## 검토 초점

- 잘못된 공개 출처·헤더 주입: 설정 거절과 안전한 CSP 검사.
- 프록시 IP 위조: 웹 포트 비공개와 정확한 프록시 주소만 신뢰.
- 세션 공유: 웹 로그인 쿠키로 Ratchet 구독, 로그아웃 후 접속 종료.
- 큰 프레임·분할·느린 전송: 라이브러리 버퍼 상한과 수신 마감 검사.
- DB 장애·재생성: Ratchet 재시작, 데이터 볼륨 보존, 별도 복원 절차.

---
## 작업 1: HTTPS·WSS 주소와 운영 설정

파일: frontend/realtime.mjs, backend/includes/deployment.php, router.php, tests/lan-realtime.test.mjs, tests/deployment.test.mjs.

인터페이스: realtimeUrlForLocation(location) 유지. deployment_public_origin(): ?string, realtime_configuration(): array 추가.

- [ ] HTTPS 도메인·포트·IPv6, 공개 HTTP 거절과 잘못된 출처 설정 테스트 추가.
- [ ] 기존 구현에서 실패 확인.
- [ ] 같은 출처 WSS, 명시적 운영 CSP, 컨테이너 전용 수신 설정 구현.
- [ ] 관련 Node·실제 PHP 테스트 통과 확인.

---
## 작업 2: 실시간 수신 보호와 장애 복구

파일: backend/realtime/BoundedWsServer.php, backend/realtime/server.php, backend/realtime/MessageRelay.php, tests/realtime-limits.test.mjs.

인터페이스: BoundedWsServer extends WsServer. 프레임·메시지 각각 1,024바이트, 미완성 수신 10초 제한. DB 감시 실패 시 프로세스 실패 종료.

- [ ] 실제 RFC6455 버퍼의 큰 프레임·분할 메시지 거절 테스트 작성·실패 확인.
- [ ] 기존 Ratchet 연결 맥락의 버퍼를 제한형 버퍼로 교체하고 수신 마감 검사 추가.
- [ ] 세션·소속 검사와 메시지 본문 비전송 계약 유지.
- [ ] 실시간 테스트와 PHP 구문 확인.

---
## 작업 3: Compose·운영 진입점·컨테이너 검증

파일: compose.yaml, .dockerignore, .env.example, docker/*, tests/docker-flow.test.mjs, .github/workflows/docker.yml.

인터페이스: APP_DOMAIN, APP_PUBLIC_ORIGIN, MYSQL_DATABASE, MYSQL_USER, MYSQL_PASSWORD, MYSQL_ROOT_PASSWORD, AUTH_RATE_LIMIT_KEY. 호스트는 프록시 80·443만 공개.

- [ ] 실제 컨테이너에서 가입·로그인·CSRF·권한·공유 세션·알림·첨부·비공개 경로를 검사하는 테스트 작성.
- [ ] PHP 이미지, Apache 단일 진입점·신뢰 프록시, Caddy HTTPS/WSS, MySQL과 세션 볼륨 구성.
- [ ] 자동 스키마 적용 없이 별도 DB 준비·백업·복원 절차 제공.
- [ ] Docker 없는 로컬에서는 관련 검증을 미실행으로 표시. GitHub Actions에 Compose 빌드·런타임 검증 구성.

---
## 작업 4: 문서·주소 출력·최종 검증과 반영

파일: scripts/show-public-url.php, docs/NAS-DEPLOYMENT.md, docs/PHASE-12-VERIFICATION.md, README.md, docs/REALTIME.md, docs/INDEX.md.

- [ ] 설정한 웹 링크와 진단용 WSS 주소 출력 도구 추가·오입력 검사.
- [ ] NAS 확인 항목·네트워크 분기·백업/복원·실제 외부망 인수 절차 작성.
- [ ] 가능한 기존 전체 테스트 실행, 비밀 값·diff 검사, 독립 코드 검토와 주요 수정.
- [ ] 검증 결과를 담은 한국어 커밋으로 main 반영, 원격 커밋과 CI 상태 확인.

---
## 실행 기록

- 결정: 사용자가 승인한 main 작업을 유지하며 반복 승인 없이 직접 실행.
- 장비 확보·실제 DB 이관·도메인 설정·외부 접속은 현재 실행 대상에서 제외하고 미검증으로 기록.
- 작업 1·2 구현과 회귀 검사 완료. 독립 검토의 빈 분할 프레임 누적 문제를 실패 검사 후 64프레임 상한으로 보완.
- 작업 3의 공통 구성과 실제 TLS CI 구현 완료. 로컬 Docker 부재로 CI 실행 결과는 main 반영 후 확인.
- 로컬 전체 회귀: 237개 중236통과·실패0·컨테이너1개 건너뜀. PHP69개·JS50개 문법 검사 통과.
