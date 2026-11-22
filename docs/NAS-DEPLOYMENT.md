---
# NAS Docker 실행과 외부 접속

**공통 배포 구성을 제공한다. 실제 NAS·공유기·도메인과 외부 접속은 아직 검증하지 않았다.** NAS도 컴퓨터이며 Docker는 PHP·MySQL·Ratchet 실행 환경을 컨테이너로 구성하는 도구다. 포트포워딩은 외부 요청을 NAS로 전달하는 공유기 설정이다.

---
## 1. 장비와 인터넷부터 확인

| 확인 항목 | 확인 방법과 판단 |
| --- | --- |
| NAS 모델·운영체제 | 본체 라벨과 관리 화면의 시스템 정보 확인 |
| CPU·메모리·공간 | 64비트 CPU 구조와 이미지 지원, 가용 메모리·DB·첨부·백업 공간 확인 |
| Docker | DH4300 Plus는 Docker를 지원한다. 소유자에게 실제 설치 상태와 프로젝트 실행 권한을 확인한다. |
| Compose | Docker Compose V2 사용. 검사 구성의 !override 문법은 2.24.4 이상 필요 |
| 공유기 | 관리자 설정·TCP 포트포워딩 권한·상위 공유기 또는 통신사 모뎀 구성 확인 |
| 인터넷 | WAN 주소와 외부 주소 비교, 이중 NAT·CGNAT·통신사 수신 제한 확인 |
| 도메인 | 보유 도메인 또는 DDNS를 실제 공인 주소로 연결. 유동 주소 갱신과 A/AAAA 도달성 확인 |
| NAS 포트 | 관리 서비스의 80·443 사용 여부와 방화벽 확인. NAS 내부 IP는 DHCP 예약 등으로 유지 |

직접 수신할 수 있으면 공유기의 TCP 80·443을 NAS 프록시로 전달한다. CGNAT·통신사 제한 등으로 불가능하면 통신사 공인 IP 또는 별도 터널을 검토한다. 이 저장소는 터널 서비스·계정·DNS를 자동 생성하지 않는다.

NAS 관리 화면, MySQL 3306, 웹 내부 80, Ratchet 8090은 별도로 외부 공개하지 않는다. 외부에 노출하는 것은 프록시의 80·443뿐이다.

---
### 확인된 모델: UGREEN DH4300 Plus

2026-11-19 사용자가 소유자에게 받은 모델명은 DH4300 Plus다. UGREEN 공식 자료는 Rockchip ARM 8코어·8GB LPDDR4X와 Docker 지원을 명시하며 Docker 안내는 해당 모델에 ARM64 이미지를 요구한다. 실제 설치된 OS·Docker·Compose 버전, 앱 설치와 프로젝트 생성 권한은 아직 확인되지 않았다.

사용자가 추가로 전달한 장비 구성은 4베이·ARM 8코어·8GB LPDDR4X·24TB HDD·Docker 지원이다. 24TB는 전달받은 HDD 용량이며 실제 남은 공간·RAID 적용 후 사용 가능 용량·백업 할당 공간은 미확인이다.

공식 안내의 설치 경로는 App Center의 Docker 앱과 Docker → Project → Create다. 이 구성은 저장소 전체 빌드 문맥을 사용하므로 해당 UI의 build 지원과 Compose 버전을 확인하고, CLI를 사용할 때는 소유자가 허용한 SSH 계정으로 실행한다. amd64 이미지 강제 실행이나 임의의 비공식 앱 설치를 전제로 하지 않는다.

저장소의 자동 검사는 Linux AMD64와 ARM64에서 같은 Compose 구성을 빌드하고 실행한다. 실제 DH4300 Plus의 UGOS 버전, 볼륨 권한, 공인 인증서와 이동통신망 접속은 소유자와 별도로 확인한다. [자동 검사 구성](../.github/workflows/docker.yml) · [컨테이너 통합 검사](../tests/docker-flow.test.mjs)

