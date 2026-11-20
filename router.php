<?php // 로컬 웹 서버 진입점
declare(strict_types=1); // 엄격한 자료형 검사
require_once __DIR__ . '/backend/includes/deployment.php'; // 운영 출처 검증 도구
header("X-Content-Type-Options: nosniff"); // MIME 자동 추측 차단
header("X-Frame-Options: DENY"); // 외부 프레임 삽입 차단
header("Referrer-Policy: same-origin"); // 외부 참조 정보 제한
$realtimePublicHost = getenv('REALTIME_PUBLIC_HOST') ?: '127.0.0.6'; // 명시된 실시간 서버 주소
if (filter_var($realtimePublicHost, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) === false) // 유효하지 않은 설정 검사
{
    $realtimePublicHost = '127.0.0.6'; // 안전한 기본 주소
}
try // 운영 설정 오류의 비공개 처리
{
    $publicOrigin = deployment_public_origin(); // 명시된 공개 출처 확인
}
catch (Throwable $caughtException) // 잘못된 운영 주소
{
    http_response_code(503); // 설정 오류 상태
    exit('Service unavailable.'); // 내부 설정 비노출
}
$realtimeSource = $publicOrigin === null ? "ws://$realtimePublicHost:8090" : preg_replace('/\Ahttp/', 'ws', $publicOrigin); // 검증된 같은 출처 연결
header("Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' $realtimeSource; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"); // 지정된 실시간 연결 허용
$requestPath = rawurldecode((string) parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH)); // 요청 경로 추출
if ($requestPath === '/Team006') // 팀 폴더 주소 확인
{
    header('Location: /Team006/', true, 308); // 상대경로 기준을 위한 끝 슬래시 이동
    exit; // 이동 응답 종료
}
if (str_starts_with($requestPath, '/Team006/')) // 정확한 팀 폴더 접두사 확인
{
    $requestPath = substr($requestPath, strlen('/Team006')); // 허용 목록 기준 경로 추출
}
if (str_starts_with($requestPath, '/backend/api/')) // 실제 API 폴더 접근 확인
{
    $requestPath = '/api/' . substr($requestPath, strlen('/backend/api/')); // 기존 API 허용 목록 연결
}
elseif (str_starts_with($requestPath, '/frontend/')) // 화면 자원 폴더 접근 확인
{
    $requestPath = substr($requestPath, strlen('/frontend')); // 기존 정적 파일 허용 목록 연결
}
$apiFiles = // 공개 API 허용 목록
[ // API 경로 목록 시작
    '/api/csrf.php' => 'csrf.php', // CSRF 발급 API
    '/api/register.php' => 'register.php', // 회원가입 API
    '/api/login.php' => 'login.php', // 로그인 API
    '/api/logout.php' => 'logout.php', // 로그아웃 API
    '/api/get_current_user.php' => 'get_current_user.php', // 로그인 상태 API
    '/api/get_channels.php' => 'get_channels.php', // 소속 채널 목록 API
    '/api/send_message.php' => 'send_message.php', // 채널 메시지 저장 API
    '/api/get_messages.php' => 'get_messages.php', // 채널 메시지 조회 API
    '/api/health.php' => 'health.php', // DB 연결 확인 API
    '/api/list_servers.php' => 'list_servers.php', // 내 서버 목록
    '/api/create_server.php' => 'create_server.php', // 서버와 기본 채널 생성
    '/api/get_server_invite.php' => 'get_server_invite.php', // 초대 상태
    '/api/create_server_invite.php' => 'create_server_invite.php', // 초대 코드 발급
    '/api/revoke_server_invite.php' => 'revoke_server_invite.php', // 코드 폐기
    '/api/join_server.php' => 'join_server.php', // 초대 참여
    '/api/leave_server.php' => 'leave_server.php', // 본인 소속 탈퇴
    '/api/get_deletion_preview.php' => 'get_deletion_preview.php', // 삭제 영향 미리보기
    '/api/delete_server.php' => 'delete_server.php', // 소유자 서버 삭제
    '/api/create_channel.php' => 'create_channel.php', // 관리자 채널 생성
    '/api/update_channel.php' => 'update_channel.php', // 관리자 채널 이름 변경
    '/api/delete_channel.php' => 'delete_channel.php', // 관리자 채널 삭제
    '/api/search_users.php' => 'search_users.php', // 사용자 검색
    '/api/create_dm.php' => 'create_dm.php', // 개인 대화 생성
    '/api/list_dms.php' => 'list_dms.php', // 개인 대화 목록
    '/api/send_dm.php' => 'send_dm.php', // 개인 메시지 저장
    '/api/get_dm_messages.php' => 'get_dm_messages.php', // 개인 기록 조회
    '/api/profile_details.php' => 'profile_details.php', // 확장 프로필
    '/api/profile_picture.php' => 'profile_picture.php', // 프로필 사진
    '/api/user_blocks.php' => 'user_blocks.php', // 사용자 차단 관리
    '/api/friends.php' => 'friends.php', // 친구 요청과 수락
    '/api/upload_attachment.php' => 'upload_attachment.php', // 첨부 파일 저장
    '/api/list_attachments.php' => 'list_attachments.php', // 첨부 파일 목록
    '/api/download_attachment.php' => 'download_attachment.php', // 첨부 파일 다운로드
    '/api/profile.php' => 'profile.php', // 본인 프로필 조회·사용자명 변경
]; // API 목록 종료
if (isset($apiFiles[$requestPath])) // 허용한 API 여부
{
    require __DIR__ . '/backend/api/' . $apiFiles[$requestPath]; // 고정 경로 PHP 실행
    exit; // 정적 응답 중단
}
if (str_starts_with($requestPath, '/api/')) // 정의되지 않은 API
{
    http_response_code(404); // 없는 API 상태
    header('Content-Type: application/json; charset=utf-8'); // JSON 응답 지정
    header('Cache-Control: no-store'); // 오류 캐시 차단
    echo json_encode(['success' => false, 'error' => ['code' => 'NOT_FOUND', 'message' => '요청한 API가 없습니다.']], JSON_UNESCAPED_UNICODE); // 공통 오류 응답
    exit; // 응답 종료
}
if ($requestPath === '/favicon.ico') // 선택적 브라우저 아이콘 요청
{
    http_response_code(204); // 별도 아이콘 없음
    exit; // 아이콘 응답 종료
}
$staticFiles = // 공개 정적 파일 허용 목록
[ // 정적 파일 목록 시작
    '/' => ['index.html', 'text/html; charset=utf-8'], // 기본 웹 화면
    '/index.html' => ['index.html', 'text/html; charset=utf-8'], // 직접 홈 접근
    '/app.css' => ['app.css', 'text/css; charset=utf-8'], // 공통 화면 스타일
    '/chatting.css' => ['chatting.css', 'text/css; charset=utf-8'], // 채팅과 목록 스타일
    '/logout.css' => ['logout.css', 'text/css; charset=utf-8'], // 계정과 프로필 스타일
    '/login.css' => ['login.css', 'text/css; charset=utf-8'], // 로그인 스타일
    '/Sign up.css' => ['Sign up.css', 'text/css; charset=utf-8'], // 회원가입 스타일
    '/app.js' => ['app.js', 'text/javascript; charset=utf-8'], // 화면 상호작용
    '/message-feed.mjs' => ['message-feed.mjs', 'text/javascript; charset=utf-8'], // 채널 기록과 자동 갱신 모듈
    '/server-manager.mjs' => ['server-manager.mjs', 'text/javascript; charset=utf-8'], // 소속 상태와 변경 수명
    '/server-ui.mjs' => ['server-ui.mjs', 'text/javascript; charset=utf-8'], // 서버 관리 대화상자
    '/dialog-dismiss.mjs' => ['dialog-dismiss.mjs', 'text/javascript; charset=utf-8'], // 관리 창 바깥 닫기 모듈
    '/channel-ui.mjs' => ['channel-ui.mjs', 'text/javascript; charset=utf-8'], // 역할별 채널 관리 대화상자
    '/profile-ui.mjs' => ['profile-ui.mjs', 'text/javascript; charset=utf-8'], // 본인 프로필 대화상자
    '/direct-ui.mjs' => ['direct-ui.mjs', 'text/javascript; charset=utf-8'], // 개인 대화 화면
    '/friends-ui.mjs' => ['friends-ui.mjs', 'text/javascript; charset=utf-8'], // 친구 목록과 요청 화면
    '/attachments-ui.mjs' => ['attachments-ui.mjs', 'text/javascript; charset=utf-8'], // 첨부 파일 화면
    '/realtime.mjs' => ['realtime.mjs', 'text/javascript; charset=utf-8'], // 인증된 실시간 연결 모듈
]; // 정적 파일 목록 종료
if (!isset($staticFiles[$requestPath])) // 비공개 또는 없는 경로
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
[$assetName, $assetMimeType] = $staticFiles[$requestPath]; // 검증된 파일과 형식
$assetPath = $assetName === 'index.html' ? __DIR__ . '/index.html' : __DIR__ . '/frontend/' . $assetName; // 공개 목록의 실제 파일
$assetContent = file_get_contents($assetPath); // 전송할 파일 내용 읽기
if ($assetContent === false) // 배포 파일 누락 또는 읽기 실패
{
    http_response_code(503); // 배포 자원 오류 상태
    exit; // 실패 응답의 캐시 식별표 발급 방지
}
$entityTag = '"' . hash('sha256', $assetContent) . '"'; // 파일 내용에 따른 버전 식별표
header('Content-Type: ' . $assetMimeType); // 자원 형식 지정
header('Cache-Control: private, no-cache'); // 브라우저의 저장과 사용 전 재확인
header('ETag: W/' . $entityTag); // 압축 여부와 무관한 파일 식별표
$cacheCondition = trim($_SERVER['HTTP_IF_NONE_MATCH'] ?? ''); // 브라우저가 보관한 버전
$cachedTags = array_map('trim', explode(',', $cacheCondition)); // 여러 식별표의 공백 정리
if ($cacheCondition === '*' || in_array($entityTag, $cachedTags, true) || in_array('W/' . $entityTag, $cachedTags, true)) // 같은 파일 보관 여부
{
    http_response_code(304); // 브라우저의 기존 파일 사용
    exit; // 같은 본문 재전송 생략
}
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'HEAD') // 본문 전송 여부
{
    echo $assetContent; // 식별표와 일치하는 최신 본문 전송
}
