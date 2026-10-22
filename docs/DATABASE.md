---
# SystemMakers 데이터베이스 구조

갱신일: 2026-10-22 · 계약 버전: 0.5 · 구조 담당: B · 서버·채널 기능 담당: C

회원·서버·멤버십·채널·메시지의 관계와 API 구현 규칙을 정의한다. [schema.sql](../backend/sql/schema.sql)과 001 변경 파일을 MySQL 8.4.13에 적용했다. 최초 스키마 15개 검증은 [SCHEMA-VERIFICATION.md](SCHEMA-VERIFICATION.md), 최신 전체 165개와 seed 없는 관리·대화 흐름·기존 자료 보존 근거는 [11단계 결과](PHASE-11-VERIFICATION.md)에 있다. API 필드·인증·검증 규칙은 [API.md](API.md)와 함께 사용한다.

0.2에서 8절 설계를 확정했고 0.3에서 초대·요청 제한 변경 파일을 적용했다. 0.4에서 채널 관리, 0.5에서 본인 프로필의 보존·트랜잭션 검증을 반영했다. 0.5는 문서 계약 버전이며 스키마는 기존 8개 테이블 그대로다. 9~11단계 추가 마이그레이션은 없다. 최초 환경에는 기존 schema.sql과 001 변경 파일을 적용한다. 11단계에서는 탈퇴 후 대화 보존·재참여·채널/서버 삭제 범위와 기존 개발 자료 전체 값의 일치를 확인했다. 화면 초안 폐기는 DB 메시지 삭제와 구별한다.

---
## 1. 공통 설정

| 항목 | 설계 기준 |
|---|---|
| DBMS | MySQL 8.4 LTS 기준; 검증 서버 MySQL Community Server 8.4.13 |
| 스토리지 엔진 | 모든 테이블 InnoDB |
| 기본 문자셋 | utf8mb4 |
| 기본 비교 규칙 | utf8mb4_0900_as_ci; 대소문자 무시·악센트 구분 |
| 자원 ID | BIGINT UNSIGNED; 각 자원 테이블의 id는 AUTO_INCREMENT |
| 외래 키 | 참조 대상과 같은 BIGINT UNSIGNED |
| 시간 | DATETIME, UTC, 초 단위; 연결 직후 세션 시간대 +00:00 |
| created_at 기본값 | CURRENT_TIMESTAMP; UTC 연결을 쓰는 쓰기 경로만 허용 |
| ID 변경 | 모든 외래 키 ON UPDATE RESTRICT; 발급된 ID 수정 금지 |
| JSON ID | 10진수 문자열; PHP 정수나 JavaScript Number로 강제 변환하지 않음 |
| 마이그레이션 | 첫 구조는 backend/sql/schema.sql; 이후 변경은 별도 순서 있는 마이그레이션 파일 |

DB 이름은 환경 설정으로 지정한다. 운영 DB 계정·비밀번호·로그인 제한 HMAC 키는 저장소에 올리지 않는다. 런타임 계정에는 필요한 SELECT·INSERT·UPDATE·DELETE만 부여하고 테이블 생성 권한은 마이그레이션 계정으로 분리한다.

---
## 2. 테이블 관계

| 부모 | 자식·외래 키 | 관계 |
|---|---|---|
| users.id | servers.owner_id | 사용자 1명 : 소유 서버 여러 개 |
| users.id | server_members.user_id | 사용자 1명 : 여러 서버 멤버십 |
| servers.id | server_members.server_id | 서버 1개 : 여러 사용자 멤버십 |
| servers.id | channels.server_id | 서버 1개 : 여러 채널 |
| channels.id | messages.channel_id | 채널 1개 : 여러 메시지 |
| users.id | messages.user_id | 사용자 1명 : 여러 작성 메시지 |

users와 servers의 다대다 소속 관계를 server_members가 연결한다. messages는 server_id를 중복 저장하지 않고 channel_id → channels.server_id로 소속 서버를 찾는다. 비밀번호·세션 데이터는 메시지 조회 JOIN에 포함하지 않는다.

---
## 3. 테이블 상세

아래 기본 키·고유 키·인덱스 이름은 schema.sql에서 사용할 계약 이름이다. 별도 표기가 없는 열은 NOT NULL이다.

