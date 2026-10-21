CREATE TABLE server_invites -- 서버별 현재 초대 상태
(
    server_id BIGINT UNSIGNED NOT NULL, -- 대상 서버
    token_hash BINARY(32) NOT NULL, -- 원문 없는 코드 해시
    created_by BIGINT UNSIGNED NOT NULL, -- 실제 발급 소유자
    created_at DATETIME NOT NULL, -- UTC 발급 시각
    expires_at DATETIME NOT NULL, -- UTC 만료 시각
    revoked_at DATETIME NULL DEFAULT NULL, -- 폐기 시각
    PRIMARY KEY (server_id), -- 서버당 한 상태
    UNIQUE KEY uq_invites_token_hash (token_hash), -- 코드 해시 중복 차단
    KEY idx_invites_creator (created_by), -- 발급자 참조
    CONSTRAINT fk_invites_server FOREIGN KEY (server_id) REFERENCES servers (id) ON DELETE CASCADE ON UPDATE RESTRICT, -- 서버 삭제 시 초대 정리
    CONSTRAINT fk_invites_creator FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE RESTRICT ON UPDATE RESTRICT, -- 발급자 관계 보존
    CONSTRAINT chk_invites_expiry CHECK (expires_at > created_at) -- 올바른 유효 기간
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci; -- 트랜잭션과 한글 설정
CREATE TABLE management_rate_limits -- 관리 요청 전용 제한
(
    bucket_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, -- HMAC 처리 대상
    scope ENUM('invite_issue_user','invite_join_user','invite_join_ip') NOT NULL, -- 제한 범위
    attempts INT UNSIGNED NOT NULL DEFAULT 0, -- 허용한 시도 수
    window_started_at DATETIME NOT NULL, -- 최초 시도 시각
    updated_at DATETIME NOT NULL, -- 마지막 갱신 시각
    PRIMARY KEY (bucket_key), -- 범위별 고유 버킷
    KEY idx_management_limits_updated (updated_at) -- 오래된 행 정리 기준
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci; -- 트랜잭션과 문자 설정
