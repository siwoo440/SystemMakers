<?php // API 공통 실행 환경
declare(strict_types=1); // 엄격한 자료형 검사
require_once __DIR__ . '/response.php'; // 공통 JSON 응답 함수
ini_set('display_errors', '0'); // 내부 오류 화면 출력 차단
ini_set('display_startup_errors', '0'); // 시작 오류 화면 출력 차단
error_reporting(E_ALL); // 내부 오류 전체 감지
set_error_handler(function (int $severity, string $message, string $file, int $line): bool // PHP 경고 공통 예외 변환
{
    if (!(error_reporting() & $severity)) // 명시적으로 억제된 오류
    {
        return false; // PHP 기본 억제 처리
    }
    throw new ErrorException($message, 0, $severity, $file, $line); // 화면 출력 없는 예외 전환
}); // 경고 처리기 등록
set_exception_handler(function (Throwable $exception): void // 처리되지 않은 내부 예외
{
    error_log('SystemMakers internal API failure.'); // 비밀 없는 서버 진단
    respond_error('INTERNAL_ERROR', '요청을 처리할 수 없습니다.', 500); // 상세 원인 비노출
}); // 예외 처리기 등록
register_shutdown_function(function (): void // 치명적인 종료 오류 처리
{
    $error = error_get_last(); // 마지막 PHP 오류
    if ($error !== null && in_array($error['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true) && !headers_sent()) // 응답 가능한 치명 오류
    {
        respond_error('INTERNAL_ERROR', '요청을 처리할 수 없습니다.', 500); // 일반 JSON 오류 반환
    }
}); // 종료 처리기 등록
date_default_timezone_set('UTC'); // PHP 날짜 UTC 기준
require_once __DIR__ . '/../config/database.php'; // PDO 연결 함수
require_once __DIR__ . '/session.php'; // 보안 세션 함수
require_once __DIR__ . '/request.php'; // HTTP 입력 검증
require_once __DIR__ . '/csrf.php'; // CSRF 토큰 함수
require_once __DIR__ . '/auth.php'; // 실제 사용자 인증
require_once __DIR__ . '/permissions.php'; // 채널 소속 권한
