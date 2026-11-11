<?php // GET 개인 대화 목록 API
declare(strict_types=1); // 엄격한 자료형 검사
require_once __DIR__ . '/../includes/bootstrap.php'; // 인증과 응답
require_once __DIR__ . '/../includes/direct_messages.php'; // 공개 대화 변환
require_method(['GET']); // 요청 방식 검사
$databaseConnection = db(); // 실제 DB 연결
$currentUser = require_user($databaseConnection); // 로그인 사용자 확인
require_query_fields([]); // 불필요한 조회 필드 차단
close_session(); // 세션 잠금 해제
$listQuery = $databaseConnection->prepare('SELECT c.id, u.id AS other_id, u.username AS other_username FROM direct_conversations c JOIN users u ON u.id = CASE WHEN c.user_a_id = :user1 THEN c.user_b_id ELSE c.user_a_id END WHERE c.user_a_id = :user2 OR c.user_b_id = :user3 ORDER BY c.id DESC'); // 참여 대화와 상대방 조회
$listQuery->execute(['user1' => $currentUser['id'], 'user2' => $currentUser['id'], 'user3' => $currentUser['id']]); // 인증된 사용자 연결
$conversations = array_map(static fn(array $row): array => direct_conversation($row, $currentUser['id']), $listQuery->fetchAll()); // 공개 대화 목록
respond_success(['conversations' => $conversations]); // 대화 목록 반환
