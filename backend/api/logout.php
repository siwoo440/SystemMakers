<?php // POST 세션 로그아웃 API
declare(strict_types=1); // 엄격한 자료형 검사
require_once __DIR__ . '/../includes/bootstrap.php'; // 공통 실행 환경
require_method(['POST']); // 메서드 우선 검사
require_user(db()); // 본문보다 로그인 확인 우선
$body = read_json_body(); // 실제 JSON 객체 읽기
require_csrf(); // 현재 인증 세션 토큰 확인
require_body_fields($body); // 빈 객체 이외의 입력 거절
$_SESSION = []; // 인증과 CSRF 데이터 전체 제거
$parameters = session_get_cookie_params(); // 발급 때와 같은 쿠키 속성
if (!session_destroy()) // 서버 세션 저장 데이터 삭제
{
    throw new RuntimeException('Session unavailable.'); // 세션 폐기 실패의 공통 오류
}
if (!setcookie(session_name(), '', ['expires' => 1, 'path' => $parameters['path'], 'secure' => $parameters['secure'], 'httponly' => $parameters['httponly'], 'samesite' => $parameters['samesite']])) // 호스트 전용 쿠키 만료
{
    throw new RuntimeException('Session unavailable.'); // 쿠키 종료 실패의 공통 오류
}
respond_success(['message' => '로그아웃되었습니다.']); // 인증 상태 폐기 완료 응답
