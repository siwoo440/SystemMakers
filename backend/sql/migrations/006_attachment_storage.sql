ALTER TABLE message_attachments -- 기존 BLOB을 보존하는 비공개 저장소 추가
    DROP CHECK chk_attachment_size, -- 기존 5 MiB 크기 경계 제거
    MODIFY file_data MEDIUMBLOB NULL, -- 기존 원본 보존과 신규 파일 분리
    ADD storage_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL, -- 서버 생성 비공개 원본 키
    ADD preview_mime VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NULL, -- 실제 검증한 이미지 형식
    ADD UNIQUE KEY uq_attachment_storage (storage_key), -- 저장 파일의 고유 연결
    ADD CONSTRAINT chk_attachment_size CHECK (file_size BETWEEN 1 AND 200000000), -- 십진수 200 MB 크기 경계
    ADD CONSTRAINT chk_attachment_storage CHECK ((file_data IS NULL) <> (storage_key IS NULL)), -- BLOB 또는 파일 중 하나만 저장
    ADD CONSTRAINT chk_attachment_preview CHECK (preview_mime IS NULL OR preview_mime IN ('image/png', 'image/jpeg', 'image/webp')); -- 검증한 이미지 유형만 허용