---
## 2. 서비스 구조와 보존 경계

외부 브라우저 → HTTPS/WSS Caddy → Apache/PHP 또는 Ratchet → MySQL.

- 웹 주소는 `/Team006/index.html`, 실시간 경로는 `/Team006/realtime`이다.
- PHP 내장 개발 서버 대신 Apache를 사용한다. Apache 문서 루트에는 작은 진입 파일만 있으며 router.php의 기존 API·화면 허용 목록을 재사용한다.
- DB 연결망은 내부 전용이다. 프록시 연결망의 Caddy 고정 IP 한 개만 실제 접속 IP 헤더의 신뢰 대상으로 지정한다. Caddy 앞에 다른 프록시·CDN·터널을 추가하면 별도 신뢰 경계 검토가 필요하다.
- 웹·Ratchet은 동일 PHP 이미지·www-data UID·세션 저장 경로·형식과 sessions 볼륨을 사용한다. 기존 로그아웃·세션 만료·계정 변경·소속 권한 검사를 유지한다.
- 운영 쿠키는 Secure·HttpOnly·SameSite=Lax를 유지한다. HTTPS는 Caddy에서 종료하며 내부 HTTP 때문에 Secure를 해제하지 않는다.
- 실시간 알림 연결은 메시지를 저장하지 않는다. 기존 CSRF 보호 HTTP API가 저장하고, WebSocket은 변경 신호만 전달한다. 끊김 중 HTTP 주기 조회도 유지한다.
- 프레임·메시지는 각각 1,024바이트, 메시지당 분할은 최대 64개, 미완성 수신은 10초로 제한한다. 30초 ping/pong으로 유휴 연결을 확인한다. 5초 DB 감시 실패 시 Ratchet을 종료해 컨테이너 재시작으로 PDO 연결을 갱신한다.
- 이 구현은 Ratchet 0.4.4의 보호된 연결 맥락과 잠금 파일의 RFC6455 MessageBuffer 계약을 사용한다. Composer 갱신 시 프레임·분할·수신 시간 및 실시간 통합 검사를 재실행한다.
- DB 자료는 mysql_data, 인증 세션은 sessions, 인증서는 caddy_data·caddy_config 볼륨에 보관한다. 볼륨 이름은 Compose 프로젝트 이름에 종속되므로 운영에서 프로젝트 이름을 임의로 바꾸지 않는다.

---
## 3. 개인 설정과 이미지 준비

아래 명령은 NAS의 Linux 셸에서 저장소 루트를 기준으로 실행한다. 장비에 맞는 Docker·Compose 설치와 제조사 설정은 먼저 완료해야 한다.

```sh
cp .env.example .env # 개인 환경 파일 준비
chmod 600 .env # 접속 비밀 값의 파일 권한 제한
docker compose version # Compose 버전 확인
docker info --format '{{.Architecture}}' # 실제 엔진 CPU 구조 확인
```

`.env`를 편집해 APP_DOMAIN을 실제 도메인으로, MYSQL_DATABASE·MYSQL_USER를 명시적인 서비스 이름으로 지정한다. DB 이름·계정은 영문·숫자·밑줄만 사용한다. MYSQL_PASSWORD·MYSQL_ROOT_PASSWORD에는 서로 다른 충분히 긴 임의 비밀번호, AUTH_RATE_LIMIT_KEY에는 32바이트 이상 난수 비밀 값을 설정한다. 특수 문자가 있는 값은 Compose .env 문법에 맞게 작은따옴표로 감싸고 비밀 값을 출력·공유하지 않는다.

PROXY_SUBNET과 CADDY_PROXY_IP가 NAS·공유기·다른 Docker 연결망과 충돌하지 않는지 확인한다. PROXY_DYNAMIC_RANGE는 같은 서브넷 안에서 고정 프록시 주소를 제외한 자동 배정 범위다. 세 값을 함께 변경하며 기본값은 각각 172.30.60.0/24·172.30.60.128/25·172.30.60.2다. 고정 주소가 자동 배정 범위에 포함되면 컨테이너 시작 순서에 따라 충돌할 수 있다.

