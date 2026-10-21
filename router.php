<?php // 로컬 웹 서버 진입점
declare(strict_types=1); // 엄격한 자료형 검사
header("X-Content-Type-Options: nosniff"); // MIME 자동 추측 차단
header("X-Frame-Options: DENY"); // 외부 프레임 삽입 차단
header("Referrer-Policy: same-origin"); // 외부 참조 정보 제한
header("Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"); // 같은 출처 자원만 허용
$path = rawurldecode((string) parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH)); // 요청 경로 추출
$apiFiles = // 공개 API 허용 목록
[ // API 경로 목록 시작
    '/api/csrf.php' => 'csrf.php', // CSRF 발급 API
    '/api/register.php' => 'register.php', // 회원가입 API
    '/api/login.php' => 'login.php', // 로그인 API
    '/api/logout.php' => 'logout.php', // 로그아웃 API
    '/api/get_current_user.php' => 'get_current_user.php', // 로그인 상태 API
    '/api/health.php' => 'health.php', // DB 연결 확인 API
]; // API 목록 종료
if (isset($apiFiles[$path])) // 허용한 API 여부
{
    require __DIR__ . '/backend/api/' . $apiFiles[$path]; // 고정 경로 PHP 실행
    exit; // 정적 응답 중단
}
if (str_starts_with($path, '/api/')) // 정의되지 않은 API
{
    http_response_code(404); // 없는 API 상태
    header('Content-Type: application/json; charset=utf-8'); // JSON 응답 지정
    header('Cache-Control: no-store'); // 오류 캐시 차단
    echo json_encode(['success' => false, 'error' => ['code' => 'NOT_FOUND', 'message' => '요청한 API가 없습니다.']], JSON_UNESCAPED_UNICODE); // 공통 오류 응답
    exit; // 응답 종료
}
if ($path === '/favicon.ico') // 선택적 브라우저 아이콘 요청
{
    http_response_code(204); // 별도 아이콘 없음
    exit; // 아이콘 응답 종료
}
$staticFiles = // 공개 정적 파일 허용 목록
[ // 정적 파일 목록 시작
    '/' => ['index.html', 'text/html; charset=utf-8'], // 기본 웹 화면
    '/index.html' => ['index.html', 'text/html; charset=utf-8'], // 직접 홈 접근
    '/app.css' => ['app.css', 'text/css; charset=utf-8'], // 웹 화면 스타일
    '/app.js' => ['app.js', 'text/javascript; charset=utf-8'], // 화면 상호작용
]; // 정적 파일 목록 종료
if (!isset($staticFiles[$path])) // 비공개 또는 없는 경로
{
    http_response_code(404); // 파일 미공개 상태
    header('Content-Type: text/plain; charset=utf-8'); // 일반 텍스트 응답
    echo '페이지를 찾을 수 없습니다.'; // 내부 경로 없는 안내
    exit; // 비공개 경로 종료
}
if (!in_array($_SERVER['REQUEST_METHOD'] ?? 'GET', ['GET', 'HEAD'], true)) // 정적 파일 메서드 검사
{
    http_response_code(405); // 허용하지 않은 메서드
    header('Allow: GET, HEAD'); // 허용 메서드 안내
    exit; // 요청 처리 종료
}
[$name, $mime] = $staticFiles[$path]; // 검증된 파일과 형식
header('Content-Type: ' . $mime); // 자원 형식 지정
header('Cache-Control: no-store'); // 개발 중 이전 파일 캐시 차단
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'HEAD') // 본문 전송 여부
{
    readfile(__DIR__ . '/frontend/' . $name); // 허용한 화면 파일 전송
}
