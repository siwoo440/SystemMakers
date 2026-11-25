<?php // 대화 파일과 메시지의 원자적 저장
declare(strict_types=1); // 엄격한 자료형 검사
require_once __DIR__ . '/../includes/bootstrap.php'; // 공통 인증과 응답
require_once __DIR__ . '/../includes/attachments.php'; // 첨부 권한 검사
require_method(['POST']); // 전송 메서드 확인
$databaseConnection = db(); // 실제 DB 연결
$currentUser = require_user($databaseConnection); // 세션 사용자 확인
require_csrf(); // 요청 위조 방지
if (array_diff(array_keys($_POST), ['kind', 'target_id']) !== [] || count($_FILES) !== 1 || !isset($_FILES['file'])) // 허용 필드 확인
{
    respond_error('VALIDATION_ERROR', '파일 요청을 확인하세요.', 422); // 잘못된 입력 거절
}
$kind = $_POST['kind'] ?? null; // 대화 유형
if (!in_array($kind, ['channel', 'direct'], true)) // 허용한 대화 유형
{
    respond_error('VALIDATION_ERROR', '대화 유형을 확인하세요.', 422); // 유형 오류
}
$targetId = validate_id($_POST['target_id'] ?? null, 'target_id'); // 대상 문자열 ID
$uploadedFile = $_FILES['file']; // 실제 업로드 자료
if (!is_array($uploadedFile) || ($uploadedFile['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK || !is_string($uploadedFile['tmp_name'] ?? null) || !is_uploaded_file($uploadedFile['tmp_name'])) // PHP 업로드 결과 확인
{
    respond_error('VALIDATION_ERROR', '파일 업로드와 서버 크기 설정을 확인하세요.', 422); // 실패 파일 거절
}
$originalName = validate_string($uploadedFile['name'] ?? null, 'file', 1, 255); // UTF-8 파일 이름
if (preg_match('/[\\\\\/\x00-\x1F\x7F]/u', $originalName)) // 경로와 제어 문자 차단
{
    respond_error('VALIDATION_ERROR', '파일 이름을 확인하세요.', 422); // 안전한 이름 필요
}
$fileSize = (int) ($uploadedFile['size'] ?? 0); // PHP 확인 크기
if (!attachment_valid_size($fileSize)) // 빈 파일과 십진수 200 MB 초과
{
    respond_error('VALIDATION_ERROR', '파일은 1바이트부터 200 MB까지 가능합니다.', 422); // 정확한 크기 제한 안내
}
if (filesize($uploadedFile['tmp_name']) !== $fileSize) // 임시 원본의 실제 바이트 수
{
    throw new RuntimeException('Uploaded file unavailable.'); // 불완전 파일 저장 차단
}
close_session(); // DB 작업 전 세션 잠금 해제
$storedPath = null; // 실패 시 제거할 신규 원본
$committed = false; // 파일과 DB 확정 여부
try // 대화 권한과 파일의 원자적 저장
{
    $databaseConnection->beginTransaction(); // 전송 트랜잭션 시작
    attachment_access($databaseConnection, $kind, $targetId, $currentUser['id'], true); // 채널 소속 또는 개인 차단 확인
    $previewMime = attachment_preview_mime($uploadedFile['tmp_name']); // 실제 이미지 검증 결과
    $storageKey = bin2hex(random_bytes(32)); // 파일 이름과 분리한 비공개 난수
    $targetPath = attachment_storage_path($storageKey); // 서버 저장소 내부 원본 경로
    if (file_exists($targetPath) || !move_uploaded_file($uploadedFile['tmp_name'], $targetPath)) // 원본을 전체 메모리 복사 없이 저장
    {
        throw new RuntimeException('Attachment storage unavailable.'); // 저장 실패의 부분 기록 차단
    }
    $storedPath = $targetPath; // 실제 생성한 원본만 실패 정리 대상으로 기록
    if (!chmod($storedPath, 0600)) // 원본의 소유자 전용 권한
    {
        throw new RuntimeException('Attachment permissions unavailable.'); // 공개 파일 권한 차단
    }
    $tableName = $kind === 'channel' ? 'messages' : 'direct_messages'; // 허용한 고정 메시지 테이블
    $targetColumn = $kind === 'channel' ? 'channel_id' : 'conversation_id'; // 허용한 고정 대상 열
    $messageInsert = $databaseConnection->prepare("INSERT INTO $tableName ($targetColumn, user_id, content) VALUES (:target, :user, :content)"); // 첨부 메시지 저장
    $messageInsert->execute(['target' => $targetId, 'user' => $currentUser['id'], 'content' => '파일: ' . $originalName]); // 파일 안내 메시지
    $messageId = $databaseConnection->lastInsertId(); // 생성 메시지 ID
    $messageColumn = $kind === 'channel' ? 'channel_message_id' : 'direct_message_id'; // 허용한 고정 연결 열
    $insert = $databaseConnection->prepare("INSERT INTO message_attachments ($messageColumn, original_name, file_size, storage_key, preview_mime) VALUES (:message, :name, :size, :key, :mime)"); // 파일 바이트 없는 메타데이터 저장
    $insert->bindValue(':message', $messageId, PDO::PARAM_STR); // 큰 메시지 ID 유지
    $insert->bindValue(':name', $originalName, PDO::PARAM_STR); // 파일 이름
    $insert->bindValue(':size', $fileSize, PDO::PARAM_INT); // 실제 바이트 수
    $insert->bindValue(':key', $storageKey, PDO::PARAM_STR); // 비공개 원본 연결 키
    $insert->bindValue(':mime', $previewMime, $previewMime === null ? PDO::PARAM_NULL : PDO::PARAM_STR); // 실제 검증한 미리보기 형식
    $insert->execute(); // 실제 첨부 저장
    $attachmentId = $databaseConnection->lastInsertId(); // 첨부 ID
    $query = $databaseConnection->prepare("SELECT m.id, m.$targetColumn, m.user_id, u.username, m.content, m.created_at FROM $tableName m JOIN users u ON u.id = m.user_id WHERE m.id = :id"); // 저장 메시지 조회
    $query->execute(['id' => $messageId]); // 실제 메시지 확인
    $row = $query->fetch(); // 공개 메시지 원본
    $message = $kind === 'channel' ? public_message($row) : direct_message($row); // 기존 메시지 응답 형식
    $attachment = attachment_public(['id' => $attachmentId, 'message_id' => $messageId, 'original_name' => $originalName, 'file_size' => $fileSize, 'preview_mime' => $previewMime]); // 저장 키 없는 공개 첨부 정보
    $databaseConnection->commit(); // 파일과 메시지 동시 확정
    $committed = true; // 응답 오류와 저장 실패 구분
    respond_success(['message' => $message, 'attachment' => $attachment], 201); // 확정된 전송 결과
}
catch (Throwable $caughtException) // 실패 시 전체 저장 취소
{
    if ($databaseConnection->inTransaction()) // 남은 트랜잭션 여부
    {
        $databaseConnection->rollBack(); // 부분 저장과 잠금 해제
    }
    if (!$committed && $storedPath !== null && is_file($storedPath)) // DB 미확정 원본 여부
    {
        unlink($storedPath); // 부분 업로드 원본 제거
    }
    attachment_failure($caughtException); // 권한 또는 내부 오류 처리
}
