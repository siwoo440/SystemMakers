<?php // GET 로그인 사용자 채널 목록
declare(strict_types=1); // 엄격한 자료형 검사
require_once __DIR__ . '/../includes/bootstrap.php'; // 공통 API 실행 환경
require_method(['GET']); // 메서드 우선 검사
$databaseConnection = db(); // 실제 소속 DB 연결
$currentUser = require_user($databaseConnection); // 현재 인증 계정 확인
require_query_fields([]); // 외부 사용자와 서버 조건 거절
close_session(); // 목록 조회 전 세션 잠금 해제
$databaseQuery = $databaseConnection->prepare('SELECT c.id, c.server_id, s.name AS server_name, c.name FROM server_members AS m JOIN servers AS s ON s.id = m.server_id JOIN channels AS c ON c.server_id = s.id WHERE m.user_id = :user_id ORDER BY c.server_id ASC, c.id ASC'); // 실제 소속 채널만 조회
$databaseQuery->execute(['user_id' => $currentUser['id']]); // 세션 사용자 기준 조회
$channels = $databaseQuery->fetchAll(); // 소속 없는 계정의 빈 배열 유지
foreach ($channels as &$channelRecord) // 공개 식별자 자료형 통일
{
    $channelRecord['id'] = (string) $channelRecord['id']; // 채널 ID 문자열 보존
    $channelRecord['server_id'] = (string) $channelRecord['server_id']; // 서버 ID 문자열 보존
}
unset($channelRecord); // 반복 참조 해제
respond_success(['channels' => $channels]); // 실제 채널 목록 반환
