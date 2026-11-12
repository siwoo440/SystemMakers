---
# 로컬 실행과 검사 방법

이 문서는 로컬 개발·검사 환경의 준비 방법이다. PHP 내장 개발 서버는 운영용 배포 서버가 아니다.

---
## 1. 실행 환경

- PHP 8.3과 `pdo_mysql`·`mbstring`·`gd` 확장, MySQL 8.4, Node.js가 필요하다. GD가 없으면 프로필 사진 저장은 503이다.
- 웹 서버는 최대 5 MiB 첨부를 위해 `upload_max_filesize=6M`, `post_max_size=7M`을 적용한다. MySQL `max_allowed_packet`도 파일과 SQL 오버헤드를 수용하도록 설정한다.
- 개인 PHP·MySQL 도구와 DB, `.runtime/web-env.json`은 Git에 포함되지 않는다. 다른 컴퓨터에서는 따로 준비한다.
- `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_DATABASE`, `MYSQL_USER`, `MYSQL_PASSWORD`를 명시한다. 실제 접속 값은 Git이나 공유 문서에 적지 않는다.
- `MYSQL_HOST`는 웹 서버 주소와 별개이며 실제 MySQL 서비스의 주소에 따라 `127.0.0.1` 또는 `localhost` 등을 사용한다. 코드는 `MYSQL_PASSWORD`의 빈 값을 허용하지만 실제 접속 가능 여부는 MySQL 계정 설정에 달려 있다.
- `AUTH_RATE_LIMIT_KEY`에는 암호학적 난수로 만든 32바이트 이상의 비밀 값을 지정하고 여러 서버 실행에서 안정적으로 유지한다. 누락되거나 짧으면 로그인은 실패한다.
- 로컬 HTTP에서는 `APP_ENV=development`와 `SESSION_COOKIE_SECURE=0`을 명시한다. 운영 환경에서는 HTTPS와 기본 Secure 쿠키를 사용한다.

---
## 2. 데이터베이스 구조 적용

- 새로운 DB는 `backend/sql/schema.sql`을 적용한 뒤 001 변경을 적용하고 아래 002~005 도구를 순서대로 실행한다.
- 기존 DB는 먼저 백업한 뒤 변경 전용 계정과 명시적인 MYSQL_* 환경 변수를 설정하고 아래 도구를 실행한다.
- 변경 도구는 개인 웹 설정을 자동으로 불러오거나 DB 권한을 올리지 않는다. 기존 구조·이름 충돌과 부분 적용을 확인하며, 완료 시 변경 파일 해시를 출력한다.
- MySQL DDL의 파일 전체 자동 롤백은 보장되지 않는다. 실패하면 실제 적용 상태를 확인한다.

```powershell
.\scripts\migrate.ps1 # 명시된 환경 변수의 기존 DB 변경
.\.runtime\php83\php.exe -c .runtime/php83.ini scripts/migrate-002.php # 개인 대화와 차단 구조 추가
.\.runtime\php83\php.exe -c .runtime/php83.ini scripts/migrate-003.php # 프로필 구조 추가
.\.runtime\php83\php.exe -c .runtime/php83.ini scripts/migrate-004.php # 첨부 파일 구조 추가
.\.runtime\php83\php.exe -c .runtime/php83.ini scripts/migrate-005.php # 친구 요청과 수락 구조 추가
```

---
## 3. 로컬 웹 서버 실행

- 저장소 전체를 웹 서버의 `htdocs/Team006/`에 배치하고 해당 프로젝트 루트에서 아래 명령을 실행한다. 이 경로에 복사하지 않은 기존 작업 폴더에서도 같은 PHP 라우터로 개발 주소를 실행할 수 있다.
- 기본 주소는 `http://127.0.0.6:8088/Team006/index.html`이다. PHP 내장 서버가 `/Team006/` 요청을 프로젝트의 화면과 허용된 API에 연결한다.
- `start-dev.ps1`은 개인 `.runtime/web-env.json`이 있으면 현재 프로세스 환경에 읽는다.
- 다른 PHP 실행 파일은 `-PhpPath`, 로컬 IPv4 주소는 `-WebHost`, 포트는 `-Port`로 지정한다. 지정한 주소와 포트의 사용 여부를 확인하고 PHP 서버에도 같은 값을 사용한다.
- `router.php`를 사용하는 PHP 내장 서버는 공개 화면과 API 허용 경로만 연결한다. Apache/XAMPP에서 프로젝트를 직접 제공하면 이 라우터가 자동으로 적용되지 않으므로 별도의 경로 연결과 비공개 설정·SQL·실행 파일 접근 차단 구성이 필요하다.

```powershell
.\scripts\start-dev.ps1 # 현재 로컬 설정으로 웹 서버 시작
.\scripts\start-dev.ps1 -WebHost '127.0.0.6' -Port 8088 # 웹 주소와 포트 명시
```

---
## 같은 Wi-Fi에서 개발용으로 공유