PHP_IMAGE·MYSQL_IMAGE·CADDY_IMAGE 기본값은 PHP 8.3 Apache Bookworm, MySQL 8.4, Caddy 2 계열이다. 계열 태그는 패치 이미지가 바뀔 수 있다. 실제 NAS 배포 전 각 이미지의 CPU 지원과 업데이트를 확인하고, 검증한 tag@sha256 digest로 개인 설정을 고정해 재현성을 확보한다. 다른 CPU 구조의 지원을 이 문서에서 보장하지 않는다.

```sh
docker compose config -q # 비밀 값 출력 없는 설정 검사
docker compose build # PHP 확장·Argon2id·64비트와 잠금 의존성 확인
docker compose up -d --wait database # DB 접속 가능 상태까지 대기
```

빈 볼륨의 MySQL 서비스 DB·계정 생성은 공식 이미지의 최초 준비 과정이다. 애플리케이션 테이블·seed·마이그레이션은 시작 시 자동 적용하지 않는다. 기존 볼륨에서는 환경 변수 변경만으로 DB 비밀번호가 변경되지 않는다. 운영 비밀번호 변경은 별도 DB 계정 변경과 앱 설정을 함께 조정한다.

---
## 4. 기존 DB 이관 또는 신규 DB 준비

**보존 대상 원본 DB를 먼저 확정한다. 개발·검사 DB 이름을 보고 임의로 선택하지 않는다.** 원본에 초기화·seed를 적용하지 않는다.

기존 자료가 있으면 원본 MySQL 8.4 버전·001~005 적용 상태를 확인하고 쓰기를 중단한 뒤 일관된 논리 백업을 만든다. 바이너리 첨부 보존을 위해 hex-blob, 트랜잭션 일관성을 위해 single-transaction 등을 사용한다. 백업 중 DDL을 실행하지 않는다. 백업 해시·원본 테이블별 행 수·관계·첨부 해시를 기록하고 원본과 사본을 별도로 보관한다.

Windows MySQL 자료 디렉터리를 Linux 볼륨에 직접 연결하지 않는다. 다음 명령은 **새 빈 대상 DB**에서만 실행하며 기존 테이블이 있으면 도구가 거절한다.

```sh
docker compose exec -T database sh /opt/systemmakers/database.sh restore-empty < /private/systemmakers-backup.sql # 신뢰한 원본 백업의 빈 DB 복원
```

기존 자료가 전혀 없는 새 서비스에만 아래 명령을 대신 사용한다. 두 경로를 연속 실행하지 않는다.

```sh
docker compose exec -T database sh /opt/systemmakers/database.sh bootstrap-empty # 빈 DB 기본 구조와 001~005 준비
```

도구는 트랜잭션으로 되돌릴 수 없는 DDL을 포함한다. 부분 실패 시 자동 재적용하거나 테이블을 지우지 말고 상태를 확인해 새 별도 볼륨에서 다시 준비한다. 복원본에 이미 적용된 변경을 반복 실행하지 않는다. 누락 변경이 있으면 관리자 계정으로 복원본에서 확인 후 필요한 SQL만 실행한다.

원본과 계정 ID·비밀번호 해시·소속·역할·대화·첨부·프로필·친구·차단 관계를 비교한 뒤 앱 계정의 DDL 권한을 제거한다. 공식 이미지가 처음 만드는 앱 계정은 대상 DB에 넓은 권한을 가지므로 **외부 공개 전** 아래 단계를 실행한다.

```sh
docker compose exec -T database sh /opt/systemmakers/database.sh restrict-app # 앱 계정의 조회·추가·수정·삭제만 허용
docker compose up -d --wait web realtime proxy # 스키마 준비 후 서비스 시작과 상태 확인
docker compose ps # DB·웹·Ratchet 상태 확인
docker compose exec -T web php scripts/show-public-url.php # 설정한 웹 링크와 WSS 진단 주소 출력
```

