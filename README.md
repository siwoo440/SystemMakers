---

# SystemMakers

SystemMakers는 서버·채널과 1:1 개인 대화에서 메시지와 파일을 주고받는 웹 프로젝트입니다.

- **서버**: 여러 채널을 묶는 팀이나 모임의 공간입니다.
- **채널**: 서버에 속한 각각의 채팅방이며 메시지는 채널별로 구분됩니다.
- **사용 흐름**: 회원가입 → 로그인 → 서버 만들기 또는 초대받기 → 채널 선택 → 대화

초대 코드로 서버에 참여하면 그 서버에 속한 채널 목록과 기존 대화를 조회할 수 있습니다. 다른 서버의 대화는 보이지 않습니다. 서버 이름 배너와 테두리는 그 아래 채널이 같은 서버에 속한다는 뜻입니다. 다른 사용자가 새로 만든 채널은 목록 다시 확인을 누르거나 화면으로 돌아올 때 갱신됩니다.

작은 화면에서 목록을 열면 서버·채널은 왼쪽, 친구는 오른쪽에 나타나며, 가운데 배경을 눌러 목록을 닫을 수 있습니다.

화면은 HTML·CSS·JavaScript, 서버는 PHP·MySQL을 사용하며 실시간 알림에는 Ratchet WebSocket을 사용합니다.

- **메시지 확인**: 실시간 연결 중에는 알림을 즉시 처리하고 HTTP 안전망은 15초 간격으로 확인합니다. 연결이 끊기면 2초 간격 조회로 복구합니다.

새 메시지가 없는 동안에는 채널과 개인 대화의 말풍선과 읽던 위치를 유지합니다. 페이지를 다시 열 때 브라우저는 공개 HTML·CSS·JavaScript의 버전을 확인하고, 같은 파일은 저장한 사본을 사용합니다.

- **화면 디자인**: `#262B3F` 배경과 광택을 더한 보라색 버튼·말풍선을 사용합니다. 본인 메시지는 오른쪽, 상대방 메시지는 왼쪽에 표시합니다.

