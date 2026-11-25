<?php // POST 개인 대화 읽음 상태 API
declare(strict_types=1); // 엄격한 자료형 검사
require_once __DIR__ . '/../includes/bootstrap.php'; // 인증과 응답
require_once __DIR__ . '/../includes/direct_messages.php'; // 개인 대화 권한과 읽음 처리
require_method(['POST']); // 읽음 상태 변경 방식 검사
$databaseConnection = db(); // 실제 DB 연결
$currentUser = require_user($databaseConnection, false); // 자동 읽음 처리의 유휴 연장 없는 로그인 검사
$requestBody = read_json_body(); // JSON 본문 검사
require_csrf(); // 변경 요청의 보호 토큰 검사
require_body_fields($requestBody, ['conversation_id', 'message_id']); // 허용한 입력 필드 검사
$conversationId = validate_id($requestBody['conversation_id'], 'conversation_id'); // 대화 문자열 ID
$messageId = validate_id($requestBody['message_id'], 'message_id'); // 표시한 상대방 메시지 ID
close_session(); // DB 작업 전 세션 잠금 해제
try // 권한 확인과 읽음 상태 변경
{
    mark_direct_read($databaseConnection, $conversationId, $currentUser['id'], $messageId); // 참여자 전용 읽음 기준 저장
}
catch (DirectAccessException $caughtException) // 개인 대화 접근 오류
{
    respond_direct_error($caughtException); // 내부 정보 없는 오류 응답
}
respond_success(['last_read_message_id' => $messageId]); // 이번에 확인한 메시지 ID 반환