DB 컨테이너의 정상 상태는 MySQL 접속 가능을 뜻한다. 웹 상태 검사 `/Team006/backend/api/health.php`는 앱 계정이 기본 테이블과 001~005의 테이블 14개를 모두 볼 수 있을 때 200을 반환한다. 빈 볼륨이나 일부만 복원된 스키마에는 503을 반환한다. 이 경우 Compose 프로젝트 이름·볼륨·권한·복원 단계를 먼저 확인한다. 행 수와 첨부 해시는 원본과 따로 비교한다.

이관 시 기존 Windows 로그인 세션은 복사하지 않고 다시 로그인한다. 계정·대화 데이터는 보존하며 NAS 안의 웹·Ratchet 인증 상태는 공통 세션 볼륨으로 공유한다.

---
## 5. 접속 링크와 외부 인수 검사

주소 출력 도구는 설정한 링크를 출력하며 외부 접속 검증 성공을 의미하지 않는다. 웹 링크는 브라우저에서 열고 WSS 주소는 개발자 도구의 WebSocket 진단에 사용한다. 실제 도메인이 미정이므로 이 문서에 가짜 서비스 링크를 제공하지 않는다.

1. DNS A/AAAA와 실제 공인 주소, 포트포워딩·방화벽, 인증서 발급과 만료·갱신 상태 확인.
2. 휴대폰 Wi-Fi를 끄고 이동통신망에서 출력한 HTTPS 웹 링크 접속. 같은 Wi-Fi의 NAT loopback 성공만으로 판단 금지.
3. 가입·로그인·새로고침·로그아웃과 Secure·HttpOnly·SameSite 쿠키 확인.
4. 개발자 도구에서 WSS의 101 전환과 subscribed 응답 확인. HTTP 주기 조회만 작동하는 상태와 구분.
5. 서로 다른 망의 두 계정으로 채널·개인 대화 전송과 알림 확인.
6. CSRF 누락·다른 서버·개인 대화 제삼자·첨부 권한 거절, 로그아웃·만료·탈퇴 후 구독 종료 확인.
7. 5 MiB 첨부 업로드·다운로드, 5 MiB 초과 거절, 재다운로드 해시 확인.
8. Ratchet 중단 중 기존 HTTP 조회와 메시지 저장 유지, 재시작 후 WSS 복구 확인.
9. DB·NAS 재시작과 컨테이너 재생성 후 계정·대화·첨부 보존 확인.
10. 확인일·NAS 모델/OS/CPU·이미지 digest·도메인·다른 망의 검사 결과를 기록한 뒤 실제 접속 링크 전달.

동시 접속 부하·최대 인원·장시간 안정성은 별도 측정 대상이다. 단일 이벤트 루프와 동기 DB 조회의 확장성을 보장하지 않는다.

---
## 6. 백업·복원과 롤백

NAS의 Linux 셸에서 Compose 프로젝트 루트로 이동해 아래 명령을 실행한다. 백업과 최종 SQL 파일은 같은 로컬 파일시스템에 둔다. 보관 폴더는 하드 링크를 지원해야 한다.

```sh
backupFile=$(sh scripts/backup.sh) && sha256sum "$backupFile" # 성공한 백업의 경로와 해시 확인
```

기본 폴더는 `backups/`다. 다른 위치는 `sh scripts/backup.sh /볼륨/전용백업폴더`처럼 지정한다. 백업 도구는 소유자 전용 임시 파일에 덤프를 쓰고, 성공한 비어 있지 않은 파일만 UTC 시각과 고유 번호가 붙은 SQL 파일로 공개한다. 연결 실패·디스크 쓰기 실패·이름 충돌이 발생하면 이전 사본을 보존하고 실패로 종료한다.

