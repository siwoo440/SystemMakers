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
if ($fileSize < 1 || $fileSize > 5242880) // 빈 파일과 5 MiB 초과
{
    respond_error('VALIDATION_ERROR', '파일은 1바이트부터 5 MiB까지 가능합니다.', 422); // 크기 제한 안내
}
$fileData = file_get_contents($uploadedFile['tmp_name']); // 임시 파일의 실제 바이트
if ($fileData === false || strlen($fileData) !== $fileSize) // 실제 길이 확인
{
    throw new RuntimeException('Uploaded file unavailable.'); // 불완전 파일 저장 차단
}
close_session(); // DB 작업 전 세션 잠금 해제
try // 대화 권한과 파일의 원자적 저장
{
    $databaseConnection->beginTransaction(); // 전송 트랜잭션 시작
    attachment_access($databaseConnection, $kind, $targetId, $currentUser['id'], true); // 채널 소속 또는 개인 차단 확인
    $tableName = $kind === 'channel' ? 'messages' : 'direct_messages'; // 허용한 고정 메시지 테이블
    $targetColumn = $kind === 'channel' ? 'channel_id' : 'conversation_id'; // 허용한 고정 대상 열
    $messageInsert = $databaseConnection->prepare("INSERT INTO $tableName ($targetColumn, user_id, content) VALUES (:target, :user, :content)"); // 첨부 메시지 저장
    $messageInsert->execute(['target' => $targetId, 'user' => $currentUser['id'], 'content' => '파일: ' . $originalName]); // 파일 안내 메시지
    $messageId = $databaseConnection->lastInsertId(); // 생성 메시지 ID
    $messageColumn = $kind === 'channel' ? 'channel_message_id' : 'direct_message_id'; // 허용한 고정 연결 열
    $insert = $databaseConnection->prepare("INSERT INTO message_attachments ($messageColumn, original_name, file_size, file_data) VALUES (:message, :name, :size, :data)"); // 파일 내용 저장
    $insert->bindValue(':message', $messageId, PDO::PARAM_STR); // 큰 메시지 ID 유지
    $insert->bindValue(':name', $originalName, PDO::PARAM_STR); // 파일 이름
    $insert->bindValue(':size', $fileSize, PDO::PARAM_INT); // 실제 바이트 수
    $insert->bindValue(':data', $fileData, PDO::PARAM_LOB); // 바이너리 내용
    $insert->execute(); // 실제 첨부 저장
    $attachmentId = $databaseConnection->lastInsertId(); // 첨부 ID
    $query = $databaseConnection->prepare("SELECT m.id, m.$targetColumn, m.user_id, u.username, m.content, m.created_at FROM $tableName m JOIN users u ON u.id = m.user_id WHERE m.id = :id"); // 저장 메시지 조회
    $query->execute(['id' => $messageId]); // 실제 메시지 확인
    $row = $query->fetch(); // 공개 메시지 원본
    $message = $kind === 'channel' ? public_message($row) : direct_message($row); // 기존 메시지 응답 형식
    $attachment = attachment_public(['id' => $attachmentId, 'message_id' => $messageId, 'original_name' => $originalName, 'file_size' => $fileSize]); // 공개 첨부 정보
    $databaseConnection->commit(); // 파일과 메시지 동시 확정
    respond_success(['message' => $message, 'attachment' => $attachment], 201); // 확정된 전송 결과
}
catch (Throwable $caughtException) // 실패 시 전체 저장 취소
{
    if ($databaseConnection->inTransaction()) // 남은 트랜잭션 여부
    {
        $databaseConnection->rollBack(); // 부분 저장과 잠금 해제
    }
    attachment_failure($caughtException); // 권한 또는 내부 오류 처리
}
