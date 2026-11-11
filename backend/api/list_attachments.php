<?php // 대화 메시지의 첨부 정보 조회
declare(strict_types=1); // 엄격한 자료형 검사
require_once __DIR__ . '/../includes/bootstrap.php'; // 공통 인증과 응답
require_once __DIR__ . '/../includes/attachments.php'; // 첨부 권한 검사
require_method(['GET']); // 조회 메서드 확인
$databaseConnection = db(); // 실제 DB 연결
$currentUser = require_user($databaseConnection); // 세션 사용자 확인
require_query_fields(['kind', 'target_id', 'message_ids']); // 조회 키 제한
$kind = $_GET['kind'] ?? null; // 대화 유형
if (!in_array($kind, ['channel', 'direct'], true) || !is_string($_GET['message_ids'] ?? null)) // 유형과 ID 목록 확인
{
    respond_error('INVALID_QUERY', '조회 조건을 확인하세요.', 400); // 잘못된 조건
}
$targetId = validate_id($_GET['target_id'] ?? null, 'target_id', false, true); // 대화 ID
$messageIds = explode(',', $_GET['message_ids']); // 조회 메시지 식별자
if (count($messageIds) > 50 || count(array_unique($messageIds)) !== count($messageIds)) // 목록 크기와 중복 제한
{
    respond_error('INVALID_QUERY', '메시지 목록을 확인하세요.', 400); // 잘못된 목록
}
foreach ($messageIds as $messageId) // 각 메시지 검사
{
    validate_id($messageId, 'message_ids', false, true); // 정규 ID 검사
}
close_session(); // 세션 잠금 해제
try // 권한과 첨부 정보 조회
{
    $databaseConnection->beginTransaction(); // 조회 트랜잭션
    attachment_access($databaseConnection, $kind, $targetId, $currentUser['id'], false); // 현재 대화 권한
    $tableName = $kind === 'channel' ? 'messages' : 'direct_messages'; // 고정 메시지 테이블
    $targetColumn = $kind === 'channel' ? 'channel_id' : 'conversation_id'; // 고정 대화 열
    $messageColumn = $kind === 'channel' ? 'channel_message_id' : 'direct_message_id'; // 고정 첨부 연결 열
    $placeholders = implode(',', array_fill(0, count($messageIds), '?')); // 준비된 ID 자리
    $query = $databaseConnection->prepare("SELECT a.id, a.$messageColumn AS message_id, a.original_name, a.file_size FROM message_attachments a JOIN $tableName m ON m.id = a.$messageColumn WHERE m.$targetColumn = ? AND m.id IN ($placeholders)"); // 대화 내부 파일만 조회
    $query->execute(array_merge([$targetId], $messageIds)); // 문자열 ID 바인딩
    $attachments = array_map('attachment_public', $query->fetchAll()); // 공개 메타데이터 변환
    $databaseConnection->commit(); // 조회 잠금 해제
    respond_success(['attachments' => $attachments]); // 파일 내용 없는 응답
}
catch (Throwable $caughtException) // 조회 오류
{
    if ($databaseConnection->inTransaction()) // 남은 트랜잭션
    {
        $databaseConnection->rollBack(); // 조회 잠금 해제
    }
    attachment_failure($caughtException); // 권한 또는 내부 오류
}
