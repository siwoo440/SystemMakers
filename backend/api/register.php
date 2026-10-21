<?php // POST 실제 회원가입 API
declare(strict_types=1); // 엄격한 자료형 검사
require_once __DIR__ . '/../includes/bootstrap.php'; // 공통 실행 환경
require_once __DIR__ . '/../includes/accounts.php'; // 회원 입력과 공개 정보 처리
require_method(['POST']); // 메서드 우선 검사
$pdo = db(); // 실제 회원 저장 연결
require_guest($pdo); // 이미 로그인 중인 요청 거절
$body = read_json_body(); // 본문 크기와 JSON 검증
require_csrf(); // 필드 검사 전 요청 토큰 검증
require_body_fields($body, ['username', 'email', 'password']); // 필수 필드와 미허용 필드
$username = validate_username($body['username']); // 사용자명 정규화
$email = validate_email($body['email']); // 이메일 정규화
$password = validate_password($body['password']); // 원문 비밀번호 경계 검증
close_session(); // 느린 해시와 DB 처리 전 세션 잠금 해제
reject_account_duplicate($pdo, $email, $username); // 이메일 우선 중복 검사
$hash = password_hash($password, PASSWORD_DEFAULT); // PHP 기본 보안 해시
try // UNIQUE 경쟁을 포함한 실제 회원 저장
{
    $insert = $pdo->prepare('INSERT INTO users (username, email, password_hash) VALUES (:username, :email, :hash)'); // 원문 없는 준비된 INSERT
    $insert->execute(['username' => $username, 'email' => $email, 'hash' => $hash]); // 실제 계정 저장
}
catch (PDOException $exception) // 동시 가입의 고유 값 충돌
{
    if ((int) ($exception->errorInfo[1] ?? 0) === 1062) // MySQL UNIQUE 위반 여부
    {
        reject_account_duplicate($pdo, $email, $username); // DB 충돌도 이메일 우선 오류 변환
    }
    throw $exception; // 그 외 공통 내부 오류
}
$id = $pdo->lastInsertId(); // 정수 변환 없는 생성 ID
$query = $pdo->prepare('SELECT id, username, email, created_at FROM users WHERE id = :id'); // 공개 필드만 조회
$query->execute(['id' => $id]); // 저장된 실제 계정 조회
respond_success(['user' => public_account($query->fetch())], 201); // 가입 후 게스트를 유지한 응답
