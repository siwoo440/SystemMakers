<?php // 세션별 CSRF 보호
declare(strict_types=1); // 엄격한 자료형 검사
function csrf_token(): string // 안정적인 세션 토큰 조회
{
    start_secure_session(); // 세션 시작과 잠금 확보
    $token = $_SESSION['csrf_token'] ?? null; // 기존 토큰 확인
    if (!is_string($token) || !preg_match('/\A[a-f0-9]{64}\z/D', $token)) // 미발급과 잘못된 토큰
    {
        $token = bin2hex(random_bytes(32)); // 32바이트 보안 난수
        $_SESSION['csrf_token'] = $token; // 현재 세션에만 저장
    }
    return $token; // 같은 세션의 기존 토큰 유지
}
function require_csrf(): void // 상태 변경 요청 보호
{
    start_secure_session(); // 세션 토큰 읽기
    $expected = $_SESSION['csrf_token'] ?? null; // 서버 보관 토큰
    $provided = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? null; // 요청 헤더 토큰
    if (!is_string($expected) || !preg_match('/\A[a-f0-9]{64}\z/D', $expected) || !is_string($provided) || !hash_equals($expected, $provided)) // 자료형과 상수 시간 비교
    {
        respond_error('CSRF_INVALID', '요청 확인 토큰이 올바르지 않습니다.', 403); // 잘못된 토큰 차단
    }
}
