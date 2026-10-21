-- SystemMakers 초기 테이블 구조
-- MySQL 8.4 전용 빈 데이터베이스에서 한 번 적용
-- DB 생성과 기존 데이터 삭제 제외
SET NAMES utf8mb4 COLLATE utf8mb4_0900_as_ci; -- 연결 문자셋 통일
SET SESSION time_zone = '+00:00'; -- 저장 시각 UTC 기준
SET SESSION sql_mode = 'STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION'; -- 잘못된 입력의 자동 보정 차단
CREATE TABLE users -- 사용자 계정
( -- 사용자 구조 시작
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, -- 사용자 식별자
    username VARCHAR(32) NOT NULL, -- 고유 사용자명
    email VARCHAR(254) NOT NULL, -- 로그인 이메일
    password_hash VARCHAR(255) NOT NULL, -- 비밀번호 해시
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 가입 시각
    PRIMARY KEY (id), -- 사용자 기본 키
    UNIQUE KEY uq_users_username (username), -- 사용자명 중복 차단
    UNIQUE KEY uq_users_email (email) -- 이메일 중복 차단
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci; -- 사용자 구조 종료
CREATE TABLE servers -- 대화 서버
( -- 서버 구조 시작
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, -- 서버 식별자
    name VARCHAR(100) NOT NULL, -- 서버 이름
    owner_id BIGINT UNSIGNED NOT NULL, -- 서버 소유자
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 생성 시각
    PRIMARY KEY (id), -- 서버 기본 키
    KEY idx_servers_owner (owner_id), -- 소유 서버 조회
    CONSTRAINT fk_servers_owner FOREIGN KEY (owner_id) -- 소유자 참조
        REFERENCES users (id) ON DELETE RESTRICT ON UPDATE RESTRICT -- 소유 계정 삭제와 ID 변경 차단
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci; -- 서버 구조 종료
CREATE TABLE server_members -- 서버 소속 관계
( -- 멤버십 구조 시작
    server_id BIGINT UNSIGNED NOT NULL, -- 소속 서버
    user_id BIGINT UNSIGNED NOT NULL, -- 소속 사용자
    role ENUM('owner', 'admin', 'member') NOT NULL DEFAULT 'member', -- 서버 내 역할
    joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 서버 가입 시각
    PRIMARY KEY (server_id, user_id), -- 중복 가입 차단
    KEY idx_members_user (user_id, server_id), -- 사용자별 서버 조회
    CONSTRAINT fk_members_server FOREIGN KEY (server_id) -- 소속 서버 참조
        REFERENCES servers (id) ON DELETE CASCADE ON UPDATE RESTRICT, -- 서버 삭제 시 소속 정리
    CONSTRAINT fk_members_user FOREIGN KEY (user_id) -- 소속 사용자 참조
        REFERENCES users (id) ON DELETE CASCADE ON UPDATE RESTRICT -- 계정 삭제 시 소속 정리
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci; -- 멤버십 구조 종료
CREATE TABLE channels -- 서버별 텍스트 채널
( -- 채널 구조 시작
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, -- 채널 식별자
    server_id BIGINT UNSIGNED NOT NULL, -- 소속 서버
    name VARCHAR(100) NOT NULL, -- 채널 이름
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 생성 시각
    PRIMARY KEY (id), -- 채널 기본 키
    UNIQUE KEY uq_channels_server_name (server_id, name), -- 같은 서버의 채널명 중복 차단
    KEY idx_channels_server (server_id, id), -- 서버별 채널 목록 조회
    CONSTRAINT fk_channels_server FOREIGN KEY (server_id) -- 소속 서버 참조
        REFERENCES servers (id) ON DELETE CASCADE ON UPDATE RESTRICT -- 서버 삭제 시 채널 정리
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci; -- 채널 구조 종료
CREATE TABLE messages -- 채널별 대화 기록
( -- 메시지 구조 시작
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, -- 메시지 식별자
    channel_id BIGINT UNSIGNED NOT NULL, -- 소속 채널
    user_id BIGINT UNSIGNED NOT NULL, -- 작성 사용자
    content TEXT NOT NULL, -- 일반 텍스트 원문
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 저장 시각
    PRIMARY KEY (id), -- 메시지 기본 키
    KEY idx_messages_channel_id (channel_id, id), -- 채널별 이력과 신규 메시지 조회
    KEY idx_messages_user (user_id), -- 작성자 참조 지원
    CONSTRAINT chk_messages_content_length CHECK (CHAR_LENGTH(content) BETWEEN 1 AND 2000), -- 본문 문자 수 제한
    CONSTRAINT fk_messages_channel FOREIGN KEY (channel_id) -- 소속 채널 참조
        REFERENCES channels (id) ON DELETE CASCADE ON UPDATE RESTRICT, -- 채널 삭제 시 메시지 정리
    CONSTRAINT fk_messages_user FOREIGN KEY (user_id) -- 작성자 참조
        REFERENCES users (id) ON DELETE RESTRICT ON UPDATE RESTRICT -- 작성 기록의 계정과 ID 보존
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci; -- 메시지 구조 종료
CREATE TABLE auth_rate_limits -- 로그인 요청 제한 버킷
( -- 제한 구조 시작
    bucket_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, -- 대상의 HMAC 식별 키
    scope ENUM('login_email', 'login_ip') NOT NULL, -- 제한 대상 종류
    attempts INT UNSIGNED NOT NULL DEFAULT 0, -- 현재 창의 시도 수
    window_started_at DATETIME NOT NULL, -- 집계 창 시작 시각
    updated_at DATETIME NOT NULL, -- 마지막 갱신 시각
    PRIMARY KEY (bucket_key), -- 제한 버킷 중복 차단
    KEY idx_rate_limits_updated (updated_at) -- 오래된 제한 정보 정리
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci; -- 제한 구조 종료
