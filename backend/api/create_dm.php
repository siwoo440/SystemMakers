<?php // POST 개인 대화 생성 API
declare(strict_types=1); // 엄격한 자료형 검사
require_once __DIR__ . '/../includes/bootstrap.php'; // 인증과 응답
require_once __DIR__ . '/../includes/direct_messages.php'; // 개인 대화 처리
require_method(['POST']); // 요청 방식 검사
$databaseConnection = db(); // 실제 DB 연결
$currentUser = require_user($databaseConnection); // 로그인 사용자 확인
$requestBody = read_json_body(); // JSON 본문 검사
require_csrf(); // 요청 토큰 검사
require_body_fields($requestBody, ['user_id']); // 허용된 입력 검사
$otherId = validate_id($requestBody['user_id'], 'user_id'); // 상대방 문자열 ID
close_session(); // 세션 잠금 해제
try // 생성 권한 오류 처리
{
    $conversation = create_direct_conversation($databaseConnection, $currentUser['id'], $otherId); // 대화 생성 또는 재사용
}
catch (DirectAccessException $caughtException) // 입력과 대상 오류
{
    respond_direct_error($caughtException); // 비밀 없는 오류
}
respond_success(['conversation' => $conversation], 201); // 대화 응답
