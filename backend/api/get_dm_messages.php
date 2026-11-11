<?php // GET 개인 대화 기록 API
declare(strict_types=1); // 엄격한 자료형 검사
require_once __DIR__ . '/../includes/bootstrap.php'; // 인증과 응답
require_once __DIR__ . '/../includes/direct_messages.php'; // 개인 기록 조회
require_method(['GET']); // 요청 방식 검사
$databaseConnection = db(); // 실제 DB 연결
$currentUser = require_user($databaseConnection); // 로그인 사용자 확인
require_query_fields(['conversation_id', 'limit', 'before_id', 'after_id']); // 허용된 조회 필드
$conversationId = validate_id($_GET['conversation_id'] ?? null, 'conversation_id', false, true); // 대화 문자열 ID
$messageLimit = $_GET['limit'] ?? '50'; // 기본 조회 개수
if (!is_string($messageLimit) || !preg_match('/\A(?:[1-9][0-9]?|100)\z/D', $messageLimit) || (isset($_GET['before_id']) && isset($_GET['after_id']))) // 범위와 방향 검사
{
    respond_error('INVALID_QUERY', '조회 조건을 확인하세요.', 400); // 잘못된 조회 거절
}
$beforeId = isset($_GET['before_id']) ? validate_id($_GET['before_id'], 'before_id', false, true) : null; // 이전 기록 커서
$afterId = isset($_GET['after_id']) ? validate_id($_GET['after_id'], 'after_id', true, true) : null; // 신규 기록 커서
close_session(); // 세션 잠금 해제
try // 참여자 접근 오류 처리
{
    $page = read_direct_messages($databaseConnection, $conversationId, $currentUser['id'], (int) $messageLimit, $beforeId, $afterId); // 개인 기록 조회
}
catch (DirectAccessException $caughtException) // 대화 접근 오류
{
    respond_direct_error($caughtException); // 일반 오류 응답
}
respond_success($page); // 기록과 커서 반환
