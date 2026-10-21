<?php // POST 실제 회원 로그인 API
declare(strict_types=1); // 엄격한 자료형 검사
require_once __DIR__ . '/../includes/bootstrap.php'; // 공통 실행 환경
require_once __DIR__ . '/../includes/accounts.php'; // 회원 검증과 공개 응답
require_once __DIR__ . '/../includes/login_rate_limit.php'; // 공유 DB 시도 제한
require_method(['POST']); // 메서드 우선 검사
$pdo = db(); // 실제 회원과 제한 DB 연결
require_guest($pdo); // 유효한 로그인 중 재로그인 차단
$body = read_json_body(); // 본문 크기와 JSON 검증
require_csrf(); // 필드 검사 전 CSRF 검증
require_body_fields($body, ['email', 'password']); // 허용된 로그인 필드
$email = validate_email($body['email']); // 가입과 같은 이메일 정규화
$password = validate_password($body['password']); // 가입과 같은 원문 조건
$original_id = session_id(); // 느린 작업 전 원래 세션 ID
$original_token = $_SESSION['csrf_token']; // 느린 작업 전 검증된 토큰
close_session(); // DB 잠금과 해시 검사 전 세션 잠금 해제
consume_login_attempt($pdo, $email); // 성공과 실패를 함께 세는 원자적 제한
$query = $pdo->prepare('SELECT id, username, email, created_at, password_hash FROM users WHERE email = :email LIMIT 1'); // 실제 계정의 해시 조회
$query->execute(['email' => $email]); // 준비된 계정 검색
$account = $query->fetch(); // 실제 계정 또는 부재 결과
$dummy_hash = '$2y$12$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2uheWG/igi.'; // 없는 계정의 동일 bcrypt 비용 해시
$verified = password_verify($password, $account === false ? $dummy_hash : $account['password_hash']); // 없는 계정도 실제 해시 비교
if ($account === false || !$verified) // 계정 부재와 비밀번호 불일치
{
    respond_error('INVALID_CREDENTIALS', '이메일 또는 비밀번호가 올바르지 않습니다.', 401); // 동일 자격 증명 오류
}
start_secure_session(); // 성공 직전에만 원래 세션 다시 잠금
if (session_id() !== $original_id || !is_string($_SESSION['csrf_token'] ?? null) || !hash_equals($original_token, $_SESSION['csrf_token'])) // 동시 로그인과 로그아웃의 오래된 세션 차단
{
    header_remove('Set-Cookie'); // 늦은 게스트 응답의 성공 쿠키 덮어쓰기 차단
    respond_error('CSRF_INVALID', '요청 확인 토큰이 올바르지 않습니다.', 403); // 폐기된 요청의 인증 복원 금지
}
require_guest($pdo); // 잠금 해제 중 생긴 인증 상태 재검사
$_SESSION = []; // 기존 잠금 안에서 오래된 인증과 토큰 폐기
if (!session_regenerate_id(false)) // 비워진 기존 세션 저장 후 새 식별자 발급
{
    throw new RuntimeException('Session unavailable.'); // 교체 실패의 인증 생성 차단
}
$token = bin2hex(random_bytes(32)); // 인증 성공마다 새 CSRF 난수
$now = time(); // 실제 인증 시각
$_SESSION = ['user_id' => (string) $account['id'], 'authenticated_at' => $now, 'last_activity_at' => $now, 'csrf_token' => $token]; // 비밀 없는 최소 인증 상태
close_session(); // 응답 전에 새 인증 상태 저장
respond_success(['user' => public_account($account), 'csrf_token' => $token]); // 새 세션과 공개 사용자 반환
