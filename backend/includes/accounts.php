<?php // 회원 입력 검증과 공개 계정 처리
declare(strict_types=1); // 엄격한 자료형 검사
function validate_email(mixed $inputValue): string // ASCII 이메일 정규화
{
    if (!is_string($inputValue)) // 문자열 자료형 여부
    {
        respond_error('VALIDATION_ERROR', '입력값을 확인하세요.', 422, ['email' => '올바른 이메일이 필요합니다.']); // 이메일 자료형 오류
    }
    $email = strtolower(trim($inputValue)); // 앞뒤 공백 제거와 소문자 변환
    if (strlen($email) > 254 || !preg_match('/\A[\x00-\x7F]*\z/D', $email) || filter_var($email, FILTER_VALIDATE_EMAIL) === false) // ASCII와 길이 및 PHP 이메일 형식
    {
        respond_error('VALIDATION_ERROR', '입력값을 확인하세요.', 422, ['email' => '올바른 이메일이 필요합니다.']); // 이메일 형식 오류
    }
    return $email; // DB와 제한 버킷의 공통 이메일
}
function validate_username(mixed $inputValue): string // 사용자명 정규화와 검증
{
    if (!is_string($inputValue) || !preg_match('/\A[a-zA-Z0-9_가-힣]{2,32}\z/uD', trim($inputValue))) // 한글과 영문·숫자·밑줄 허용
    {
        respond_error('VALIDATION_ERROR', '입력값을 확인하세요.', 422, ['username' => '한글·영문·숫자·밑줄 2~32자가 필요합니다.']); // 사용자명 형식 오류
    }
    return strtolower(trim($inputValue)); // 소문자 고유 사용자명
}
function validate_password(mixed $inputValue): string // 문자 수와 bcrypt 바이트 상한 검증
{
    $password = validate_string($inputValue, 'password', 12, 64); // UTF-8 원문과 문자 수 및 NUL 확인
    if (strlen($password) > 72) // bcrypt 입력 절단 상한
    {
        respond_error('VALIDATION_ERROR', '입력값을 확인하세요.', 422, ['password' => '비밀번호는 UTF-8 72바이트 이하여야 합니다.']); // 바이트 초과 오류
    }
    return $password; // 공백과 대소문자 유지 원문
}
function public_account(array $databaseRow): array // 비밀 없는 사용자 응답 변환
{
    return ['id' => (string) $databaseRow['id'], 'username' => $databaseRow['username'], 'email' => $databaseRow['email'], 'created_at' => (new DateTimeImmutable($databaseRow['created_at'], new DateTimeZone('UTC')))->format('Y-m-d\TH:i:s\Z')]; // 공개 필드와 UTC 시각
}
function reject_account_duplicate(PDO $databaseConnection, string $email, string $username): void // 이메일 우선 고유 값 검사
{
    $databaseQuery = $databaseConnection->prepare('SELECT email, username FROM users WHERE email = :email OR username = :username'); // 두 고유 값 조회
    $databaseQuery->execute(['email' => $email, 'username' => $username]); // 실제 준비된 쿼리 실행
    $usernameTaken = false; // 사용자명 중복 기록
    foreach ($databaseQuery->fetchAll() as $databaseRow) // 충돌 후보 순회
    {
        if (strtolower($databaseRow['email']) === $email) // 이메일 우선 충돌 판정
        {
            respond_error('EMAIL_TAKEN', '이미 사용 중인 이메일입니다.', 409); // 이메일 중복 응답
        }
        $usernameTaken = true; // 사용자명 충돌 기록
    }
    if ($usernameTaken) // 이메일 중복 없는 사용자명 충돌
    {
        respond_error('USERNAME_TAKEN', '이미 사용 중인 사용자명입니다.', 409); // 사용자명 중복 응답
    }
}
