CREATE TABLE friendships -- 친구 요청과 수락 관계
(
    user_a_id BIGINT UNSIGNED NOT NULL, -- 작은 사용자 식별자
    user_b_id BIGINT UNSIGNED NOT NULL, -- 큰 사용자 식별자
    requester_id BIGINT UNSIGNED NOT NULL, -- 요청 보낸 사용자
    status ENUM('pending', 'accepted') NOT NULL DEFAULT 'pending', -- 요청과 수락 상태
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 최초 요청 시각
    PRIMARY KEY (user_a_id, user_b_id), -- 두 사용자 관계 유일성
    KEY idx_friendships_user_b (user_b_id, status), -- 두 번째 사용자 목록
    CONSTRAINT chk_friend_pair CHECK (user_a_id < user_b_id), -- 본인 요청 제한
    CONSTRAINT chk_friend_requester CHECK (requester_id = user_a_id OR requester_id = user_b_id), -- 실제 참여자만 요청
    CONSTRAINT fk_friend_a FOREIGN KEY (user_a_id) REFERENCES users(id) ON DELETE CASCADE, -- 첫 사용자 관계
    CONSTRAINT fk_friend_b FOREIGN KEY (user_b_id) REFERENCES users(id) ON DELETE CASCADE, -- 둘째 사용자 관계
    CONSTRAINT fk_friend_requester FOREIGN KEY (requester_id) REFERENCES users(id) ON DELETE CASCADE -- 요청 사용자 관계
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci; -- 트랜잭션과 한글 설정
