<?php // 권한을 확인한 파일 다운로드
declare(strict_types=1); // 엄격한 자료형 검사
require_once __DIR__ . '/../includes/bootstrap.php'; // 공통 인증과 응답
require_once __DIR__ . '/../includes/attachments.php'; // 첨부 권한 검사
require_method(['GET']); // 다운로드 메서드 확인
$databaseConnection = db(); // 실제 DB 연결
$currentUser = require_user($databaseConnection); // 세션 사용자 확인
require_query_fields(['id']); // 허용 조회 키
$attachmentId = validate_id($_GET['id'] ?? null, 'id', false, true); // 첨부 문자열 ID
close_session(); // 세션 잠금 해제
try // 권한과 파일의 일관된 조회
{
    $databaseConnection->beginTransaction(); // 다운로드 트랜잭션
    $lookup = $databaseConnection->prepare('SELECT a.channel_message_id, a.direct_message_id, c.channel_id, d.conversation_id FROM message_attachments a LEFT JOIN messages c ON c.id=a.channel_message_id LEFT JOIN direct_messages d ON d.id=a.direct_message_id WHERE a.id=:id'); // 대화 대상 식별
    $lookup->execute(['id' => $attachmentId]); // 파일 대상 조회
    $record = $lookup->fetch(); // 연결된 대화
    if ($record === false) // 첨부 없음
    {
        throw new MessageAccessException('NOT_FOUND', 404); // 없는 파일
    }
    $kind = $record['channel_message_id'] !== null ? 'channel' : 'direct'; // 연결 유형
    $targetId = (string) ($kind === 'channel' ? $record['channel_id'] : $record['conversation_id']); // 연결된 대화 ID
    attachment_access($databaseConnection, $kind, $targetId, $currentUser['id'], false); // 현재 참여 권한 검사
    $query = $databaseConnection->prepare('SELECT original_name, file_size, file_data FROM message_attachments WHERE id=:id FOR SHARE'); // 승인된 파일 조회
    $query->execute(['id' => $attachmentId]); // 실제 파일 조회
    $file = $query->fetch(); // 파일 내용과 이름
    if ($file === false) // 삭제 경합
    {
        throw new MessageAccessException('NOT_FOUND', 404); // 삭제된 파일
    }
    $databaseConnection->commit(); // 조회 잠금 해제
    header('Content-Type: application/octet-stream'); // 모든 파일의 실행 방지
    header("Content-Disposition: attachment; filename=download; filename*=UTF-8''" . rawurlencode($file['original_name'])); // 안전한 한글 다운로드 이름
    header('Content-Length: ' . (string) $file['file_size']); // 실제 파일 길이
    header('Cache-Control: private, no-store'); // 공유 캐시 방지
    echo $file['file_data']; // 원본 파일 바이트
    exit; // JSON 응답 방지
}
catch (Throwable $caughtException) // 조회 오류
{
    if ($databaseConnection->inTransaction()) // 남은 트랜잭션
    {
        $databaseConnection->rollBack(); // 조회 잠금 해제
    }
    attachment_failure($caughtException); // 권한 또는 내부 오류
}
