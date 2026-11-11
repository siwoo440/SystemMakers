CREATE TABLE user_profiles -- 확장 프로필
(
    user_id BIGINT UNSIGNED NOT NULL, -- 프로필 소유자
    status_message VARCHAR(200) NOT NULL DEFAULT '', -- 상태 메시지
    picture_mime VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NULL, -- 검증된 이미지 형식
    picture_data MEDIUMBLOB NULL, -- 재인코딩 이미지 본문
    PRIMARY KEY (user_id), -- 계정별 한 프로필
    CONSTRAINT fk_profiles_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE ON UPDATE RESTRICT, -- 계정 삭제 시 정리
    CONSTRAINT chk_profiles_picture CHECK ((picture_mime IS NULL AND picture_data IS NULL) OR (picture_mime IN ('image/png', 'image/jpeg') AND picture_data IS NOT NULL)) -- 이미지 필드 일치
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci; -- 트랜잭션과 문자 설정
