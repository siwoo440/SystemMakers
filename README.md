---
# SystemMakers

Discord 스타일 웹 채팅 프로젝트. HTML·CSS·JavaScript 프론트엔드와 PHP·MySQL 백엔드를 사용한다.

현재 단계는 회원가입·로그인·채널별 메시지 저장 및 조회를 위한 API·DB 계약 설계다. 실행 가능한 API, 화면, 데이터베이스는 아직 구현하지 않았다.

팀원 A는 프론트엔드, 팀원 B는 DB·인증·메시지 API, 팀원 C는 서버·채널·프로필 관리 기능을 담당한다. 프론트엔드는 백엔드 연동 확인에 필요한 최소 화면부터 구성한다.

---
## 공유 문서

- [API 명세 초안](docs/API.md): 요청·응답, 세션·CSRF, 오류 코드와 메시지 폴링
- [DB 구조 초안](docs/DATABASE.md): 테이블·인덱스·외래 키·삭제·트랜잭션 규칙
- [개발 방향](docs/DEVELOPMENT-DIRECTION.md): 역할 분담, 범위와 구현 순서

---
## 현재 진행 상태

구현 순서 1의 문서 초안을 작성한 상태다. PHP API·schema.sql·최소 프론트는 후속 단계이며 API 및 DB 실행 테스트는 아직 수행하지 않았다.

작업 저장소는 [siwoo440/SystemMakers](https://github.com/siwoo440/SystemMakers), 팀원 B의 작업 브랜치는 codex/backend-auth-messages다. 공통 필드·응답 형식·삭제 정책을 바꾸면 API.md와 DATABASE.md를 같은 변경에서 갱신한다.