백업 해시와 사본을 NAS 외부에도 암호화해 보관한다. 일별·주별 보관 주기는 허용 가능한 데이터 손실 시간과 복원 시간을 정한 뒤 NAS 스케줄러에 설정한다.

백업 복원은 운영과 **다른 Compose 프로젝트·볼륨**에 restore-empty로 실행해 원본과 비교한다. 백업 생성만으로 복원 성공을 주장하지 않는다. 서비스는 최소 DML 권한 계정, 백업·복원·마이그레이션은 관리자 계정을 사용한다.

일반 중지는 `docker compose down`이며 운영에서 `--volumes`를 붙이지 않는다. mysql_data 삭제·이름 변경·다른 프로젝트로 실행은 기존 DB를 비어 보이게 하거나 지울 수 있다. 볼륨 변경은 백업과 복원 검증 후 별도 작업으로 다룬다.

전환 실패 시 신규 쓰기를 멈추고 원본을 보존한 상태로 복귀한다. 전환 이후 신규 메시지가 있다면 추가 백업과 차이 조정 없이 오래된 DB로 되돌리지 않는다. 코드 이미지 롤백 전 스키마 호환성을 확인한다.

---
## 7. 자동 회귀 검사와 컨테이너 검증

Docker·Compose 2.24.4 이상과 Node.js 22 이상이 있는 검사 머신에서 다음 명령을 실행한다.

```sh
SYSTEMMAKERS_DOCKER_TEST=1 node scripts/check-docker.mjs # 격리된 TLS·권한·장애·복원 통합 검사
```

검사는 무작위 smtest 프로젝트·검사 비밀 값·루프백 포트를 생성한다. Caddy 내부 CA를 별도 Node 프로세스에서만 신뢰하며 TLS 검증을 끄지 않는다. HTTPS·WSS, 공유 세션·CSRF·권한·첨부, DB 장애 후 재연결, 컨테이너 재생성, 별도 볼륨 백업 복원을 검사한다. 검사 프로젝트만 정리하며 운영 systemmakers 볼륨은 삭제하지 않는다. 결과와 CA·검사 백업은 Git 제외 `.runtime`에 남는다.

GitHub Actions는 `main` 푸시와 PR에서 화면·세션 회귀 및 백업 실패 검사를 독립 작업으로 실행한다. Docker 작업은 AMD64·ARM64에서 각각 빈 DB의 준비 보류, 초기화 이후 HTTPS·WSS, 실제 백업 명령과 별도 볼륨 복원까지 검사한다. 실제 NAS의 공인 DNS·인증서·이동통신망 접속은 5절의 현장 절차로 확인한다.

---
## 검색 참고

- [Docker Compose 네트워크](https://docs.docker.com/compose/how-tos/networking/)
- [Docker 볼륨 보존](https://docs.docker.com/engine/storage/volumes/)
- [공식 PHP Apache 이미지 구성](https://github.com/docker-library/php/blob/master/8.3/bookworm/apache/Dockerfile)
- [Apache 신뢰 프록시와 실제 접속 IP](https://httpd.apache.org/docs/2.4/mod/mod_remoteip.html)
- [Caddy 자동 HTTPS](https://caddyserver.com/docs/automatic-https)
- [Caddy WebSocket 프록시](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)
- [MySQL 8.4 논리 백업](https://dev.mysql.com/doc/refman/8.4/en/mysqldump.html)
- [DH4300 Plus 공식 사양](https://ai.ugreen.com/products/ugreen-nasync-dh4300-plus-nas-storage)
- [UGREEN Docker·Compose와 ARM64 안내](https://ai.ugreen.com/blogs/knowledge/docker-docker-compose-ugreen-nas)
- [공식 PHP 이미지 구조 목록](https://github.com/docker-library/official-images/blob/master/library/php)
- [공식 MySQL 이미지 구조 목록](https://github.com/docker-library/official-images/blob/master/library/mysql)
