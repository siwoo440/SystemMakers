<?php // GET 개인 대화 목록 API
declare(strict_types=1); // 엄격한 자료형 검사
require_once __DIR__ . '/../includes/bootstrap.php'; // 인증과 응답
require_once __DIR__ . '/../includes/direct_messages.php'; // 공개 대화 변환
require_method(['GET']); // 요청 방식 검사
$databaseConnection = db(); // 실제 DB 연결
$currentUser = require_user($databaseConnection, false); // 자동 확인의 유휴 연장 없는 로그인 검사
require_query_fields([]); // 불필요한 조회 필드 차단
close_session(); // 세션 잠금 해제
$listQuery = $databaseConnection->prepare( // 참여 대화와 미확인 상태의 한 번 조회
    'SELECT c.id, u.id AS other_id, u.username AS other_username, ' . // 참여 대화와 상대방
    'CASE WHEN peer.id > COALESCE(r.last_read_message_id, 0) THEN peer.id END AS unread_message_id ' . // 읽음 기준보다 새 메시지만 표시
    'FROM direct_conversations c ' . // 참여할 수 있는 대화 목록
    'JOIN users u ON u.id = CASE WHEN c.user_a_id = :owner THEN c.user_b_id ELSE c.user_a_id END ' . // 현재 계정의 상대방
    'LEFT JOIN direct_read_receipts r ON r.conversation_id = c.id AND r.user_id = :reader ' . // 현재 계정의 읽음 기준만 포함
    'LEFT JOIN LATERAL ( ' . // 대화별 상대방의 최신 메시지 한 건만 조회
        'SELECT m.id FROM direct_messages m ' . // 개인 대화 메시지 목록
        'WHERE m.conversation_id = c.id AND m.user_id = u.id ' . // 본인의 작성 이력 제외
        'ORDER BY m.id DESC LIMIT 1 ' . // 최신 상대 메시지 ID
    ') peer ON TRUE ' . // 메시지 없는 대화도 포함
    'WHERE c.user_a_id = :first OR c.user_b_id = :second ' . // 인증된 참여 대화만 포함
    'ORDER BY c.id DESC' // 대화 생성 역순
); // 대화 목록의 준비된 조회문
$listQuery->execute(['owner' => $currentUser['id'], 'reader' => $currentUser['id'], 'first' => $currentUser['id'], 'second' => $currentUser['id']]); // 인증된 사용자 연결
$conversations = array_map(static function (array $row) use ($currentUser): array // 공개 대화와 계정별 알림 상태 변환
{
    $unreadMessageId = $row['unread_message_id'] === null ? null : (string) $row['unread_message_id']; // 정밀도를 보존하는 문자열 알림 기준
    return direct_conversation($row, $currentUser['id']) + ['unread' => $unreadMessageId !== null, 'unread_message_id' => $unreadMessageId]; // 공개 대화와 읽지 않음 여부
}, $listQuery->fetchAll()); // 실제 참여 대화의 응답 배열
respond_success(['conversations' => $conversations]); // 대화 목록 반환
