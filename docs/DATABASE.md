---
# SystemMakers 데이터베이스 구조 초안

작성일: 2026-10-21 · 계약 버전: 0.1 · 구조 담당: B · 서버·채널 기능 담당: C

회원·서버·멤버십·채널·메시지의 관계와 API 구현 시 지킬 규칙을 정의한다. [schema.sql](../backend/sql/schema.sql)을 구현하고 MySQL 8.4.13의 테스트 전용 DB에 적용하여 검증했다. [검증 결과](SCHEMA-VERIFICATION.md)의 전체 테스트 15개가 통과했다. PHP 인증·메시지 API는 다음 단계다. API 필드·인증·검증 규칙은 [API.md](API.md)와 함께 사용한다.

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

채널 삭제는 해당 채널 메시지의 영구 삭제로 이어진다. 서버 삭제는 멤버십·채널·메시지의 영구 삭제로 이어진다. C의 삭제 API는 권한 검사와 사용자에게 이 영향을 알리는 절차를 갖춰야 한다. 이번 문서 작성 단계에서 실제 삭제는 수행하지 않는다.

서버 탈퇴는 server_members 한 행만 지우므로 기존 메시지를 삭제하지 않는다. 계정 탈퇴·익명화·메시지 수정·삭제 API는 이번 범위에서 제공하지 않는다. 참조를 무시하기 위한 FOREIGN_KEY_CHECKS 해제는 사용하지 않는다. [MySQL 외래 키 문서](https://dev.mysql.com/doc/refman/8.4/en/create-table-foreign-keys.html)

---
## 5. 인증·권한·동시성 규칙

PHP 세션에는 user_id, 로그인 시각, 마지막 인증 활동 시각, csrf_token을 저장한다. 세션은 서버의 PHP 세션 저장소로 관리하며 별도의 DB 세션 테이블은 두지 않는다. 비밀번호 원문·해시는 세션에 저장하지 않는다. require_user는 세션 만료와 실제 사용자 존재 여부를 확인하고 문자열 id를 반환한다.

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
## 검색 참고

- [MySQL 외래 키와 참조 동작](https://dev.mysql.com/doc/refman/8.4/en/create-table-foreign-keys.html)
- [MySQL InnoDB 잠금 읽기](https://dev.mysql.com/doc/refman/8.4/en/innodb-locking-reads.html)
- [PHP password_hash 저장 길이와 입력 제한](https://www.php.net/manual/en/function.password-hash.php)
