<?php // 채널별 이전 기록과 신규 메시지 조회
declare(strict_types=1); // 엄격한 자료형 검사
require_once __DIR__ . '/messages.php'; // 공개 메시지 변환과 권한 오류
function attachment_public(array $row): array // 첨부 공개 필드
{
    return ['id' => (string) $row['id'], 'message_id' => (string) $row['message_id'], 'original_name' => $row['original_name'], 'file_size' => (int) $row['file_size'], 'preview_mime' => $row['preview_mime'] ?? null]; // 저장 키와 파일 내용 제외
}
function read_authorized_message_page(PDO $databaseConnection, bool $direct, string $targetId, int $messageLimit, ?string $beforeMessageId, ?string $afterMessageId, bool $includeAttachments): array // 권한을 잠근 대화의 페이지 조회
{
    $targetColumn = $direct ? 'conversation_id' : 'channel_id'; // 대화 종류별 대상 열
    $table = $direct ? 'direct_messages' : 'messages'; // 허용된 기록 테이블
    $attachmentKey = $direct ? 'direct_message_id' : 'channel_message_id'; // 첨부의 고유 메시지 키
    $paginationMode = $beforeMessageId !== null ? 'before' : ($afterMessageId !== null ? 'after' : 'initial'); // 조회 방향 결정
    $cursorCondition = $beforeMessageId !== null ? ' AND m.id < :cursor' : ($afterMessageId !== null ? ' AND m.id > :cursor' : ''); // 검증한 방향의 고정 SQL
    $sortOrder = $paginationMode === 'after' ? 'ASC' : 'DESC'; // 가까운 이전 또는 신규 기록 선택
    $fields = "SELECT m.id, m.$targetColumn, m.user_id, u.username, m.content, m.created_at"; // 공통 공개 기록
    $source = " FROM $table m JOIN users u ON u.id = m.user_id"; // 대화와 현재 작성자
    $range = " WHERE m.$targetColumn = :target" . $cursorCondition . " ORDER BY m.id $sortOrder LIMIT :count"; // 페이지 조회 범위
    $sql = $fields . $source . $range; // 기존 클라이언트의 기본 조회
    if ($includeAttachments) // 첨부 메타데이터 요청
    {
        $sql = $fields . ', a.id AS attachment_id, a.original_name, a.file_size, a.preview_mime' . $source . " LEFT JOIN message_attachments a ON a.$attachmentKey = m.id" . $range; // 원본과 저장 키를 제외한 파일 정보
    }
    try // 네이티브 준비 시 테이블 확인
    {
        $messageQuery = $databaseConnection->prepare($sql); // 요청에 맞는 조회문
    }
    catch (PDOException $error) // 첨부 테이블 도입 전 DB 호환
    {
        if (!$includeAttachments || !in_array((int) ($error->errorInfo[1] ?? 0), [1146, 1054], true)) // 첨부 이전 테이블 또는 신규 열 누락 이외의 오류
        {
            throw $error; // 실제 DB 오류 전달
        }
        $legacySql = $fields . ', a.id AS attachment_id, a.original_name, a.file_size' . $source . " LEFT JOIN message_attachments a ON a.$attachmentKey = m.id" . $range; // 기존 BLOB 첨부의 공개 정보
        $messageQuery = $databaseConnection->prepare((int) ($error->errorInfo[1] ?? 0) === 1054 ? $legacySql : $fields . $source . $range); // 기존 테이블에서 같은 페이지 조회
    }
    $messageQuery->bindValue(':target', $targetId, PDO::PARAM_STR); // 권한이 확인된 대화 ID
    if ($paginationMode !== 'initial') // 범위 커서 존재 여부
    {
        $messageQuery->bindValue(':cursor', $beforeMessageId ?? $afterMessageId, PDO::PARAM_STR); // 큰 메시지 ID 정밀도 유지
    }
    $messageQuery->bindValue(':count', $messageLimit + 1, PDO::PARAM_INT); // 다음 페이지 판정용 한 개 추가
    $messageQuery->execute(); // 실제 메시지 범위 조회
    $messageRows = $messageQuery->fetchAll(); // 선택한 범위의 원문 기록
    $hasMore = count($messageRows) > $messageLimit; // 같은 방향의 남은 기록 여부
    if ($hasMore) // 추가 판정 행 존재 여부
    {
        array_pop($messageRows); // 응답 개수 상한 유지
    }
    if ($paginationMode !== 'after') // 이전 방향으로 선택한 기록 여부
    {
        $messageRows = array_reverse($messageRows); // 화면 표시용 ID 오름차순
    }
    $messages = []; // 응답할 메시지 목록
    foreach ($messageRows as $row) // 공개 필드 변환
    {
        $message = public_message($row, $targetColumn); // 현재 대화의 메시지
        if ($includeAttachments) // 확장 응답 선택
        {
            $message['attachment'] = isset($row['attachment_id']) ? attachment_public(['id' => $row['attachment_id'], 'message_id' => $row['id']] + $row) : null; // 파일 정보 또는 첨부 없음
        }
        $messages[] = $message; // 응답 순서 유지
    }
    $pagination = ['mode' => $paginationMode, 'has_more' => $hasMore, 'next_before_id' => $messages === [] ? null : $messages[0]['id'], 'next_after_id' => $messages === [] ? ($afterMessageId ?? '0') : $messages[count($messages) - 1]['id']]; // 실제 반환 목록의 최소·최대 커서
    return ['messages' => $messages, 'pagination' => $pagination]; // 권한이 확인된 페이지 반환
}
function read_messages(PDO $databaseConnection, string $channelId, string $userId, int $messageLimit, ?string $beforeMessageId, ?string $afterMessageId, bool $includeAttachments = false): array // 권한과 페이지를 함께 확인하는 조회
{
    if ($databaseConnection->inTransaction()) // 중첩 트랜잭션 검사
    {
        throw new LogicException('History transaction already active.'); // 내부 호출 오류
    }
    try // 권한 잠금과 조회 결과의 원자적 처리
    {
        $databaseConnection->beginTransaction(); // 권한 확인과 조회 시작
        $channelQuery = $databaseConnection->prepare('SELECT id, server_id FROM channels WHERE id = :id LIMIT 1 FOR SHARE'); // 조회 중 채널 삭제 방지
        $channelQuery->execute(['id' => $channelId]); // 실제 채널 공유 잠금
        $channelRecord = $channelQuery->fetch(); // 현재 채널과 서버
        if ($channelRecord === false) // 채널 존재 확인
        {
            throw new MessageAccessException('CHANNEL_NOT_FOUND', 404); // 롤백 후 존재 오류
        }
        $memberQuery = $databaseConnection->prepare('SELECT user_id FROM server_members WHERE server_id = :server AND user_id = :user LIMIT 1 FOR SHARE'); // 조회 중 탈퇴와 강퇴 방지
        $memberQuery->execute(['server' => (string) $channelRecord['server_id'], 'user' => $userId]); // 현재 소속 공유 잠금
        if ($memberQuery->fetchColumn() === false) // 현재 소속 확인
        {
            throw new MessageAccessException('FORBIDDEN', 403); // 롤백 후 접근 거절
        }
        $page = read_authorized_message_page($databaseConnection, false, $channelId, $messageLimit, $beforeMessageId, $afterMessageId, $includeAttachments); // 잠근 채널의 기록 조회
        $databaseConnection->commit(); // 응답 전 전체 잠금 해제
        return $page; // 커밋을 마친 채널 기록
    }
    catch (Throwable $caughtException) // 권한과 DB 및 변환 실패
    {
        if ($databaseConnection->inTransaction()) // 남은 조회 트랜잭션 확인
        {
            $databaseConnection->rollBack(); // 모든 실패의 잠금 해제
        }
        throw $caughtException; // 공통 응답 처리기로 전달
    }
}
