<?php // 본인 차단 목록과 차단 변경
 declare(strict_types=1); // 엄격한 자료형
require_once __DIR__ . '/../includes/bootstrap.php'; // 인증과 요청 검증
require_method(['GET', 'POST', 'DELETE']); // 허용 메서드
$databaseConnection = db(); // 데이터베이스 연결
$currentUser = require_user($databaseConnection); // 로그인과 계정 확인
require_query_fields([]); // 조회 조건 차단
if ($_SERVER['REQUEST_METHOD'] === 'GET') // 본인 차단 목록
{
    close_session(); // 세션 잠금 해제
    $databaseQuery = $databaseConnection->prepare('SELECT u.id,u.username FROM user_blocks b JOIN users u ON u.id=b.blocked_id WHERE b.blocker_id=:id ORDER BY u.id'); // 본인이 차단한 계정만 조회
    $databaseQuery->execute(['id' => $currentUser['id']]); // 세션 계정 적용
    $blockedUsers = $databaseQuery->fetchAll(); // 차단 목록
    foreach ($blockedUsers as &$blockedUser) // 문자열 식별자 통일
    {
        $blockedUser['id'] = (string) $blockedUser['id']; // 큰 식별자 보존
    }
    unset($blockedUser); // 마지막 참조 제거
    respond_success(['users' => $blockedUsers]); // 목록 응답
}
$requestBody = read_json_body(); // JSON 요청 읽기
require_csrf(); // 요청 위조 방지
require_body_fields($requestBody, ['user_id']); // 대상 필드만 허용
$targetUserId = validate_id($requestBody['user_id'], 'user_id'); // 대상 식별자
if ($targetUserId === $currentUser['id']) // 본인 차단 방지
{
    respond_error('VALIDATION_ERROR', '본인은 차단할 수 없습니다.', 422); // 잘못된 대상
}
close_session(); // DB 잠금 전 세션 해제
$userIds = [$currentUser['id'], $targetUserId]; // 잠금 대상
usort($userIds, static function (string $leftId, string $rightId): int // 부호 없는 ID 순서
{
    return strlen($leftId) <=> strlen($rightId) ?: strcmp($leftId, $rightId); // 길이와 사전식 비교
}); // 잠금 순서 확정
try // 차단과 전송 경합 직렬화
{
    $databaseConnection->beginTransaction(); // 트랜잭션 시작
    $databaseQuery = $databaseConnection->prepare('SELECT id FROM users WHERE id=:id FOR UPDATE'); // 계정별 개별 잠금
    foreach ($userIds as $userId) // 작은 ID부터 잠금
    {
        $databaseQuery->execute(['id' => $userId]); // 대상 계정 잠금
        if ($databaseQuery->fetchColumn() === false) // 삭제되었거나 없는 계정
        {
            $databaseConnection->rollBack(); // 잠금 해제
            respond_error('NOT_FOUND', '사용자를 찾을 수 없습니다.', 404); // 대상 없음
        }
    }
    if ($_SERVER['REQUEST_METHOD'] === 'POST') // 본인 차단 추가
    {
        $databaseQuery = $databaseConnection->prepare('INSERT INTO user_blocks (blocker_id,blocked_id) VALUES (:blocker,:blocked) ON DUPLICATE KEY UPDATE blocked_id=VALUES(blocked_id)'); // 중복 차단 허용
    }
    else // 본인 차단 해제
    {
        $databaseQuery = $databaseConnection->prepare('DELETE FROM user_blocks WHERE blocker_id=:blocker AND blocked_id=:blocked'); // 본인의 차단만 해제
    }
    $databaseQuery->execute(['blocker' => $currentUser['id'], 'blocked' => $targetUserId]); // 대상 관계 변경
    $databaseConnection->commit(); // 변경 확정
}
catch (Throwable $caughtException) // DB 실패 처리
{
    if ($databaseConnection->inTransaction()) // 미완료 트랜잭션
    {
        $databaseConnection->rollBack(); // 부분 변경 취소
    }
    throw $caughtException; // 공통 오류 응답
}
respond_success(['user_id' => $targetUserId, 'blocked' => $_SERVER['REQUEST_METHOD'] === 'POST']); // 본인의 변경 결과
