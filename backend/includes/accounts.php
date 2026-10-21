<?php // 회원 입력 검증과 공개 계정 처리
declare(strict_types=1); // 엄격한 자료형 검사
function validate_email(mixed $value): string // ASCII 이메일 정규화
{
    if (!is_string($value)) // 문자열 자료형 여부
    {
        respond_error('VALIDATION_ERROR', '입력값을 확인하세요.', 422, ['email' => '올바른 이메일이 필요합니다.']); // 이메일 자료형 오류
    }
    $email = strtolower(trim($value)); // 앞뒤 공백 제거와 소문자 변환
    if (strlen($email) > 254 || !preg_match('/\A[\x00-\x7F]*\z/D', $email) || filter_var($email, FILTER_VALIDATE_EMAIL) === false) // ASCII와 길이 및 PHP 이메일 형식
    {
        respond_error('VALIDATION_ERROR', '입력값을 확인하세요.', 422, ['email' => '올바른 이메일이 필요합니다.']); // 이메일 형식 오류
    }
    return $email; // DB와 제한 버킷의 공통 이메일
}
function validate_username(mixed $value): string // 사용자명 정규화와 검증
{
    if (!is_string($value) || !preg_match('/\A[a-zA-Z0-9_]{3,32}\z/D', trim($value))) // 영문과 숫자 및 밑줄 허용
    {
        respond_error('VALIDATION_ERROR', '입력값을 확인하세요.', 422, ['username' => '영문·숫자·밑줄 3~32자가 필요합니다.']); // 사용자명 형식 오류
    }
    return strtolower(trim($value)); // 소문자 고유 사용자명
}
function validate_password(mixed $value): string // 문자 수와 bcrypt 바이트 상한 검증
{
    $password = validate_string($value, 'password', 12, 64); // UTF-8 원문과 문자 수 및 NUL 확인
    if (strlen($password) > 72) // bcrypt 입력 절단 상한
    {
        respond_error('VALIDATION_ERROR', '입력값을 확인하세요.', 422, ['password' => '비밀번호는 UTF-8 72바이트 이하여야 합니다.']); // 바이트 초과 오류
    }
    return $password; // 공백과 대소문자 유지 원문
}
function public_account(array $row): array // 비밀 없는 사용자 응답 변환
{
    return ['id' => (string) $row['id'], 'username' => $row['username'], 'email' => $row['email'], 'created_at' => (new DateTimeImmutable($row['created_at'], new DateTimeZone('UTC')))->format('Y-m-d\TH:i:s\Z')]; // 공개 필드와 UTC 시각
}
function reject_account_duplicate(PDO $pdo, string $email, string $username): void // 이메일 우선 고유 값 검사
{
    $query = $pdo->prepare('SELECT email, username FROM users WHERE email = :email OR username = :username'); // 두 고유 값 조회
    $query->execute(['email' => $email, 'username' => $username]); // 실제 준비된 쿼리 실행
    $username_taken = false; // 사용자명 중복 기록
    foreach ($query->fetchAll() as $row) // 충돌 후보 순회
    {
        if (strtolower($row['email']) === $email) // 이메일 우선 충돌 판정
        {
            respond_error('EMAIL_TAKEN', '이미 사용 중인 이메일입니다.', 409); // 이메일 중복 응답
        }
        $username_taken = true; // 사용자명 충돌 기록
    }
    if ($username_taken) // 이메일 중복 없는 사용자명 충돌
    {
        respond_error('USERNAME_TAKEN', '이미 사용 중인 사용자명입니다.', 409); // 사용자명 중복 응답
    }
}