---
### 3.1 users — B

| 열 | 자료형 | 기본값·제약 | 의미 |
|---|---|---|---|
| id | BIGINT UNSIGNED | AUTO_INCREMENT, PRIMARY KEY | 사용자 식별자 |
| username | VARCHAR(32) | UNIQUE uq_users_username | 고유 사용자명 |
| email | VARCHAR(254) | UNIQUE uq_users_email | 로그인 이메일 |
| password_hash | VARCHAR(255) | 기본값 없음 | password_hash 결과 |
| created_at | DATETIME | CURRENT_TIMESTAMP | 가입 시각 |

사용자명은 영문·숫자·밑줄 3~32자이며 소문자로 저장한다. 이메일은 공백 제거·소문자 변환 후 최대 254자의 유효한 ASCII 주소만 허용한다. 애플리케이션 정규화와 DB의 대소문자 무시 UNIQUE 제약을 함께 적용한다. 동시 가입에 따른 UNIQUE 위반도 API의 409로 변환한다.

비밀번호 원문은 저장하지 않는다. PASSWORD_DEFAULT를 사용하고 password_verify로 비교한다. VARCHAR(255)는 향후 기본 해시 알고리즘 변경에 따른 길이 증가를 수용하기 위한 크기다. [PHP 공식 문서](https://www.php.net/manual/en/function.password-hash.php)

---
### 3.2 servers — 구조 B, 기능 C

| 열 | 자료형 | 기본값·제약 | 의미 |
|---|---|---|---|
| id | BIGINT UNSIGNED | AUTO_INCREMENT, PRIMARY KEY | 서버 식별자 |
| name | VARCHAR(100) | 기본값 없음 | 서버 이름 |
| owner_id | BIGINT UNSIGNED | FK fk_servers_owner | 현재 소유자 |
| created_at | DATETIME | CURRENT_TIMESTAMP | 생성 시각 |

인덱스 idx_servers_owner(owner_id)를 둔다. 서버명은 공백 제거 후 1~100자이며 서로 다른 서버에서 중복을 허용한다. 서버명 검색·생성 API는 C가 구현한다.

owner_id는 생성 시 로그인 사용자 ID다. 소유권 이전 기능을 도입하면 현재 소유자를 가리키도록 변경한다. 생성자 이력은 MVP에서 별도로 저장하지 않는다.

---
### 3.3 server_members — 구조 B, 기능 C

| 열 | 자료형 | 기본값·제약 | 의미 |
|---|---|---|---|
| server_id | BIGINT UNSIGNED | 복합 PRIMARY KEY, FK fk_members_server | 소속 서버 |
| user_id | BIGINT UNSIGNED | 복합 PRIMARY KEY, FK fk_members_user | 소속 사용자 |
| role | ENUM('owner','admin','member') | 기본 member | 서버 내 역할 |
| joined_at | DATETIME | CURRENT_TIMESTAMP | 가입 시각 |

기본 키는 (server_id, user_id)이며 같은 서버에 같은 사용자를 두 번 등록할 수 없다. idx_members_user(user_id, server_id)는 사용자별 서버 목록 조회용이다.

역할과 관계없이 멤버십이 있으면 해당 서버의 모든 채널을 읽고 메시지를 보낼 수 있다. 관리 API의 역할 검사는 C가 별도로 구현한다. 소유자는 정확히 한 명이며 servers.owner_id와 owner 역할의 user_id가 같아야 한다. 이 교차 테이블 규칙은 외래 키만으로 보장되지 않으므로 C의 트랜잭션에서 보장한다.

서버 생성과 owner 멤버십 INSERT는 한 트랜잭션으로 수행한다. 소유자 탈퇴·강퇴는 소유권 이전 전 거절한다. 이전 시 서버 행을 잠그고 owner_id와 양쪽 역할을 함께 변경한다.

---
### 3.4 channels — 구조 B, 기능 C

| 열 | 자료형 | 기본값·제약 | 의미 |
|---|---|---|---|
| id | BIGINT UNSIGNED | AUTO_INCREMENT, PRIMARY KEY | 채널 식별자 |
| server_id | BIGINT UNSIGNED | FK fk_channels_server | 소속 서버 |
| name | VARCHAR(100) | UNIQUE 조합 uq_channels_server_name | 채널 이름 |
| created_at | DATETIME | CURRENT_TIMESTAMP | 생성 시각 |

고유 키는 (server_id, name)이다. 같은 서버 안에서는 대소문자만 다른 이름도 중복으로 거절하고, 다른 서버에서는 같은 이름을 허용한다. 이름은 공백 제거 후 1~100자다. idx_channels_server(server_id, id)를 서버별 채널 목록 조회에 사용한다.

채널별 별도 ACL·비공개 채널·음성 채널은 MVP 범위 밖이다. 메시지가 있는 채널의 server_id 변경은 MVP에서 허용하지 않으며 채널 이동 API도 제공하지 않는다.

---
### 3.5 messages — B

| 열 | 자료형 | 기본값·제약 | 의미 |
|---|---|---|---|
| id | BIGINT UNSIGNED | AUTO_INCREMENT, PRIMARY KEY | 메시지 식별자 |
| channel_id | BIGINT UNSIGNED | FK fk_messages_channel | 소속 채널 |
| user_id | BIGINT UNSIGNED | FK fk_messages_user | 작성자 |
| content | TEXT | 기본값 없음 | UTF-8 일반 텍스트 원문 |
| created_at | DATETIME | CURRENT_TIMESTAMP | 저장 시각 |

idx_messages_channel_id(channel_id, id)를 최초·이전·신규 조회에 공통 사용한다. idx_messages_user(user_id)는 작성자 외래 키를 지원한다. 본문은 애플리케이션에서 1~2,000 코드 포인트, 공백만 있는 내용과 NUL 거절을 검사하고 DB에도 CHAR_LENGTH(content) 1~2,000 CHECK 제약 chk_messages_content_length를 둔다.

메시지 ID는 전체 messages 테이블에서 증가하며 채널별 연속 번호가 아니다. 삭제·롤백에 따른 빈 번호를 정상으로 취급한다. 정렬과 커서는 created_at이 아닌 id를 기준으로 한다.

메시지 조회는 users를 JOIN하여 현재 username을 반환한다. 과거 사용자명을 복사해 저장하지 않는다. A는 content를 HTML로 실행하지 않는다.

---
### 3.6 auth_rate_limits — B의 인증 보조 테이블

| 열 | 자료형 | 기본값·제약 | 의미 |
|---|---|---|---|
| bucket_key | CHAR(64), ASCII, ascii_bin | PRIMARY KEY | 대상과 범위의 HMAC-SHA256 16진수 키 |
| scope | ENUM('login_email','login_ip') | 기본값 없음 | 이메일·IP 제한 구분 |
| attempts | INT UNSIGNED | 기본 0 | 현재 창에서 허용한 로그인 시도 수 |
| window_started_at | DATETIME | 기본값 없음 | 현재 15분 창의 시작 |
| updated_at | DATETIME | 기본값 없음 | 마지막 변경 시각 |

idx_rate_limits_updated(updated_at)는 오래된 버킷 정리용이다. 사용자 외래 키는 두지 않는다. 없는 이메일의 공격 시도도 제한해야 하기 때문이다. 원문 이메일·IP·비밀번호는 이 테이블에 저장하지 않는다.

별도 비밀 키로 범위 이름과 정규화된 대상을 HMAC 처리하여 bucket_key를 만든다. 이메일은 가입 규칙으로 정규화하고 IP는 REMOTE_ADDR의 표준화된 IPv4·IPv6 주소를 사용한다. 신뢰 프록시 설정이 없는 상태에서는 X-Forwarded-For를 신뢰하지 않는다.

PHP 환경 변수 이름은 AUTH_RATE_LIMIT_KEY이며 32바이트 이상으로 지정한다. 여러 PHP 실행 인스턴스는 같은 키를 사용한다. 키를 바꾸면 같은 대상도 다른 버킷으로 연결되므로 요청별 난수 생성이나 서버별 다른 키 사용을 금지한다. 실제 값은 Git에서 제외한다.

로그인 입력·CSRF 검증 후 한 트랜잭션에서 이메일·IP 두 버킷을 항상 동일한 키 순서로 잠근다. 창이 15분 이상 지났으면 0회로 초기화한다. 이메일 5회 또는 IP 30회에 이미 도달했으면 두 버킷 모두 증가시키지 않고 거절한다. 그 외에는 두 버킷을 각각 1 증가시킨 뒤 커밋하고 비밀번호를 검사한다. 성공 여부로 초기화하지 않는다. Retry-After는 현재 제한에 걸린 버킷들의 남은 시간 중 최댓값이며 최소 1초다.

24시간 이상 갱신되지 않은 버킷은 유지보수 작업에서 삭제할 수 있다. 이 정리는 활성 15분 창의 제한을 해제하지 않는다. PHP 세션만으로 로그인 횟수를 저장하지 않는다.

---
## 4. 외래 키와 삭제 정책

| 외래 키 | 참조 | ON DELETE | 영향 |
|---|---|---|---|
| servers.owner_id | users.id | RESTRICT | 소유 서버가 있는 사용자 삭제 차단 |
| server_members.server_id | servers.id | CASCADE | 서버 삭제 시 소속 정보 삭제 |
| server_members.user_id | users.id | CASCADE | 삭제 가능한 계정의 멤버십 정리 |
| channels.server_id | servers.id | CASCADE | 서버 삭제 시 채널 삭제 |
| messages.channel_id | channels.id | CASCADE | 채널 삭제 시 메시지 삭제 |
| messages.user_id | users.id | RESTRICT | 작성 메시지가 남아 있는 사용자 삭제 차단 |

채널 삭제는 해당 채널 메시지의 영구 삭제로 이어진다. 서버 삭제는 멤버십·채널·메시지의 영구 삭제로 이어진다. C의 삭제 API는 권한 검사와 사용자에게 이 영향을 알리는 절차를 갖춰야 한다. 삭제 동작 검증은 자동 검사의 무작위 DB와 이번에 생성한 임시 검증 자료에 한정했다.

서버 탈퇴는 server_members 한 행만 지우므로 기존 메시지를 삭제하지 않는다. 계정 탈퇴·익명화·메시지 수정·삭제 API는 이번 범위에서 제공하지 않는다. 참조를 무시하기 위한 FOREIGN_KEY_CHECKS 해제는 사용하지 않는다. [MySQL 외래 키 문서](https://dev.mysql.com/doc/refman/8.4/en/create-table-foreign-keys.html)

---
## 5. 인증·권한·동시성 규칙

PHP 세션에는 user_id, 로그인 시각, 마지막 인증 활동 시각, csrf_token을 저장한다. 세션은 서버의 PHP 세션 저장소로 관리하며 별도의 DB 세션 테이블은 두지 않는다. 비밀번호 원문·해시는 세션에 저장하지 않는다. require_user는 세션 만료와 실제 사용자 존재 여부를 확인하고 문자열 id를 반환한다.

화면이 X-Expected-User-Id를 전달하면 require_user는 실제 세션 사용자와 일치하는지도 세션 잠금 안에서 검사한다. 다른 탭이 새 계정으로 로그인했을 때 이전 초안을 새 계정 작성자로 저장하지 않도록 본문·메시지 조회·쓰기 전에 SESSION_CHANGED로 거절한다. 이 헤더로 작성자를 지정하거나 멤버십 검사를 생략하지 않는다. 실제 작성자는 계속 세션에서 결정한다. DB 스키마나 추가 비밀 열은 필요하지 않다.

채널 접근은 channels에서 채널·서버를 확인한 뒤 server_members의 (server_id, 세션 user_id) 존재 여부로 판정한다. 채널 없음은 404, 멤버십 없음은 403, 로그인 없음은 401이다. 요청의 user_id나 role을 신뢰하지 않는다.

메시지 전송은 트랜잭션 안에서 해당 channels 행을 FOR UPDATE로 잠근 뒤 멤버십 행을 FOR SHARE로 확인하고 INSERT한다. COMMIT 뒤에 잠금이 해제된다. 같은 채널의 전송을 직렬화하여 작은 ID의 메시지가 뒤늦게 커밋되어 after_id 폴링에서 빠지는 상황을 방지한다. C가 같은 테이블에 직접 메시지를 저장하는 경우에도 이 순서를 지켜야 한다. [MySQL 잠금 읽기 문서](https://dev.mysql.com/doc/refman/8.4/en/innodb-locking-reads.html)

멤버십 공유 잠금은 전송 트랜잭션 동안 탈퇴·강퇴와의 충돌을 제어한다. 세션 잠금을 오래 보유하는 것으로 DB 권한 검사를 대체하지 않는다. C의 여러 자원 변경 트랜잭션은 서버 → 채널 ID 오름차순 → 멤버십 순서로 잠금을 취득한다. 교착·잠금 시간 초과 시 전체 작업을 롤백하고 제한된 재시도 후 공통 오류로 처리한다.

조회는 채널 필터와 ID 범위를 사용하는 읽기 전용 쿼리다. PHP 인증 정보를 읽은 뒤 세션 잠금을 해제한다. read_messages는 트랜잭션에서 채널 행·현재 멤버십 행을 순서대로 FOR SHARE로 확인하여 조회 중 삭제·탈퇴와 충돌하지 않도록 한다. 실제 메시지를 limit+1개 선택하고 초과 한 행을 제거한 뒤 공개 응답을 구성한다. 최초·이전은 ID 내림차순으로 선택 후 오름차순으로 반환하고 신규는 처음부터 오름차순이다. 커서는 실제 반환한 최소·최대 ID에서 계산하며 빈 신규 조회는 요청한 after_id를 유지한다. 응답 전 커밋하고 모든 실패에서 롤백한다. 스키마 변경과 신규 인덱스는 필요하지 않다.

---
## 6. 생성 순서와 개발용 데이터

schema.sql의 생성 순서는 users → servers → server_members → channels → messages → auth_rate_limits다. 운영 데이터에 대한 DROP·TRUNCATE·초기화를 포함하지 않는다. DB를 별도로 선택한 상태에서 빈 DB에 한 번 적용한다. 이미 테이블이 있으면 오류로 중단하며 IF NOT EXISTS로 불일치 구조를 숨기지 않는다. MySQL DDL은 전체 파일 단위로 롤백되지 않으므로 중간 오류가 발생하면 생성된 테이블을 확인하고 후속 작업을 결정한다. 스키마 변경은 이미 적용된 파일을 조용히 덮어쓰는 방식 대신 별도 마이그레이션으로 관리한다.

개발용 데이터 준비는 schema.sql과 분리한 scripts/seed-dev.php와 PowerShell 진입점 scripts/seed-dev.ps1에서 수행한다. 이미 가입한 소유자·멤버 사용자명을 지정하며 새 사용자나 비밀번호를 생성하지 않는다. development·test 환경의 CLI에서만 실행하고 기존 대화·채널·사용자와 일반 멤버의 관리 역할을 보존한다. 같은 소유자의 개발 공간 준비는 재실행할 수 있다. 단순 회원가입 직후에는 소속 서버가 없으므로 C의 가입 기능 또는 명시적인 개발 멤버십 준비가 있어야 메시지를 전송할 수 있다.

테스트는 임의 DB에 두 사용자·두 서버·서로 다른 멤버십을 준비하여 정상 접근과 타인 서버 접근을 함께 검사한다. 개발 데이터 준비 스크립트도 별도 테스트 DB에서 검증하며 운영 데이터를 초기화하지 않는다.

---
## 7. 구현 완료 판정

- MySQL에서 schema.sql을 실제 실행하고 엔진·문자셋·키·인덱스를 확인.
- 이메일·사용자명·멤버십·동일 서버 채널명의 중복 거절 확인.
- 존재하지 않는 부모를 참조하는 INSERT 거절 확인.
- 테스트 DB에서 서버·채널 CASCADE와 사용자 RESTRICT 확인.
- 채널별 최신·이전·신규 메시지 분리와 ID 오름차순 확인.
- 두 연결에서 같은 채널에 동시 전송하여 ID 커서 누락 방지 확인.
- 새 세션·동시 로그인 요청에서도 이메일·IP 제한 유지 확인.

테이블·고유 키·외래 키·삭제 정책·본문 길이·조회 쿼리·재적용 거절은 실제 MySQL에서 검증했다. 스키마 결과는 [SCHEMA-VERIFICATION.md](SCHEMA-VERIFICATION.md), 공통 계층은 [PHASE-2-VERIFICATION.md](PHASE-2-VERIFICATION.md), 인증은 [PHASE-3-VERIFICATION.md](PHASE-3-VERIFICATION.md)에 기록했다. 실제 메시지 저장·동시 전송의 ID 발급/커밋 순서·멤버십 탈퇴 대기·시간 초과 재시도·개발 데이터 보존은 [PHASE-4-VERIFICATION.md](PHASE-4-VERIFICATION.md), 실제 조회·커서·현재 소속 검사는 [PHASE-5-VERIFICATION.md](PHASE-5-VERIFICATION.md)에 기록했다. 운영 배포 환경은 아직 확정하지 않았다.

---
## 8. 7단계 관리 기능 저장 계약 — 8단계 적용

---
### 8.1 기존 테이블에서 보장할 관리 규칙

- 서버 생성: servers → server_members(owner) → channels(일반)를 한 트랜잭션으로 삽입. 어떤 단계든 실패하면 전부 롤백.
- 소유자: servers.owner_id와 유일한 owner 멤버십의 user_id 일치. 소유자 탈퇴는 차단하며 소유권 이전·역할 부여 API는 이번 범위 밖.
- 초대 참여: 기본 member 삽입. 기존 복합 기본 키와 역할·joined_at을 유지하여 중복 참여의 승격/초기화를 차단.
- 채널: 기존 uq_channels_server_name으로 같은 서버 이름 중복 거절. 마지막 채널 삭제 허용, 서버 행은 유지.
- 탈퇴: 본인 server_members 한 행만 삭제, messages·users 유지. 삭제/탈퇴 커밋 이후 시작한 접근은 현재 소속으로 거절.
- 프로필: users.username만 기존 가입 정규화·고유 키로 수정. 메시지 작성자 ID·이메일·password_hash 불변, 별도 닉네임·아바타 열 추가 없음.
- 서버 삭제: 해당 소속·초대·채널·메시지 CASCADE, 계정 보존. 채널 삭제: 해당 메시지만 CASCADE.

위 제약 중 owner 일치·역할·입력 형식·소유자 탈퇴는 외래 키로만 보장되지 않는다. 공통 검증과 트랜잭션에서 확인한다. 이름의 앞뒤 유니코드 구분 공백 제거·제어 문자 거절·길이 검사는 API 계층에서 수행한다. 삭제 confirm_name은 정규화 후 현재 이름과 정확히 비교하며 DB의 대소문자 무시 비교를 사용하지 않는다.

---
### 8.2 server_invites — 신규 설계 1

한 서버당 현재 초대 상태 한 행을 보관한다. 재발급은 같은 행의 해시·시각을 바꾸며 이전 코드는 즉시 무효화한다. 별도 초대 이력·원문 복구 기능은 제공하지 않는다. 아래 열은 revoked_at 외 모두 NOT NULL이다.

| 열 | 자료형·제약 | 의미 |
|---|---|---|
| server_id | BIGINT UNSIGNED, PRIMARY KEY, FK fk_invites_server | servers.id 참조, ON DELETE CASCADE·ON UPDATE RESTRICT |
| token_hash | BINARY(32), UNIQUE uq_invites_token_hash | 32바이트 난수 코드의 SHA-256 바이너리 해시 |
| created_by | BIGINT UNSIGNED, FK fk_invites_creator | users.id, DELETE/UPDATE RESTRICT, 발급 시 소유자 |
| created_at | DATETIME | DB UTC 발급 시각, 매 재발급 갱신 |
| expires_at | DATETIME | created_at + 86,400초 |
| revoked_at | DATETIME NULL, 기본 NULL | 폐기 시각, 재발급 시 NULL |

idx_invites_creator(created_by)를 둔다. expires_at > created_at CHECK를 추가하고 원문 난수는 저장하지 않는다. 유효성은 revoked_at IS NULL이고 DB 현재 시각 < expires_at이다. 만료 행은 원문 없이 남겨 GET 상태 조회에 사용한다. 미발급은 행 없음으로 구분하고 API에서 active=false·날짜 null을 구성한다.

해시 충돌의 고유 키 위반이면 새 난수를 최대 3번 생성한 뒤 실패 시 전체 롤백한다. 코드 원문은 커밋 후 발급 응답에서만 한 번 반환한다. 실패/성공 로그·오류 응답·버킷 키에 원문 코드를 남기지 않는다. 응답 유실 시 자동 재발급하지 않고 사용자 확인 후 새 코드 발급을 수행한다.

---
### 8.3 management_rate_limits — 신규 설계 2

기존 auth_rate_limits와 로그인 제한은 그대로 유지한다. 관리 요청용 버킷을 별도 테이블에 둔다. 모든 열은 NOT NULL이다.

| 열 | 자료형·제약 | 의미 |
|---|---|---|
| bucket_key | CHAR(64) ASCII ascii_bin, PRIMARY KEY | 범위와 대상을 HMAC-SHA256으로 처리한 키 |
| scope | ENUM('invite_issue_user','invite_join_user','invite_join_ip') | 제한 종류 |
| attempts | INT UNSIGNED, 기본 0 | 현재 600초 창에서 허용한 시도 수 |
| window_started_at | DATETIME | 첫 허용 시도 DB UTC 시각 |
| updated_at | DATETIME | 마지막 상태 갱신 시각 |

idx_management_limits_updated(updated_at)를 둔다. 키는 기존 AUTH_RATE_LIMIT_KEY를 사용하되 ‘management’·scope·정규 사용자 ID 또는 표준화 IP를 NUL 구분으로 결합하여 도메인을 분리한다. 키 길이 조건은 기존 32바이트 이상을 유지한다. 원문 IP·초대 코드를 저장하지 않는다. 사용자 대상은 이메일/사용자명 대신 불변 user ID를 사용한다.

invite_issue_user는 10회/600초, invite_join_user는 10회/600초, invite_join_ip는 100회/600초다. 기존 로그인 제한과 별개로 유지한다. 여러 버킷은 bucket_key 문자열 오름차순으로 잠그고, 하나라도 제한이면 어느 버킷도 추가 집계하지 않는다. 허용 시 모두 증가 후 커밋한다. 성공한 참여나 발급도 집계에서 제거하지 않는다. 현재 시각이 창 시작 +600초 이상이면 새 창으로 초기화한다.

카운터 커밋과 업무 트랜잭션은 분리한다. 이후 잘못된 초대·업무 실패·롤백이 발생해도 허용된 시도는 남긴다. 제한 시 Retry-After는 제한된 버킷 중 최대 남은 초다. 24시간 이상 갱신하지 않은 행은 별도 CLI 정리 작업에서 삭제 가능하다. 운영 스케줄 설치는 12단계 대상이다.

---
### 8.4 트랜잭션·권한 경계

관리 트랜잭션의 공통 자원 잠금 순서는 servers → channels(ID 오름차순) → server_invites → server_members(user_id 오름차순)다. 해당 동작이 사용하지 않는 종류는 건너뛴다. 기존 메시지 저장·조회는 채널 → 멤버십 순서를 유지한다. 관리 요청도 서버 행의 현재 권한을 관련 소속 잠금 후 재검사하고 커밋 전까지 보호한다. PHP 세션 잠금은 기존대로 DB 작업 전에 해제한다.

| 작업 | 핵심 잠금·원자성 |
|---|---|
| 초대 발급·폐기 | 발급만 별도 횟수 제한 처리 → 서버 FOR UPDATE → 현재 초대 FOR UPDATE → 소유자 소속 FOR SHARE → 권한 재확인 → 해시 교체/폐기; 폐기에는 발급 횟수 제한 미적용 |
| 초대 참여 | 횟수 제한 먼저 커밋 → 해시로 서버 ID 후보 조회(아직 권한 미확정) → 서버 FOR UPDATE → 초대 FOR UPDATE → 본인 소속 잠금 → 최신 해시·폐기·만료 시각 재검사 → member 삽입/기존 유지 |
| 본인 탈퇴 | 서버 FOR UPDATE → 본인 소속 FOR UPDATE → 소유자 여부 확인 → 소속만 삭제 |
| 채널 생성 | 서버 FOR UPDATE → 본인 소속 FOR SHARE → 역할 재검사 → 채널 삽입 |
| 채널 변경·삭제 | 채널에서 서버 ID 후보 확인 → 서버 FOR UPDATE → 채널 FOR UPDATE → 본인 소속 FOR SHARE → 현재 역할·이름 재검사 → 변경/삭제 |
| 서버 삭제 | 서버 FOR UPDATE → 소속 채널 모두 ID순 FOR UPDATE → 현재 초대 FOR UPDATE → 소속 모두 user_id순 FOR UPDATE → 소유자·이름 재검사 → 서버 DELETE와 CASCADE |
| 프로필 | 본인 users 행 FOR UPDATE → username만 UPDATE → 공개 정보 SELECT → COMMIT; UNIQUE 제약으로 경쟁 중복 거절, 다른 계정 ID 입력 배제 |

후보 조회 뒤 자원 삭제·코드 교체·역할 변경이 있으면 잠금 후 현재 상태로 다시 판정한다. 변경 트랜잭션의 소유자 전체 검사도 FOR SHARE로 현재 값을 읽어 후보 조회가 만든 과거 스냅샷을 사용하지 않는다. owner 소속과 servers.owner_id가 불일치하면 500으로 롤백한다. 초대 유효성의 DB 현재 시각은 모든 필요한 잠금을 얻은 뒤 읽는다. 초대/탈퇴/삭제 커밋 전에 시작해 이미 권한 잠금을 얻은 메시지는 먼저 커밋될 수 있으며, 삭제에는 그 메시지도 포함된다. 서버 삭제가 멤버십을 먼저 지워 진행 중 전송과 잠금 순서를 역전하지 않도록 채널을 선점한다. 삭제 미리보기의 집계는 삭제 잠금이나 승인 토큰을 대체하지 않는다. 미리보기 수치는 하나의 읽기 전용 일관된 스냅샷에서 집계한 뒤 응답 전에 트랜잭션을 종료한다.

관리 업무의 교착·잠금 시간 초과는 전체 롤백 후 최대 3회 시도한다. 재시도마다 권한·현재 초대·현재 이름을 다시 읽는다. 커밋 뒤 응답만 유실된 경우 전체 업무를 재실행하지 않는다. 버킷 집계는 업무 재시도마다 중복 실행하지 않으며 독립된 한 HTTP 요청의 허용 시도 한 번만 반영한다.

---
### 8.5 마이그레이션·검증 계획

8단계 변경 파일은 [001_server_invites_and_limits.sql](../backend/sql/migrations/001_server_invites_and_limits.sql)이다. 기존 schema.sql을 덮어쓰거나 재적용하지 않는다. 생성 순서는 server_invites → management_rate_limits다. 빈 DB는 기존 6개 테이블 생성 뒤 동일 변경 파일을 적용한다. scripts/migrate.php는 DB별 잠금·기존 구조·신규 이름 충돌을 확인하고 재적용/부분 적용을 거절하며 파일 해시를 출력한다. DDL의 부분 실패는 전체 롤백으로 간주하지 않고 실제 생성 상태를 확인한다.

별도 검사 DB에서 변경 적용·재실행 거절·기존 자료 보존·강제 실패 롤백·만료·중복 역할 보존·CASCADE·잠금 경합·횟수 제한을 확인했다. 9단계 채널 관리에 이어 10단계는 users.username의 기존 고유 키를 재사용한다. 이름 변경 전후 ID·이메일·password_hash·가입일·서버 소유자·소속·작성 대화를 비교하고, 잠금 대기 중 다른 계정의 이름 선점은 409·강제 DB 실패는 500으로 무변경을 확인했다. 개발 자료 보존과 실제 웹 확인 범위는 [10단계 결과](PHASE-10-VERIFICATION.md)를 따른다. 운영 백업 복원·부하 검증은 후속 범위다.

---
## 검색 참고

- [MySQL 외래 키와 참조 동작](https://dev.mysql.com/doc/refman/8.4/en/create-table-foreign-keys.html)
- [MySQL InnoDB 잠금 읽기](https://dev.mysql.com/doc/refman/8.4/en/innodb-locking-reads.html)
- [PHP password_hash 저장 길이와 입력 제한](https://www.php.net/manual/en/function.password-hash.php)
