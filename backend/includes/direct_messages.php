<?php // 개인 대화 저장과 권한 처리
declare(strict_types=1); // 엄격한 자료형 검사
require_once __DIR__ . '/message_history.php'; // 메시지 검증과 공통 페이지 조회
final class DirectAccessException extends RuntimeException // 개인 대화 접근 오류
{
}
function direct_pair(string $firstId, string $secondId): array // 큰 정수 변환 없는 참여자 정렬
{
    $firstIsSmaller = strlen($firstId) < strlen($secondId) || (strlen($firstId) === strlen($secondId) && strcmp($firstId, $secondId) < 0); // 십진 문자열 비교
    return $firstIsSmaller ? [$firstId, $secondId] : [$secondId, $firstId]; // 작은 ID 우선
}
function lock_direct_users(PDO $databaseConnection, string $firstId, string $secondId): void // 차단 변경과 공통 사용자 잠금
{
    foreach (direct_pair($firstId, $secondId) as $userId) // 작은 ID부터 잠금
    {
        $userQuery = $databaseConnection->prepare('SELECT id FROM users WHERE id = :id FOR UPDATE'); // 사용자 배타 잠금
        $userQuery->execute(['id' => $userId]); // 현재 사용자 잠금
        if ($userQuery->fetchColumn() === false) // 삭제 또는 없는 사용자
        {
            throw new DirectAccessException('USER_NOT_FOUND', 404); // 사용자 없음
        }
    }
}
function direct_conversation(array $databaseRow, string $userId): array // 상대방만 포함한 대화 응답
{
    return ['id' => (string) $databaseRow['id'], 'other_user' => ['id' => (string) $databaseRow['other_id'], 'username' => $databaseRow['other_username']]]; // 공개 대화 필드
}
function direct_message(array $databaseRow): array // 공개 메시지 변환
{
    return public_message($databaseRow, 'conversation_id'); // 개인 대화의 공개 메시지
}
function create_direct_conversation(PDO $databaseConnection, string $userId, string $otherId): array // 중복 없는 대화 생성
{
    if ($userId === $otherId) // 본인 대화 검사
    {
        throw new DirectAccessException('VALIDATION_ERROR', 422); // 본인 대화 거절
    }
    try // 사용자 잠금과 생성 원자화
    {
        $databaseConnection->beginTransaction(); // 생성 트랜잭션 시작
        lock_direct_users($databaseConnection, $userId, $otherId); // 쌍의 사용자 순차 잠금
        [$firstId, $secondId] = direct_pair($userId, $otherId); // 정렬된 참여자 쌍
        $insertQuery = $databaseConnection->prepare('INSERT INTO direct_conversations (user_a_id, user_b_id) VALUES (:first, :second) ON DUPLICATE KEY UPDATE id = id'); // 고유 쌍 생성 또는 재사용
        $insertQuery->execute(['first' => $firstId, 'second' => $secondId]); // 실제 대화 확보
        $selectQuery = $databaseConnection->prepare('SELECT c.id, u.id AS other_id, u.username AS other_username FROM direct_conversations c JOIN users u ON u.id = :other_id WHERE c.user_a_id = :first AND c.user_b_id = :second'); // 대화와 상대방 조회
        $selectQuery->execute(['other_id' => $otherId, 'first' => $firstId, 'second' => $secondId]); // 정렬 쌍 확인
        $row = $selectQuery->fetch(); // 대화 응답 원본
        if ($row === false) // 생성 결과 누락
        {
            throw new RuntimeException('Conversation unavailable.'); // 저장 실패 처리
        }
        $result = direct_conversation($row, $userId); // 공개 응답 생성
        $databaseConnection->commit(); // 저장 확정
        return $result; // 커밋된 대화 반환
    }
    catch (Throwable $caughtException) // 모든 실패 처리
    {
        if ($databaseConnection->inTransaction()) // 남은 트랜잭션
        {
            $databaseConnection->rollBack(); // 생성과 잠금 취소
        }
        throw $caughtException; // 공통 오류 전달
    }
}
function direct_access(PDO $databaseConnection, string $conversationId, string $userId, bool $forWrite): array // 참여자와 전송 권한 확인
{
    $pairSql = 'SELECT user_a_id, user_b_id FROM direct_conversations WHERE id = :id'; // 대화의 참여자 조회문
    $lookup = $databaseConnection->prepare($forWrite ? $pairSql : $pairSql . ' FOR SHARE'); // 읽기 권한과 공유 잠금을 한 번에 확인
    $lookup->execute(['id' => $conversationId]); // 대상 대화 조회
    $pair = $lookup->fetch(); // 현재 참여자 쌍
    if ($pair === false) // 대화 존재 여부
    {
        throw new DirectAccessException('CONVERSATION_NOT_FOUND', 404); // 존재하지 않는 대화
    }
    if ($userId !== (string) $pair['user_a_id'] && $userId !== (string) $pair['user_b_id']) // 세션 참여자 여부
    {
        throw new DirectAccessException('FORBIDDEN', 403); // 제3자 접근 차단
    }
    if (!$forWrite) // 공유 잠금으로 확인한 읽기 요청
    {
        return $pair; // 현재 참여자 반환
    }
    lock_direct_users($databaseConnection, (string) $pair['user_a_id'], (string) $pair['user_b_id']); // 차단 변경과 같은 순서의 사용자 잠금
    $locked = $databaseConnection->prepare($pairSql . ' FOR UPDATE'); // 전송할 대화의 배타 잠금
    $locked->execute(['id' => $conversationId]); // 현재 대화 잠금
    $pair = $locked->fetch(); // 잠금 후 실제 관계
    if ($pair === false) // 대화 삭제 경합
    {
        throw new DirectAccessException('CONVERSATION_NOT_FOUND', 404); // 삭제된 대화
    }
    if ($userId !== (string) $pair['user_a_id'] && $userId !== (string) $pair['user_b_id']) // 잠금 후 참여자 재검사
    {
        throw new DirectAccessException('FORBIDDEN', 403); // 제3자 접근 차단
    }
    $blockQuery = $databaseConnection->prepare('SELECT blocker_id FROM user_blocks WHERE (blocker_id = :first AND blocked_id = :second) OR (blocker_id = :second2 AND blocked_id = :first2) LIMIT 1 FOR UPDATE'); // 양방향 차단 확인
    $blockQuery->execute(['first' => $pair['user_a_id'], 'second' => $pair['user_b_id'], 'second2' => $pair['user_b_id'], 'first2' => $pair['user_a_id']]); // 참여자 쌍 바인딩
    if ($blockQuery->fetchColumn() !== false) // 어느 쪽이든 차단 상태
    {
        throw new DirectAccessException('FORBIDDEN', 403); // 상세 사유 없는 전송 거절
    }
    return $pair; // 권한 확인된 참여자
}
function store_direct_message(PDO $databaseConnection, string $conversationId, string $userId, string $content): array // 참여자와 차단을 검사한 저장
{
    try // 권한과 저장 원자화
    {
        $databaseConnection->beginTransaction(); // 전송 트랜잭션 시작
        direct_access($databaseConnection, $conversationId, $userId, true); // 참여자와 차단 확인
        $insert = $databaseConnection->prepare('INSERT INTO direct_messages (conversation_id, user_id, content) VALUES (:conversation, :user, :content)'); // 본문 저장
        $insert->execute(['conversation' => $conversationId, 'user' => $userId, 'content' => $content]); // 인증된 작성자 저장
        $query = $databaseConnection->prepare('SELECT m.id, m.conversation_id, m.user_id, u.username, m.content, m.created_at FROM direct_messages m JOIN users u ON u.id = m.user_id WHERE m.id = :id'); // 저장 결과 조회
        $query->execute(['id' => $databaseConnection->lastInsertId()]); // 생성 ID 조회
        $row = $query->fetch(); // 저장 결과
        if ($row === false) // 저장 결과 누락
        {
            throw new RuntimeException('Message unavailable.'); // 전체 저장 취소
        }
        $message = direct_message($row); // 공개 메시지 변환
        $databaseConnection->commit(); // 저장 확정
        return $message; // 커밋된 메시지
    }
    catch (Throwable $caughtException) // 모든 실패 처리
    {
        if ($databaseConnection->inTransaction()) // 남은 트랜잭션
        {
            $databaseConnection->rollBack(); // 저장과 잠금 취소
        }
        throw $caughtException; // 호출자 오류 전달
    }
}
function read_direct_messages(PDO $databaseConnection, string $conversationId, string $userId, int $messageLimit, ?string $beforeId, ?string $afterId, bool $includeAttachments = false): array // 커서 기반 개인 기록
{
    try // 조회와 권한 확인 원자화
    {
        $databaseConnection->beginTransaction(); // 조회 트랜잭션 시작
        direct_access($databaseConnection, $conversationId, $userId, false); // 참여자 확인
        $page = read_authorized_message_page($databaseConnection, true, $conversationId, $messageLimit, $beforeId, $afterId, $includeAttachments); // 참여 권한을 확인한 개인 기록
        $databaseConnection->commit(); // 조회 잠금 해제
        return $page; // 커밋을 마친 개인 기록
    }
    catch (Throwable $caughtException) // 모든 조회 실패
    {
        if ($databaseConnection->inTransaction()) // 남은 트랜잭션
        {
            $databaseConnection->rollBack(); // 조회 잠금 해제
        }
        throw $caughtException; // 호출자 오류 전달
    }
}
function respond_direct_error(DirectAccessException $caughtException): never // 비밀 없는 접근 오류
{
    respond_error($caughtException->getMessage(), $caughtException->getCode() === 404 ? '대상을 찾을 수 없습니다.' : ($caughtException->getCode() === 422 ? '입력값을 확인하세요.' : '요청을 처리할 수 없습니다.'), $caughtException->getCode()); // 일반 오류 응답
}
