<?php // 권한을 확인한 파일 다운로드
declare(strict_types=1); // 엄격한 자료형 검사
require_once __DIR__ . '/../includes/bootstrap.php'; // 공통 인증과 응답
require_once __DIR__ . '/../includes/attachments.php'; // 첨부 권한 검사
require_method(['GET']); // 다운로드 메서드 확인
$databaseConnection = db(); // 실제 DB 연결
$currentUser = require_user($databaseConnection); // 세션 사용자 확인
require_query_fields(['id', 'preview']); // 다운로드와 보호된 미리보기 조회 키
$attachmentId = validate_id($_GET['id'] ?? null, 'id', false, true); // 첨부 문자열 ID
$preview = isset($_GET['preview']); // 이미지 미리보기 요청 여부
if ($preview && $_GET['preview'] !== '1') // 정확한 미리보기 값만 허용
{
    respond_error('INVALID_QUERY', '미리보기 조건을 확인하세요.', 400); // 잘못된 미리보기 값 거절
}
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
    $query = $databaseConnection->prepare('SELECT original_name, file_size, storage_key, preview_mime FROM message_attachments WHERE id=:id FOR SHARE'); // 승인된 원본 메타데이터만 조회
    $query->execute(['id' => $attachmentId]); // 실제 파일 조회
    $file = $query->fetch(); // 원본 위치와 이름
    if ($file === false) // 삭제 경합
    {
        throw new MessageAccessException('NOT_FOUND', 404); // 삭제된 파일
    }
    if ($preview && !in_array($file['preview_mime'], ['image/png', 'image/jpeg', 'image/webp'], true)) // 미검증 파일의 inline 요청
    {
        throw new MessageAccessException('NOT_FOUND', 404); // 다른 형식의 미리보기 차단
    }
    $stream = null; // 승인된 파일 읽기 핸들
    $legacyData = null; // 기존 DB BLOB 원본
    if ($file['storage_key'] !== null) // 신규 비공개 파일 여부
    {
        $stream = @fopen(attachment_storage_path($file['storage_key']), 'rb'); // 고정 경로의 스트리밍 원본
        if ($stream === false || (int) fstat($stream)['size'] !== (int) $file['file_size']) // 누락 또는 불완전 원본 여부
        {
            throw new RuntimeException('Attachment unavailable.'); // 잘못된 길이의 응답 차단
        }
    }
    else // 기존 BLOB 파일 호환
    {
        $legacyQuery = $databaseConnection->prepare('SELECT file_data FROM message_attachments WHERE id=:id'); // 기존 최대 5 MiB 원본만 조회
        $legacyQuery->execute(['id' => $attachmentId]); // 승인한 BLOB 조회
        $legacyData = $legacyQuery->fetchColumn(); // 기존 바이너리 바이트
        if (!is_string($legacyData) || strlen($legacyData) !== (int) $file['file_size']) // 기존 파일 무결성 확인
        {
            throw new RuntimeException('Attachment unavailable.'); // 손상된 BLOB 응답 차단
        }
    }
    $databaseConnection->commit(); // 조회 잠금 해제
    header('Content-Type: ' . ($preview ? $file['preview_mime'] : 'application/octet-stream')); // 검증한 이미지 또는 강제 다운로드 형식
    header("Content-Disposition: " . ($preview ? 'inline' : 'attachment') . "; filename=download; filename*=UTF-8''" . rawurlencode($file['original_name'])); // 원본 이름의 안전한 전달
    header("Content-Security-Policy: default-src 'none'; sandbox"); // 원본 파일의 문서 실행 차단
    header('Content-Length: ' . (string) $file['file_size']); // 실제 파일 길이
    header('Cache-Control: private, no-store'); // 공유 캐시 방지
    if (is_resource($stream)) // 비공개 파일 원본 여부
    {
        fpassthru($stream); // 전체 파일의 메모리 적재 없는 전송
        fclose($stream); // 파일 핸들 해제
    }
    else // 기존 BLOB 원본 여부
    {
        echo $legacyData; // 보존한 기존 바이트 전송
    }
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
