<?php // POST 실제 메시지 저장 API
declare(strict_types=1); // 엄격한 자료형 검사
require_once __DIR__ . '/../includes/bootstrap.php'; // 공통 실행 환경
require_once __DIR__ . '/../includes/messages.php'; // 메시지 검증과 저장 함수
require_method(['POST']); // 메서드 우선 검사
$pdo = db(); // 실제 메시지 저장 연결
$user = require_user($pdo); // 본문보다 먼저 실제 세션 사용자 검사
$body = read_json_body(); // 최대 32 KiB JSON과 UTF-8 검증
require_csrf(); // 입력 필드보다 먼저 요청 토큰 검사
require_body_fields($body, ['channel_id', 'content']); // 필수 필드와 작성자 위조 필드 검사
$channel_id = validate_id($body['channel_id'], 'channel_id'); // 정규 uint64 문자열 식별자
$content = validate_message_content($body['content']); // 원문 메시지 내용 검증
close_session(); // DB 트랜잭션 전 세션 잠금 해제
try // 권한 오류의 롤백 이후 응답
{
    $message = store_message($pdo, $channel_id, $user['id'], $content); // 채널별 직렬화와 실제 커밋
}
catch (MessageAccessException $exception) // 트랜잭션 종료가 보장된 권한 오류
{
    respond_error($exception->getMessage(), $exception->getCode() === 404 ? '채널을 찾을 수 없습니다.' : '채널에 접근할 수 없습니다.', $exception->getCode()); // 채널 없음과 멤버십 없음 구분
}
respond_success(['message' => $message], 201); // 저장 커밋 후 공개 메시지 응답
