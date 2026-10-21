<?php // 공통 JSON 응답
declare(strict_types=1); // 엄격한 자료형 검사
function send_json(array $payload, int $status): never // 공통 응답 출력
{
    $json = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR); // 안전한 JSON 변환
    if (session_status() === PHP_SESSION_ACTIVE) // 열린 세션 확인
    {
        close_session(); // 응답 전 세션 잠금 해제
    }
    http_response_code($status); // HTTP 상태 지정
    header_remove('X-Powered-By'); // PHP 버전 정보 비노출
    header('Content-Type: application/json; charset=utf-8'); // JSON과 UTF-8 지정
    header('Cache-Control: no-store'); // 응답 저장 차단
    header('X-Content-Type-Options: nosniff'); // 응답 유형 추측 차단
    echo $json; // 공통 JSON 출력
    exit; // 추가 출력 중단
}
function respond_success(array $data, int $status = 200): never // 공통 성공 응답
{
    send_json(['success' => true, 'data' => (object) $data], $status); // 성공 결과 객체 반환
}
function respond_error(string $code, string $message, int $status, array $fields = []): never // 공통 실패 응답
{
    $error = ['code' => $code, 'message' => $message]; // 안정적인 오류 구조
    if ($fields !== []) // 필드 오류 존재 여부
    {
        $error['fields'] = (object) $fields; // 필드별 오류 객체
    }
    send_json(['success' => false, 'error' => $error], $status); // 공통 오류 반환
}
