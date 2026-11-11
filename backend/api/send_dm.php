<?php // POST 개인 메시지 저장 API
declare(strict_types=1); // 엄격한 자료형 검사
require_once __DIR__ . '/../includes/bootstrap.php'; // 인증과 응답
require_once __DIR__ . '/../includes/direct_messages.php'; // 개인 메시지 저장
require_method(['POST']); // 요청 방식 검사
$databaseConnection = db(); // 실제 DB 연결
$currentUser = require_user($databaseConnection); // 로그인 사용자 확인
$requestBody = read_json_body(); // JSON 본문 검사
require_csrf(); // 요청 토큰 검사
require_body_fields($requestBody, ['conversation_id', 'content']); // 허용된 입력 검사
$conversationId = validate_id($requestBody['conversation_id'], 'conversation_id'); // 대화 문자열 ID
$content = validate_message_content($requestBody['content']); // 메시지 원문 검사
close_session(); // 세션 잠금 해제
try // 접근 오류 처리
{
    $message = store_direct_message($databaseConnection, $conversationId, $currentUser['id'], $content); // 참여자와 차단 확인 후 저장
}
catch (DirectAccessException $caughtException) // 대화 접근 오류
{
    respond_direct_error($caughtException); // 일반 오류 응답
}
respond_success(['message' => $message], 201); // 저장 결과 반환
