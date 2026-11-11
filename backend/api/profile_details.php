<?php // 사용자 공개 상태 조회와 본인 상태 변경
 declare(strict_types=1); // 엄격한 자료형
require_once __DIR__ . '/../includes/bootstrap.php'; // 인증과 요청 검증
require_method(['GET', 'PATCH']); // 허용 메서드
$databaseConnection = db(); // 데이터베이스 연결
$currentUser = require_user($databaseConnection); // 로그인과 계정 확인
if ($_SERVER['REQUEST_METHOD'] === 'GET') // 사용자 공개 상태 조회
{
    require_query_fields(['user_id']); // 허용 조회 필드
    $userId = validate_id($_GET['user_id'] ?? null, 'user_id', false, true); // 대상 식별자
    close_session(); // 세션 잠금 해제
    $databaseQuery = $databaseConnection->prepare("SELECT u.id,u.username,COALESCE(p.status_message,'') AS status_message,(p.picture_data IS NOT NULL) AS has_picture FROM users u LEFT JOIN user_profiles p ON p.user_id=u.id WHERE u.id=:id"); // 공개 정보만 조회
    $databaseQuery->execute(['id' => $userId]); // 대상 계정 적용
    $profile = $databaseQuery->fetch(); // 조회 결과
    if ($profile === false) // 존재하지 않는 계정
    {
        respond_error('NOT_FOUND', '사용자를 찾을 수 없습니다.', 404); // 대상 없음
    }
    $profile['id'] = (string) $profile['id']; // 문자열 식별자
    $profile['has_picture'] = (bool) $profile['has_picture']; // 논리값 변환
    respond_success(['profile' => $profile]); // 공개 상태 응답
}
require_query_fields([]); // 불필요한 조회 조건 차단
$requestBody = read_json_body(); // JSON 요청 읽기
require_csrf(); // 요청 위조 방지
require_body_fields($requestBody, ['status_message']); // 상태 필드만 허용
$statusMessage = validate_string($requestBody['status_message'], 'status_message', 0, 200); // UTF-8과 문자 길이
close_session(); // DB 작업 전 세션 해제
$databaseQuery = $databaseConnection->prepare("INSERT INTO user_profiles (user_id,status_message) VALUES (:id,:status) ON DUPLICATE KEY UPDATE status_message=VALUES(status_message)"); // 본인 상태 저장
$databaseQuery->execute(['id' => $currentUser['id'], 'status' => $statusMessage]); // 세션 계정만 변경
respond_success(['status_message' => $statusMessage]); // 저장 결과
