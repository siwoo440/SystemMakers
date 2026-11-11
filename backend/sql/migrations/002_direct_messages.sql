CREATE TABLE direct_conversations -- 개인 대화 쌍
(
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, -- 대화 식별자
    user_a_id BIGINT UNSIGNED NOT NULL, -- 작은 참여자 ID
    user_b_id BIGINT UNSIGNED NOT NULL, -- 큰 참여자 ID
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 생성 시각
    PRIMARY KEY (id), -- 대화 기본 키
    UNIQUE KEY uq_direct_pair (user_a_id, user_b_id), -- 참여자 쌍 고유성
    KEY idx_direct_user_b (user_b_id, id), -- 둘째 참여자 목록
    CONSTRAINT chk_direct_pair CHECK (user_a_id < user_b_id), -- 정렬과 본인 대화 제한
    CONSTRAINT fk_direct_user_a FOREIGN KEY (user_a_id) REFERENCES users (id) ON DELETE RESTRICT ON UPDATE RESTRICT, -- 첫 참여자 보존
    CONSTRAINT fk_direct_user_b FOREIGN KEY (user_b_id) REFERENCES users (id) ON DELETE RESTRICT ON UPDATE RESTRICT -- 둘째 참여자 보존
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci; -- 트랜잭션 설정
CREATE TABLE direct_messages -- 개인 대화 메시지
(
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, -- 메시지 식별자
    conversation_id BIGINT UNSIGNED NOT NULL, -- 소속 대화
    user_id BIGINT UNSIGNED NOT NULL, -- 작성 사용자
    content TEXT NOT NULL, -- 메시지 원문
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 저장 시각
    PRIMARY KEY (id), -- 메시지 기본 키
    KEY idx_direct_messages_conversation (conversation_id, id), -- 대화별 이력 조회
    KEY idx_direct_messages_user (user_id), -- 작성자 참조
    CONSTRAINT chk_direct_message_content CHECK (CHAR_LENGTH(content) BETWEEN 1 AND 2000), -- 본문 길이 제한
    CONSTRAINT fk_direct_message_conversation FOREIGN KEY (conversation_id) REFERENCES direct_conversations (id) ON DELETE CASCADE ON UPDATE RESTRICT, -- 대화 삭제 시 정리
    CONSTRAINT fk_direct_message_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT ON UPDATE RESTRICT -- 작성자 보존
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci; -- 트랜잭션 설정
CREATE TABLE user_blocks -- 사용자 차단 관계
(
    blocker_id BIGINT UNSIGNED NOT NULL, -- 차단 사용자
    blocked_id BIGINT UNSIGNED NOT NULL, -- 차단 대상
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 차단 시각
    PRIMARY KEY (blocker_id, blocked_id), -- 차단 관계 고유성
    KEY idx_blocks_blocked (blocked_id), -- 대상 사용자 참조
    CONSTRAINT chk_blocks_distinct CHECK (blocker_id <> blocked_id), -- 본인 차단 제한
    CONSTRAINT fk_blocks_blocker FOREIGN KEY (blocker_id) REFERENCES users (id) ON DELETE CASCADE ON UPDATE RESTRICT, -- 차단 사용자 참조
    CONSTRAINT fk_blocks_blocked FOREIGN KEY (blocked_id) REFERENCES users (id) ON DELETE CASCADE ON UPDATE RESTRICT -- 차단 대상 참조
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci; -- 트랜잭션 설정
