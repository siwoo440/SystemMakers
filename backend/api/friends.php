<?php // 친구 요청과 수락 및 목록
declare(strict_types=1); // 엄격한 자료형 검사
require_once __DIR__ . '/../includes/bootstrap.php'; // 인증과 요청 검증
require_once __DIR__ . '/../includes/direct_messages.php'; // 공통 사용자 잠금
require_method(['GET', 'POST']); // 허용 메서드
$databaseConnection = db(); // 실제 DB 연결
$currentUser = require_user($databaseConnection); // 현재 세션 사용자
require_query_fields([]); // 미허용 조회 조건 차단
if ($_SERVER['REQUEST_METHOD'] === 'GET') // 친구와 요청 목록 조회
{
    close_session(); // 세션 잠금 해제
    $query = $databaseConnection->prepare('SELECT u.id, u.username, f.status, f.requester_id FROM friendships f JOIN users u ON u.id = IF(f.user_a_id = :self, f.user_b_id, f.user_a_id) WHERE f.user_a_id = :first OR f.user_b_id = :second ORDER BY u.username, u.id'); // 본인 관계만 조회
    $query->execute(['self' => $currentUser['id'], 'first' => $currentUser['id'], 'second' => $currentUser['id']]); // 현재 계정 바인딩
    $friends = []; // 수락된 친구
    $incoming = []; // 받은 요청
    $outgoing = []; // 보낸 요청
    foreach ($query->fetchAll() as $row) // 확인된 관계 분류
    {
        $user = ['id' => (string) $row['id'], 'username' => $row['username']]; // 공개 사용자 정보
        if ($row['status'] === 'accepted') // 수락된 관계
        {
            $friends[] = $user; // 양쪽 친구 목록
        }
        elseif ((string) $row['requester_id'] === $currentUser['id']) // 본인이 보낸 요청
        {
            $outgoing[] = $user; // 보낸 요청 목록
        }
        else // 상대방이 보낸 요청
        {
            $incoming[] = $user; // 받은 요청 목록
        }
    }
    respond_success(['friends' => $friends, 'incoming' => $incoming, 'outgoing' => $outgoing]); // 분류된 목록 응답
}
$requestBody = read_json_body(); // 변경 요청 본문
require_csrf(); // 요청 위조 방지
require_body_fields($requestBody, ['user_id', 'action']); // 허용 입력 확인
$targetUserId = validate_id($requestBody['user_id'], 'user_id'); // 상대방 문자열 ID
$action = $requestBody['action']; // 요청 동작
if ($targetUserId === $currentUser['id'] || !in_array($action, ['request', 'accept', 'decline', 'cancel', 'remove'], true)) // 본인 요청과 미허용 동작
{
    respond_error('VALIDATION_ERROR', '친구 요청을 확인하세요.', 422); // 잘못된 입력
}
close_session(); // DB 잠금 전 세션 해제
try // 관계 변경과 차단 검사 원자화
{
    $databaseConnection->beginTransaction(); // 관계 변경 시작
    lock_direct_users($databaseConnection, $currentUser['id'], $targetUserId); // 차단과 동일한 사용자 잠금 순서
    [$firstId, $secondId] = direct_pair($currentUser['id'], $targetUserId); // 정렬된 사용자 쌍
    $query = $databaseConnection->prepare('SELECT requester_id, status FROM friendships WHERE user_a_id=:first AND user_b_id=:second FOR UPDATE'); // 관계 상태 잠금
    $query->execute(['first' => $firstId, 'second' => $secondId]); // 대상 관계 조회
    $relationship = $query->fetch(); // 현재 관계 상태
    if (in_array($action, ['request', 'accept'], true)) // 새 관계 또는 수락 여부
    {
        $blockQuery = $databaseConnection->prepare('SELECT blocker_id FROM user_blocks WHERE (blocker_id=:first AND blocked_id=:second) OR (blocker_id=:second2 AND blocked_id=:first2) LIMIT 1 FOR UPDATE'); // 양방향 차단 검사
        $blockQuery->execute(['first' => $firstId, 'second' => $secondId, 'second2' => $secondId, 'first2' => $firstId]); // 정렬 쌍 바인딩
        if ($blockQuery->fetchColumn() !== false) // 어느 쪽이든 차단 상태
        {
            throw new DirectAccessException('FORBIDDEN', 403); // 상세 사유 비공개
        }
    }
    if ($action === 'request' && $relationship === false) // 새 친구 요청
    {
        $insert = $databaseConnection->prepare('INSERT INTO friendships (user_a_id, user_b_id, requester_id) VALUES (:first, :second, :requester)'); // 대기 관계 생성
        $insert->execute(['first' => $firstId, 'second' => $secondId, 'requester' => $currentUser['id']]); // 요청자 저장
    }
    elseif ($action === 'accept' && $relationship !== false && $relationship['status'] === 'pending' && (string) $relationship['requester_id'] === $targetUserId) // 받은 요청만 수락
    {
        $update = $databaseConnection->prepare("UPDATE friendships SET status='accepted' WHERE user_a_id=:first AND user_b_id=:second"); // 양쪽 친구 확정
        $update->execute(['first' => $firstId, 'second' => $secondId]); // 수락 상태 저장
    }
    elseif ($relationship !== false && (($action === 'decline' && $relationship['status'] === 'pending' && (string) $relationship['requester_id'] === $targetUserId) || ($action === 'cancel' && $relationship['status'] === 'pending' && (string) $relationship['requester_id'] === $currentUser['id']) || ($action === 'remove' && $relationship['status'] === 'accepted'))) // 관계별 삭제 권한
    {
        $delete = $databaseConnection->prepare('DELETE FROM friendships WHERE user_a_id=:first AND user_b_id=:second'); // 요청 또는 친구 관계 제거
        $delete->execute(['first' => $firstId, 'second' => $secondId]); // 확인한 관계만 삭제
    }
    else // 잘못된 순서 또는 중복 요청
    {
        throw new DirectAccessException('FRIEND_STATE_CONFLICT', 409); // 최신 관계 재확인
    }
    $databaseConnection->commit(); // 관계 확정
    respond_success(['user_id' => $targetUserId, 'action' => $action]); // 변경 결과
}
catch (Throwable $caughtException) // 모든 실패의 잠금 해제
{
    if ($databaseConnection->inTransaction()) // 남은 트랜잭션
    {
        $databaseConnection->rollBack(); // 부분 변경 취소
    }
    if ($caughtException instanceof DirectAccessException) // 공개 권한 또는 상태 오류
    {
        respond_error($caughtException->getMessage(), '친구 관계를 확인하세요.', $caughtException->getCode()); // 상세 비공개 안내
    }
    throw $caughtException; // 내부 오류 공통 처리
}