- 서버 컴퓨터의 Wi-Fi 사설 IPv4 주소는 `ipconfig`에서 확인한다. 아래 주소는 예시이며 네트워크 변경 시 다시 확인한다.
- MySQL은 서버 컴퓨터의 로컬 주소에 두고, 기존 DB를 백업한 뒤 001~005 적용 상태를 확인한다.
- PowerShell 7 터미널 두 개를 열어 각각 아래 명령을 실행한다. 두 서버와 MySQL이 켜져 있어야 한다.

```powershell
.\scripts\start-dev.ps1 -WebHost '10.0.10.58' -AllowLan # 웹 서버 실행
.\scripts\start-realtime.ps1 -RealtimeHost '10.0.10.58' -AllowLan # 실시간 서버 실행
```

- 같은 Wi-Fi의 다른 기기에서 `http://10.0.10.58:8088/Team006/index.html`에 접속한다. 웹과 실시간 서버에 같은 IP를 사용한다.
- Windows 방화벽의 TCP 8088·8090 허용 여부와 Wi-Fi의 기기 간 차단 설정에 따라 다른 기기 접속이 제한될 수 있다.
- 개발용 HTTP와 WebSocket은 암호화되지 않으므로 신뢰하는 네트워크와 테스트 계정으로만 사용한다. 인터넷 공개에는 HTTPS·WSS 등 별도 구성이 필요하다.

---
## 같은 Wi-Fi 개발 서버 자동 실행

- Windows에서 `scripts/install-lan-autostart.ps1`을 한 번 실행하면 현재 사용자의 로그인 시 `SystemMakers-LAN` 작업이 감시기를 실행한다. 같은 이름의 작업은 덮어쓰지 않는다.
- 감시기는 연결된 Wi-Fi의 사설 IPv4를 확인하고 15초 간격으로 로컬 DB·웹·실시간 서버의 수신 상태를 살핀다. 서버가 없을 때 기존 설정으로 시작하며, 이전 주소에서 감시기가 직접 실행한 서버만 정리한다.
- 기존 로컬 MySQL 자료 폴더가 있을 때만 DB를 시작하며 초기화·마이그레이션은 수행하지 않는다. 다른 프로그램이 같은 주소와 포트를 사용하면 종료하지 않으므로 충돌을 직접 확인한다.
- 현재 주소는 PowerShell 7에서 `scripts/show-lan-url.ps1`을 실행해 확인한다. `.runtime/lan-status.json`은 개인 상태 기록이며 Git에 포함하지 않는다.
- 컴퓨터가 켜져 있고 사용자가 로그인한 상태에서만 동작한다. 종료·절전 중에는 접속할 수 없다. Wi-Fi IP가 바뀌면 새 주소로 다시 접속해야 하며, 고정 주소가 필요하면 네트워크 관리자에게 DHCP 주소 예약을 확인한다.
- 예약 작업 제거는 Windows 작업 스케줄러에서 `SystemMakers-LAN`을 선택해 삭제한다. DB 데이터는 삭제되지 않는다.

---
## 4. 개발용 채널 준비

- 회원가입만으로 서버 소속이 생기지 않는다. 웹에서 서버를 만들거나 초대 코드로 참여할 수 있다.
- 별도 개발 데이터를 준비할 때는 이미 가입한 사용자명을 지정한다. 아래 이름은 실제 사용자명으로 바꾼다.
- 도구는 `development` 또는 `test` 환경의 CLI에서만 동작하고 기존 계정·대화·채널과 관리자 역할을 보존한다.

```powershell
.\scripts\seed-dev.ps1 -OwnerUsername 'my_user' # 기존 계정의 개발 서버와 채널 준비
.\scripts\seed-dev.ps1 -OwnerUsername 'my_user' -Members 'other_user' # 기존 계정을 개발 서버에 추가
```

---
## 5. 전체 자동 검사

- 실제 PHP와 별도의 로컬 MySQL 검사 인스턴스가 필요하다. 프로젝트 검사 코드는 테스트 포트 `33361`과 무작위 테스트 DB 이름을 사용한다.
- `PHP_TEST_BIN`, `MYSQL_TEST_CLIENT`, `MYSQL_TEST_PORT=33361`을 지정한다. 공개 웹 라우터 검사에는 위 MYSQL_*·APP_ENV·SESSION_COOKIE_SECURE 설정도 필요하다.
- 테스트 인스턴스는 로컬 root·빈 비밀번호 기준이며 검사마다 전용 DB를 만들고 해당 DB만 정리한다. 개발 DB `33360`과 분리한다.
- `PHP_TEST_INI`로 PHP 8.3용 설정 파일을 지정하며, `pdo_mysql`, `mbstring`, `gd`와 세션 저장 위치를 설정한다.
- 11단계의 검증 환경과 범위는 [11단계 결과](PHASE-11-VERIFICATION.md), 최신 변수명 정리 기준은 [변수명 안내](VARIABLE-NAMING.md)를 따른다.

```powershell
node --test # 전체 자동 검사
node --test tests/integration-flow.test.mjs # 가입부터 대화와 삭제까지 확인
node --check frontend/app.js # 웹 화면 스크립트 문법 확인
```

실시간 서버의 별도 실행과 Composer 설치는 [실시간 연결](REALTIME.md)을 따른다.
