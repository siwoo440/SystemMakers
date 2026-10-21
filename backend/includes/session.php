<?php // 안전한 PHP 세션 처리
declare(strict_types=1); // 엄격한 자료형 검사
function start_secure_session(): void // 공통 세션 시작
{
    if (session_status() === PHP_SESSION_ACTIVE) // 기존 세션 상태
    {
        return; // 중복 시작 방지
    }
    $environment = getenv('APP_ENV') ?: 'production'; // 기본 운영 환경
    $secure_setting = getenv('SESSION_COOKIE_SECURE'); // 명시된 개발 쿠키 설정
    $secure = true; // 운영 기본 Secure 속성
    if ($secure_setting !== false) // 쿠키 설정 존재 여부
    {
        if (!in_array($secure_setting, ['0', '1'], true)) // 허용 값 검사
        {
            throw new RuntimeException('Invalid session configuration.'); // 잘못된 보안 설정 차단
        }
        if ($secure_setting === '0' && in_array($environment, ['development', 'test'], true)) // 로컬 HTTP 개발 조건
        {
            $secure = false; // 명시적 개발 환경 Secure 해제
        }
    }
    ini_set('session.use_strict_mode', '1'); // 미발급 세션 ID 거절
    ini_set('session.use_only_cookies', '1'); // 쿠키로만 세션 전달
    ini_set('session.use_trans_sid', '0'); // URL 세션 전달 차단
    ini_set('session.gc_maxlifetime', '43200'); // 세션 저장 최대 수명
    session_name('systemmakers_session'); // 서비스 전용 쿠키 이름
    session_set_cookie_params(['lifetime' => 0, 'path' => '/', 'secure' => $secure, 'httponly' => true, 'samesite' => 'Lax']); // 세션 쿠키 보안 속성
    if (!session_start()) // 실제 세션 저장소 연결
    {
        throw new RuntimeException('Session unavailable.'); // 세션 저장 실패 처리
    }
}
function close_session(): void // 세션 잠금 명시적 해제
{
    if (session_status() === PHP_SESSION_ACTIVE && !session_write_close()) // 세션 기록과 잠금 해제
    {
        throw new RuntimeException('Session unavailable.'); // 세션 저장 실패 처리
    }
}
