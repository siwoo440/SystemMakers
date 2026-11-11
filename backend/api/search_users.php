<?php // GET 사용자명 검색 API
declare(strict_types=1); // 엄격한 자료형 검사
require_once __DIR__ . '/../includes/bootstrap.php'; // 인증과 응답
require_method(['GET']); // 요청 방식 검사
$databaseConnection = db(); // 실제 DB 연결
$currentUser = require_user($databaseConnection); // 로그인 사용자 확인
require_query_fields(['q']); // 허용된 조회 필드
$searchTerm = $_GET['q'] ?? null; // 검색어 추출
if (!is_string($searchTerm) || !preg_match('/\A[a-zA-Z0-9_가-힣]{1,32}\z/uD', $searchTerm)) // 사용자명 형식 검사
{
    respond_error('INVALID_QUERY', '검색어를 확인하세요.', 400); // 잘못된 검색 거절
}
close_session(); // 세션 잠금 해제
$searchQuery = $databaseConnection->prepare("SELECT id, username FROM users WHERE id <> :user AND username LIKE :term ESCAPE '!' ORDER BY username, id LIMIT 20"); // 공개 사용자 검색
$searchQuery->execute(['user' => $currentUser['id'], 'term' => str_replace(['!', '%', '_'], ['!!', '!%', '!_'], $searchTerm) . '%']); // 와일드카드 없는 접두사 검색
$users = array_map(static fn(array $row): array => ['id' => (string) $row['id'], 'username' => $row['username']], $searchQuery->fetchAll()); // 공개 정보만 변환
respond_success(['users' => $users]); // 검색 결과 반환