- **같은 Wi-Fi에서 접속** — 서버 PC의 PowerShell에서 `./scripts/show-lan-url.ps1`을 실행해 표시되는 웹 주소를 엽니다. Wi-Fi가 바뀌면 이 주소도 바뀔 수 있습니다.
- **서버 PC에서 접속** — 기본 설정으로 실행한 Windows PC에서 [로컬 채팅 열기](http://127.0.0.6:8088/Team006/index.html)
- **다른 네트워크에서 접속** — Docker의 HTTPS 웹과 WSS 채팅 연결은 AMD64·ARM64 자동 검사를 통과했습니다. 실제 NAS 도메인과 공인 인증서는 아직 확인되지 않아 공유할 외부 주소는 없습니다. [NAS 배포 안내](docs/NAS-DEPLOYMENT.md)
- **화면 자료** — 2026년 11월 19일 Chrome에서 예시 계정으로 촬영했습니다. 데스크톱 화면 15장과 390 × 844 크기의 모바일 배치 1장을 담았습니다.
- [화면 이미지 16장 내려받기](docs/assets/ui/systemmakers-ui-screenshots.zip?raw=true) · [화면별 설계와 수정 파일 보기](docs/UI-DIRECTION.md)


---

## 화면 살펴보기

<details>
<summary>비로그인·로그인·회원가입</summary>

- 비로그인 상태

![비로그인 메인 화면](docs/assets/ui/current-guest.jpg)

- 로그인

![로그인 화면](docs/assets/ui/current-login.jpg)

- 회원가입

![회원가입 화면](docs/assets/ui/current-register.jpg)

</details>

<details>
<summary>채널·개인 대화·친구</summary>

- 왼쪽 배너의 ‘졸업 전시 준비팀’ 아래에 일반·디자인·공지 채널이 묶입니다. 가운데는 선택한 채널의 대화, 오른쪽은 친구 요청과 목록입니다.

![채널 대화와 친구 목록 화면](docs/assets/ui/current-channel.jpg)

- 개인 대화와 파일 선택 영역

![개인 대화 화면](docs/assets/ui/current-direct.jpg)

- 파일 선택과 전송 전 선택 취소

![파일 선택 및 취소 화면](docs/assets/ui/current-attachment.jpg)

</details>

<details>
<summary>서버·초대 관리</summary>

- 서버 만들기

![서버 만들기 화면](docs/assets/ui/current-server-create.jpg)

- 초대 코드로 참여

![초대 참여 화면](docs/assets/ui/current-server-join.jpg)

- 초대 관리

![초대 관리 화면](docs/assets/ui/current-invite.jpg)

- 서버 삭제 확인

![서버 삭제 확인 화면](docs/assets/ui/current-server-delete.jpg)

</details>

<details>
<summary>채널 관리</summary>

- 채널 만들기

![채널 만들기 화면](docs/assets/ui/current-channel-create.jpg)

- 채널 이름 변경

![채널 이름 변경 화면](docs/assets/ui/current-channel-rename.jpg)

- 채널 삭제 확인

![채널 삭제 확인 화면](docs/assets/ui/current-channel-delete.jpg)

</details>

<details>
<summary>프로필·상태·사진·차단 관리</summary>

- 내 프로필

![내 프로필 화면](docs/assets/ui/current-profile.jpg)

- 사진과 사용자 차단 관리

![프로필 세부 설정 화면](docs/assets/ui/current-profile-settings.jpg)

</details>


<details>
<summary>좁은 화면에서 탐색하기</summary>

- 대화 상단에서 목록을 열면 서버와 채널은 왼쪽, 친구는 오른쪽에 표시됩니다. 가운데 남은 배경을 누르면 대화로 돌아갑니다.

![390 × 844 화면에서 좌우 패널을 연 모습](docs/assets/ui/current-mobile-panels.jpg)

</details>

---

## 주요 기능


---

### 계정과 로그인

- **회원가입**: 사용자명·이메일·비밀번호로 계정을 만듭니다. 사용자명은 한글·영문·숫자·밑줄 2~32자를 지원합니다. 비밀번호는 8~64자로 입력하며 문자 종류의 조합 제한은 없습니다. 사용자명과 이메일의 중복을 확인합니다.
  <br>관련 코드·문서: [회원가입](backend/api/register.php) · [계정 검증](backend/includes/accounts.php) · [API 명세](docs/API.md)

- **로그인·로그아웃**: 이메일과 비밀번호로 로그인하고 사용을 마치면 로그아웃합니다. 가입 후에는 별도로 로그인해야 합니다.
  <br>관련 코드·문서: [로그인](backend/api/login.php) · [로그아웃](backend/api/logout.php) · [API 명세](docs/API.md)

- **로그인 상태 확인**: 페이지를 새로고침하면 유효한 로그인 상태를 확인합니다.
  <br>관련 코드·문서: [현재 사용자 조회](backend/api/get_current_user.php) · [화면 처리](frontend/app.js)

- **로그인 시도 제한**: 이메일과 IP별로 지나치게 많은 로그인 시도를 제한합니다. 비밀번호는 해시로 저장합니다.
  <br>관련 코드·문서: [로그인 제한](backend/includes/login_rate_limit.php) · [API 명세](docs/API.md)



---

### 서버와 초대

- **서버 생성**: 팀 공간을 만듭니다. 생성자는 소유자가 되고 기본 채널이 함께 만들어집니다.
  <br>관련 코드·문서: [서버 생성](backend/api/create_server.php) · [서버 관리](backend/includes/server_management.php)

- **서버 목록·선택**: 내가 참여 중인 서버를 확인하고 선택합니다.
  <br>관련 코드·문서: [서버 목록](backend/api/list_servers.php) · [화면 상태](frontend/server-manager.mjs)

- **초대 발급·폐기**: 소유자가 초대 코드를 발급·복사·재발급·폐기합니다. 코드는 발급 후 24시간 유효합니다.
  <br>관련 코드·문서: [초대 발급](backend/api/create_server_invite.php) · [초대 폐기](backend/api/revoke_server_invite.php) · [API 명세](docs/API.md)

- **초대 참여·탈퇴**: 초대 코드로 서버에 참여합니다. 소유자가 아닌 회원은 탈퇴할 수 있으며, 작성한 대화는 남습니다.
  <br>관련 코드·문서: [서버 참여](backend/api/join_server.php) · [서버 탈퇴](backend/api/leave_server.php)

- **초대 링크**: 발급한 초대 링크를 복사하고 상대방은 참여 여부를 직접 확인합니다.
  <br>관련 코드·문서: [초대 화면](frontend/server-ui.mjs)

- **서버 삭제**: 소유자가 대상과 삭제 영향을 확인한 뒤 네·아니오로 선택합니다. 소속·채널·대화도 함께 삭제됩니다.
  <br>관련 코드·문서: [삭제 미리보기](backend/api/get_deletion_preview.php) · [서버 삭제](backend/api/delete_server.php)


초대 관리 창의 **새 코드 발급 및 이전 코드 무효화** 버튼을 누르면 이전 코드가 무효화되고 새 코드가 발급됩니다. 코드와 링크는 각 입력칸 옆 버튼으로 복사할 수 있습니다.


---

### 채널

- **채널 조회**: 참여한 서버의 주제별 채널을 확인하고 대화할 채널을 선택합니다.
  <br>관련 코드·문서: [채널 목록](backend/api/get_channels.php) · [채널 화면](frontend/channel-ui.mjs)

- **채널 생성·이름 변경**: 소유자와 관리자가 채널을 만들고 이름을 바꿉니다. 이름을 변경해도 기존 대화는 유지됩니다.
  <br>관련 코드·문서: [채널 생성](backend/api/create_channel.php) · [이름 변경](backend/api/update_channel.php)

- **채널 삭제**: 소유자와 관리자가 삭제 대상과 메시지 수를 확인한 뒤 네·아니오로 선택합니다.
  <br>관련 코드·문서: [삭제 미리보기](backend/api/get_deletion_preview.php) · [채널 삭제](backend/api/delete_channel.php)

- **역할별 접근**: 일반 회원은 소속 채널에서 대화하고, 소유자와 관리자는 채널을 관리합니다.
  <br>관련 코드·문서: [채널 관리](backend/includes/channel_management.php) · [역할 규칙](docs/PHASE-7-RULES.md)


서버·채널 관리 버튼은 벡터 아이콘으로 표시합니다. 마우스를 올리거나 키보드로 선택하면 기능 이름이 나타납니다.

왼쪽의 서버·채널·개인 대화 목록은 스크롤할 수 있고 서비스 제목과 사용자 정보는 각각 상단과 하단에 고정됩니다. 수락된 친구는 오른쪽 목록에 표시됩니다.

개인 대화와 친구 검색은 돋보기 버튼을 사용하며 마우스와 키보드로 버튼 설명을 확인할 수 있습니다.

---

### 메시지와 대화

- **텍스트 메시지**: 한글·이모지·줄바꿈을 포함해 최대 2,000자까지 전송하고 대화를 저장합니다.
  <br>관련 코드·문서: [메시지 전송](backend/api/send_message.php) · [메시지 처리](backend/includes/messages.php)

- **입력과 전송**: Enter로 메시지를 전송하고 Shift+Enter로 줄을 바꿉니다.
  <br>관련 코드·문서: [화면](index.html) · [입력 처리](frontend/app.js)

- **최근·이전 대화**: 채널의 최근 대화 50개를 불러오고 이전 대화를 추가로 조회합니다.
  <br>관련 코드·문서: [메시지 조회](backend/api/get_messages.php) · [조회 처리](backend/includes/message_history.php)

- **새 메시지 확인**: WebSocket 알림을 받으면 새 메시지를 조회하고, HTTP 주기 조회로 누락을 복구합니다.
  <br>관련 코드·문서: [대화 갱신](frontend/message-feed.mjs) · [API 명세](docs/API.md)

- **1:1 개인 대화**: 사용자명을 검색해 개인 대화를 시작하고 이전 기록을 조회합니다.
  <br>관련 코드·문서: [개인 대화](frontend/direct-ui.mjs) · [대화 처리](backend/includes/direct_messages.php)

- **친구 요청과 목록**: 친구 요청을 상대방이 수락하면 오른쪽 패널의 양쪽 친구 목록에 표시하고 대화를 열 수 있습니다.
  <br>관련 코드·문서: [친구 API](backend/api/friends.php) · [친구 화면](frontend/friends-ui.mjs)

받은 요청·보낸 요청·친구 목록은 각각 테두리로 구분하며, 항목이 없어도 빈 영역을 표시합니다.

- **파일 전송**: 채널과 개인 대화에서 최대 약 5.24 MB(5,242,880바이트) 파일을 MySQL에 저장하고 권한 확인 후 다운로드합니다.
  <br>관련 코드·문서: [첨부 저장](backend/api/upload_attachment.php) · [다운로드](backend/api/download_attachment.php)

- **읽는 위치·초안**: 이전 대화를 읽던 위치를 유지하고 채널 이동 시 현재 탭에 작성 중인 내용을 보관합니다.
  <br>관련 코드·문서: [화면 상태](frontend/app.js) · [개발 방향](docs/DEVELOPMENT-DIRECTION.md)

- **오류·재조회**: 대화 조회에 실패하면 다시 연결할 수 있습니다. 전송 결과를 받지 못했을 때 같은 요청을 자동으로 반복하지 않습니다.
  <br>관련 코드·문서: [화면 처리](frontend/app.js) · [대화 갱신](frontend/message-feed.mjs)


새 메시지는 **WebSocket 알림과 HTTP 조회**로 확인합니다. 알림 연결이 끊겨도 HTTP 주기 조회가 유지되며, 네트워크 상태나 브라우저 제한에 따라 반영이 늦어질 수 있습니다. 초안은 현재 탭의 메모리에 보관하므로 새로고침 후 복원되지 않습니다.

파일 선택과 전송 버튼은 채널과 개인 대화의 입력창 왼쪽에 있습니다. 파일을 선택하면 이름과 `×` 버튼이 나타나며, `×`를 누르면 전송 전 선택만 취소됩니다.


---

### 프로필과 접근 보호

- **내 프로필**: 본인의 사용자명·이메일·가입일을 확인하고 사용자명을 변경합니다. 기존 대화와 서버 소속은 유지됩니다.
  <br>관련 코드·문서: [프로필 API](backend/api/profile.php) · [프로필 화면](frontend/profile-ui.mjs)

프로필을 열면 상태·사진·차단 목록을 자동으로 불러옵니다. 사용자명과 상태·사진은 각 저장 버튼을 눌러야 반영되며, 저장하지 않고 창을 닫으면 입력한 내용은 버려집니다. 프로필과 로그인·로그아웃 버튼은 아이콘으로 표시하고 버튼 설명은 마우스를 올리면 확인할 수 있습니다.

- **사진·상태 메시지**: 내 상태와 PNG·JPEG 사진을 저장합니다. 사진 처리는 PHP GD 확장이 필요합니다.
  <br>관련 코드·문서: [프로필 상태](backend/api/profile_details.php) · [사진](backend/api/profile_picture.php)

- **사용자 차단**: 한쪽이 차단하면 개인 대화의 양쪽 신규 전송이 중단되고 이전 기록은 유지됩니다.
  <br>관련 코드·문서: [사용자 차단](backend/api/user_blocks.php)

- **접근 권한 확인**: 서버 소속과 관리 권한을 확인해 권한 없는 조회·전송·관리를 차단합니다.
  <br>관련 코드·문서: [대화 조회 권한](backend/includes/message_history.php) · [관리 요청](backend/includes/management_endpoint.php)

- **계정과 요청 보호**: 세션과 CSRF 토큰을 확인하고 다른 탭에서 계정이 바뀌었을 때 잘못된 계정으로 요청하는 일을 방지합니다.
  <br>관련 코드·문서: [세션](backend/includes/session.php) · [CSRF](backend/includes/csrf.php) · [API 명세](docs/API.md)

- **접근 종료 시 정리**: 서버 탈퇴나 채널 삭제가 확인되면 해당 대화·초안·선택 화면을 정리합니다.
  <br>관련 코드·문서: [화면 처리](frontend/app.js) · [검증 결과](docs/PHASE-11-VERIFICATION.md)


인증·서버·채널·프로필 창은 창 바깥을 클릭해 닫을 수 있습니다. 상태 메시지·사진·차단 설정은 각각의 카드에서 관리하며, 저장 결과와 오류도 해당 카드에 표시됩니다. 저장 중에는 결과 확인을 위해 닫기가 잠시 제한됩니다.


---

## 현재 제공하지 않는 기능

- **실제 NAS 외부 접속**: Docker·HTTPS·WSS 공통 구성을 제공하며 실제 NAS·공유기·도메인과 외부망 검증은 남아 있습니다.

- **음성**: 음성 채팅은 제공하지 않습니다.

- **메시지 관리**: 개별 메시지 수정·삭제는 제공하지 않습니다.

- **서버·권한 확장**: 서버 이름 변경, 비공개 채널, 역할 편집, 강퇴, 소유권 이전은 현재 범위 밖입니다.

- **계정 확장**: 이메일·비밀번호 변경, 회원 탈퇴는 제공하지 않습니다.



---

## 로컬 실행

PHP 8.3, MySQL 8.4, Node.js, Composer와 개인 DB 설정이 필요합니다. PHP의 `pdo_mysql`·`mbstring`·`gd` 확장과 DB 초기 설정 방법은 [로컬 실행과 검사](docs/LOCAL-SETUP.md)를 참고하세요.

프로젝트를 `htdocs/Team006/`에 배치하고 저장소 루트에서 다음 명령을 실행합니다.

```powershell
.\scripts\start-dev.ps1 # 로컬 웹 서버 시작
.\scripts\start-realtime.ps1 # 별도 터미널의 실시간 서버 시작
```

기본 설정으로 실행한 PC에서 [채팅 화면](http://127.0.0.6:8088/Team006/index.html)을 엽니다.

- 웹 주소는 `-WebHost`, 포트는 `-Port`로 지정합니다. MySQL 주소는 별도의 `MYSQL_HOST` 설정을 사용합니다.
- 자동 검사와 스크린샷 촬영에 표시되는 임시 `127.0.0.1` 주소는 격리된 테스트 서버이며, 위 서비스 접속 주소와 다릅니다.
- 위 명령은 PHP 라우터로 공개 경로를 제한합니다. Apache에서 직접 제공하려면 별도의 접근 제한과 경로 설정이 필요합니다.
- 스키마 적용, 개인 설정, 개발 데이터와 테스트 방법은 [로컬 실행과 검사](docs/LOCAL-SETUP.md)에 정리했습니다.
- 같은 Wi-Fi의 개발 서버 자동 실행과 현재 접속 주소 확인 방법도 [로컬 실행과 검사](docs/LOCAL-SETUP.md)에 정리했습니다. 로그인한 컴퓨터가 켜져 있어야 하며 Wi-Fi IP 변경 시 접속 주소가 바뀝니다.


---

## 팀 역할

- `신**`: WebSocket·Ratchet과 JavaScript

- `제**`: PHP 백엔드·MySQL·회원 인증·메시지와 파일 API

- `황**`: 로그인과 채팅 화면 등 웹사이트 디자인



---

## 현재 상태

- 개인 대화·첨부 파일·프로필·차단·초대 링크·친구 요청을 제공합니다. 기존 DB의 적용 상태를 확인하고 002~005 마이그레이션을 순서대로 적용해야 합니다.
- 실제 휴대폰·Safari·Firefox와 운영 환경 검증은 남아 있습니다.
- `c7b8b39`에서 두 CPU 구조 모두 HTTPS 로그인, WSS 알림, 공유 세션, DB 재시작과 별도 볼륨 복원을 확인했습니다. 로컬 전체 검사 결과는 239개 통과, Docker 전용 1개 건너뜀입니다. [컨테이너 검사 결과](https://github.com/siwoo440/SystemMakers/actions/runs/44439685411)
- 배포 대상은 UGREEN DH4300 Plus입니다. 소유자의 설치 권한·공유기·도메인을 확인한 뒤 DB 이관과 이동통신망 검사를 진행합니다. 화면과 DB 조회의 추가 최적화 후보도 [남은 작업](docs/DEVELOPMENT-DIRECTION.md)에 모았습니다.


---

## 문서

- [남은 작업과 완료 기준](docs/DEVELOPMENT-DIRECTION.md) · [실시간 연결](docs/REALTIME.md) · [API 명세](docs/API.md) · [DB 구조](docs/DATABASE.md)
- [NAS Docker 배포와 접속 링크 출력](docs/NAS-DEPLOYMENT.md)
- [12단계 AMD64·ARM64 컨테이너 검증 결과](docs/PHASE-12-VERIFICATION.md)
- [변수명 작성과 호환성](docs/VARIABLE-NAMING.md) · [로컬 실행과 검사](docs/LOCAL-SETUP.md)
- [개인 대화·파일·프로필 검증](docs/PHASE-1-6-VERIFICATION.md) · [11단계 검증 결과](docs/PHASE-11-VERIFICATION.md) · [전체 문서 목록](docs/INDEX.md)
