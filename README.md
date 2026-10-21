---
# SystemMakers

Discord 스타일 웹 채팅 프로젝트. HTML·CSS·JavaScript 프론트엔드와 PHP·MySQL 백엔드를 사용한다.

현재는 MySQL 초기 스키마와 통합 테스트를 구현하고 채팅·회원 인증 UI 시안 이미지를 제작한 상태다. PHP API와 실제 프론트엔드 화면은 아직 구현하지 않았다.

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

---
## 현재 진행 상태

DB 구현 1단계를 완료했다. schema.sql은 빈 DB에 한 번 적용하며 DB 생성·삭제나 기존 데이터 초기화를 포함하지 않는다. 테스트는 임의 이름의 전용 DB에서 실행한다. 실행 방법은 스키마 검증 문서를 따른다. 다음 단계는 PHP DB 연결과 공통 인증·응답 처리다.

작업 저장소는 [siwoo440/SystemMakers](https://github.com/siwoo440/SystemMakers), 팀원 B의 작업 브랜치는 codex/backend-auth-messages다. 공통 필드·응답 형식·삭제 정책을 바꾸면 API.md와 DATABASE.md를 같은 변경에서 갱신한다.
