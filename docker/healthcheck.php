<?php // 컨테이너의 실제 응답 검사
declare(strict_types=1); // 엄격한 자료형 검사
if (($argv[1] ?? '') === 'realtime') // 실시간 프로세스 검사
{
    $socket = @fsockopen('127.0.0.1', 8090, $errorCode, $errorMessage, 3); // 내부 수신 상태 확인
    if ($socket === false) // 연결 실패 여부
    {
        exit(1); // 비정상 상태
    }
    fclose($socket); // 검사 연결 종료
    exit(0); // 수신 상태 정상
}
$context = stream_context_create(['http' => ['timeout' => 5, 'ignore_errors' => true]]); // 제한된 HTTP 검사
$response = @file_get_contents('http://127.0.0.1/Team006/backend/api/health.php', false, $context); // 실제 PHP와 DB 응답
$payload = is_string($response) ? json_decode($response, true) : null; // 상태 응답 해석
exit(($payload['success'] ?? false) === true && ($payload['data']['status'] ?? '') === 'ok' ? 0 : 1); // 앱 준비 상태 반환
