<?php // GET 실제 채널 메시지 조회 API
declare(strict_types=1); // 엄격한 자료형 검사
require_once __DIR__ . '/../includes/bootstrap.php'; // 공통 인증과 응답
require_once __DIR__ . '/../includes/message_history.php'; // 권한과 커서 조회 처리
require_method(['GET']); // 메서드 우선 검사
$pdo = db(); // 실제 DB 연결
$user = require_user($pdo); // 조회 입력보다 먼저 인증 검사
require_query_fields(['channel_id', 'limit', 'before_id', 'after_id']); // 중복과 미허용 쿼리 차단
$channel_id = validate_id($_GET['channel_id'] ?? null, 'channel_id', false, true); // 채널 문자열 ID 검사
$limit = $_GET['limit'] ?? '50'; // 기본 50개 조회
if (!is_string($limit) || !preg_match('/\A(?:[1-9][0-9]?|100)\z/D', $limit) || (isset($_GET['before_id']) && isset($_GET['after_id']))) // 조회 개수와 방향 충돌 검사
{
    respond_error('INVALID_QUERY', '조회 조건을 확인하세요.', 400); // 잘못된 조회 거절
}
$before = isset($_GET['before_id']) ? validate_id($_GET['before_id'], 'before_id', false, true) : null; // 이전 기록 배타 범위
$after = isset($_GET['after_id']) ? validate_id($_GET['after_id'], 'after_id', true, true) : null; // 초기 0을 허용하는 신규 범위
close_session(); // DB 조회 전 세션 잠금 해제
try // 권한 실패의 롤백 이후 응답
{
    $result = read_messages($pdo, $channel_id, $user['id'], (int) $limit, $before, $after); // 실제 권한과 페이지 조회
}
catch (MessageAccessException $exception) // 잠금이 해제된 접근 오류
{
    respond_error($exception->getMessage(), $exception->getCode() === 404 ? '채널을 찾을 수 없습니다.' : '채널에 접근할 수 없습니다.', $exception->getCode()); // 채널 없음과 소속 없음 구분
}
respond_success($result); // 실제 메시지와 다음 커서 반환
