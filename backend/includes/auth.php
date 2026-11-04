<?php // 세션 기반 실제 사용자 인증
declare(strict_types=1); // 엄격한 자료형 검사
function clear_authentication(): void // 만료된 인증 상태 폐기
{
    $_SESSION = []; // 만료된 인증 정보 제거
    if (!session_regenerate_id(true)) // 이전 세션 식별자 폐기
    {
        throw new RuntimeException('Session unavailable.'); // 세션 교체 실패 처리
    }
}
function current_user(PDO $databaseConnection, bool $refresh = false): ?array // 선택적인 실제 사용자 조회
{
    start_secure_session(); // 서버 세션 읽기
    $hasAuthentication = array_key_exists('user_id', $_SESSION) || array_key_exists('authenticated_at', $_SESSION) || array_key_exists('last_activity_at', $_SESSION); // 인증 정보 존재 여부
    if (!$hasAuthentication) // 인증 이력 없는 일반 게스트
    {
        return null; // 기존 세션과 CSRF를 보존한 게스트
    }
    $authenticatedUserId = $_SESSION['user_id'] ?? null; // 인증된 사용자 식별자
    $authenticatedAt = $_SESSION['authenticated_at'] ?? null; // 로그인 시각
    $lastActivityAt = $_SESSION['last_activity_at'] ?? null; // 마지막 인증 활동 시각
    $currentTime = time(); // 현재 서버 시각
    if (!valid_id($authenticatedUserId) || !is_int($authenticatedAt) || !is_int($lastActivityAt) || $authenticatedAt <= 0 || $lastActivityAt < $authenticatedAt || $authenticatedAt > $currentTime || $lastActivityAt > $currentTime || $currentTime - $authenticatedAt >= 43200 || $currentTime - $lastActivityAt >= 1800) // 로그인 최대 수명과 유휴 수명
    {
        clear_authentication(); // 만료 또는 손상 인증 폐기
        return null; // 인증 이력 없는 게스트 전환
    }
    $userQuery = $databaseConnection->prepare('SELECT id, username, email, created_at FROM users WHERE id = :id LIMIT 1'); // 비밀 열 제외 사용자 조회
    $userQuery->bindValue(':id', $authenticatedUserId, PDO::PARAM_STR); // 문자열 ID 매개변수
    $userQuery->execute(); // 실제 계정 조회
    $authenticatedUser = $userQuery->fetch(); // DB 계정 결과
    if ($authenticatedUser === false) // 삭제 계정 여부
    {
        clear_authentication(); // 존재하지 않는 사용자 인증 폐기
        return null; // 삭제 계정의 게스트 전환
    }
    $authenticatedUser['id'] = (string) $authenticatedUser['id']; // 큰 식별자 문자열 보존
    $authenticatedUser['created_at'] = (new DateTimeImmutable($authenticatedUser['created_at'], new DateTimeZone('UTC')))->format('Y-m-d\TH:i:s\Z'); // UTC 응답 시각
    if ($refresh) // 보호된 인증 요청 여부
    {
        $_SESSION['last_activity_at'] = $currentTime; // 인증 성공 시에만 활동 갱신
    }
    return $authenticatedUser; // 공개 본인 계정 정보
}
function require_user(PDO $databaseConnection): array // 필수 로그인 사용자 검증
{
    $authenticatedUser = current_user($databaseConnection, true); // 계정과 인증 수명 확인
    if ($authenticatedUser === null) // 일반 게스트 또는 만료 인증
    {
        respond_error('UNAUTHORIZED', '로그인이 필요합니다.', 401); // 공통 비로그인 응답
    }
    if (array_key_exists('HTTP_X_EXPECTED_USER_ID', $_SERVER)) // 화면이 확인한 계정 헤더 존재 여부
    {
        $expectedUserId = $_SERVER['HTTP_X_EXPECTED_USER_ID']; // 요청 화면의 기대 사용자 ID
        if (!valid_id($expectedUserId) || !hash_equals($authenticatedUser['id'], $expectedUserId)) // 현재 세션과 화면 계정 불일치
        {
            respond_error('SESSION_CHANGED', '로그인 계정이 변경되었습니다. 다시 확인하세요.', 403); // 자료 조회와 저장 전 계정 혼동 차단
        }
    }
    return $authenticatedUser; // 검증된 공개 사용자 정보
}
function require_guest(PDO $databaseConnection): void // 로그인 중 가입과 재로그인 차단
{
    if (current_user($databaseConnection) !== null) // 유효한 실제 로그인 존재
    {
        respond_error('ALREADY_AUTHENTICATED', '이미 로그인되어 있습니다.', 409); // 게스트 전용 요청 거절
    }
}
