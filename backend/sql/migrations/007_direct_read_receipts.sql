ALTER TABLE direct_messages -- 상대방의 마지막 메시지 확인용 인덱스
    ADD KEY idx_direct_messages_incoming (conversation_id, user_id, id), -- 대화와 작성자별 최신 ID 조회
    ALGORITHM = INPLACE, LOCK = NONE; -- 기존 메시지 보존과 DML 동시 처리
CREATE TABLE direct_read_receipts -- 개인 대화의 계정별 읽음 기준
( -- 열과 제약 조건 시작
    conversation_id BIGINT UNSIGNED NOT NULL, -- 참여 중인 대화 식별자
    user_id BIGINT UNSIGNED NOT NULL, -- 읽은 대화 참여자 식별자
    last_read_message_id BIGINT UNSIGNED NOT NULL, -- 확인한 상대방 메시지의 최대 식별자
    PRIMARY KEY (conversation_id, user_id), -- 같은 계정과 대화의 중복 방지
    CONSTRAINT fk_direct_read_conversation FOREIGN KEY (conversation_id) REFERENCES direct_conversations (id) ON DELETE CASCADE ON UPDATE RESTRICT -- 대화 삭제 시 읽음 기준 정리
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci; -- 읽음 상태의 트랜잭션 보장
