CREATE TABLE message_attachments -- 메시지 첨부 파일
(
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, -- 첨부 식별자
    channel_message_id BIGINT UNSIGNED NULL, -- 채널 메시지 연결
    direct_message_id BIGINT UNSIGNED NULL, -- 개인 메시지 연결
    original_name VARCHAR(255) NOT NULL, -- 원본 파일 이름
    file_size INT UNSIGNED NOT NULL, -- 실제 파일 바이트 수
    file_data MEDIUMBLOB NOT NULL, -- MySQL 내부 파일 내용
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 저장 시각
    PRIMARY KEY (id), -- 첨부 기본 키
    UNIQUE KEY uq_attachment_channel (channel_message_id), -- 채널 메시지당 하나
    UNIQUE KEY uq_attachment_direct (direct_message_id), -- 개인 메시지당 하나
    CONSTRAINT chk_attachment_message CHECK ((channel_message_id IS NULL) <> (direct_message_id IS NULL)), -- 연결 대상 하나만 허용
    CONSTRAINT chk_attachment_size CHECK (file_size BETWEEN 1 AND 5242880), -- 파일 크기 범위
    CONSTRAINT fk_attachment_channel FOREIGN KEY (channel_message_id) REFERENCES messages (id) ON DELETE CASCADE, -- 채널 메시지 삭제 시 정리
    CONSTRAINT fk_attachment_direct FOREIGN KEY (direct_message_id) REFERENCES direct_messages (id) ON DELETE CASCADE -- 개인 메시지 삭제 시 정리
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci; -- 트랜잭션과 한글 설정
