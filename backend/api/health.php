<?php // 앱 계정에서 보이는 필수 DB 테이블 확인
declare(strict_types=1); // 엄격한 자료형 검사
require_once __DIR__ . '/../includes/bootstrap.php'; // 공통 API 환경
require_method(['GET']); // GET 요청만 허용
require_query_fields([]); // 입력 없는 조회 계약
$tables = ['users', 'servers', 'server_members', 'channels', 'messages', 'auth_rate_limits', 'server_invites', 'management_rate_limits', 'direct_conversations', 'direct_messages', 'user_blocks', 'user_profiles', 'message_attachments', 'friendships', 'direct_read_receipts']; // 서비스에 필요한 실제 테이블
$placeholders = implode(',', array_fill(0, count($tables), '?')); // 테이블별 조회 자리
$query = db()->prepare("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE' AND table_name IN ($placeholders)"); // 현재 DB의 필수 테이블 집계
$query->execute($tables); // 앱 계정으로 보이는 테이블 확인
if ((int) $query->fetchColumn() !== count($tables)) // 초기화 또는 복원 미완료
{
    respond_error('SERVICE_UNAVAILABLE', '서비스 준비 중입니다.', 503); // 내부 정보 없는 준비 보류
}
$attachmentColumns = db()->query("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'message_attachments' AND column_name IN ('storage_key', 'preview_mime')"); // 파일 저장 방식에 필요한 열 확인
if ((int) $attachmentColumns->fetchColumn() !== 2) // 첨부 저장 변경 미적용
{
    respond_error('SERVICE_UNAVAILABLE', '서비스 준비 중입니다.', 503); // 내부 정보 없는 준비 보류
}
respond_success(['status' => 'ok']); // 설정 비노출 상태 반환
