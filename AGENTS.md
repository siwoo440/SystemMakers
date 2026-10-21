---
# SystemMakers 작업 규칙

- PHP·MySQL 백엔드 중심 개발, 별도 프레임워크 임의 도입 금지.
- 코드 블록은 Allman 스타일, 각 코드 줄에 짧은 한국어 명사형 주석 적용. 중괄호만 있는 줄의 주석은 생략 가능.
- 모든 커밋 제목은 한국어로 작성하고 추가·수정·제거 등 실제 작업을 나타내는 명사형으로 마무리.
- 커밋 본문은 실제 변경 사항과 검증 결과를 한국어 목록으로 작성. 실행하지 않은 테스트의 성공 주장 금지.
- SystemMakers 저장소와 codex/backend-auth-messages 브랜치에서 작업. 상위 HomePage 저장소의 원격·이력 변경 금지.
- DB 자격 증명·개인 설정·검증용 도구·DB 파일은 Git에 추가하지 않음.
- 공개 웹 경로는 frontend와 명시한 API뿐이며 config·includes·sql·.runtime·.git 노출 금지.
