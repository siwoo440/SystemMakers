<?php // HTTP 입력 공통 검증
declare(strict_types=1); // 엄격한 자료형 검사
function require_method(array $allowed): void // HTTP 메서드 검사
{
    if (!in_array($_SERVER['REQUEST_METHOD'] ?? '', $allowed, true)) // 지원 메서드 여부
    {
        header('Allow: ' . implode(', ', $allowed)); // 지원 메서드 안내
        respond_error('METHOD_NOT_ALLOWED', '지원하지 않는 요청 방식입니다.', 405); // 메서드 오류 반환
    }
}
function require_query_fields(array $allowed): void // GET 허용 필드 검사
{
    $seen = []; // 원본 조회 키 기록
    $query = $_SERVER['QUERY_STRING'] ?? ''; // PHP 변환 전 조회 문자열
    foreach ($query === '' ? [] : explode('&', $query) as $pair) // 원본 매개변수 순회
    {
        $name = urldecode(explode('=', $pair, 2)[0]); // 인코딩된 키 복원
        if (!in_array($name, $allowed, true) || isset($seen[$name])) // 미허용 키와 중복 키 검사
        {
            respond_error('INVALID_QUERY', '조회 조건을 확인하세요.', 400); // 덮어쓴 조회 값 차단
        }
        $seen[$name] = true; // 검사된 키 기록
    }
    if (array_diff(array_keys($_GET), $allowed) !== []) // 알 수 없는 조회 필드
    {
        respond_error('INVALID_QUERY', '조회 조건을 확인하세요.', 400); // 조회 필드 오류
    }
}
function read_json_body(): array // 제한된 JSON 객체 읽기
{
    $length = $_SERVER['CONTENT_LENGTH'] ?? null; // 명시된 본문 바이트 수
    if (is_string($length) && (strlen(ltrim($length, '0')) > 5 || (int) $length > 32768)) // 명시 크기 상한 검사
    {
        respond_error('PAYLOAD_TOO_LARGE', '요청 본문이 너무 큽니다.', 413); // 과대 본문 차단
    }
    $raw = file_get_contents('php://input', false, null, 0, 32769); // 상한보다 한 바이트 추가 읽기
    if ($raw === false) // 본문 읽기 실패
    {
        throw new RuntimeException('Request body unavailable.'); // 내부 읽기 오류
    }
    if (strlen($raw) > 32768) // 실제 본문 크기 검사
    {
        respond_error('PAYLOAD_TOO_LARGE', '요청 본문이 너무 큽니다.', 413); // 초과 크기 차단
    }
    $content_type = strtolower(trim(explode(';', $_SERVER['CONTENT_TYPE'] ?? '')[0])); // MIME 유형 추출
    if ($content_type !== 'application/json') // JSON 전용 요청 여부
    {
        respond_error('UNSUPPORTED_MEDIA_TYPE', 'JSON 요청이 필요합니다.', 415); // 미지원 유형 거절
    }
    try // JSON 구문과 UTF-8 검증
    {
        $decoded = json_decode($raw, false, 64, JSON_THROW_ON_ERROR); // 숫자와 문자열 자료형 구분
    }
    catch (JsonException $exception) // 잘못된 JSON 입력
    {
        respond_error('INVALID_JSON', '올바른 JSON 객체가 필요합니다.', 400); // 구문 오류 반환
    }
    if (!$decoded instanceof stdClass) // 배열과 원시 값 차단
    {
        respond_error('INVALID_JSON', 'JSON 객체가 필요합니다.', 400); // 객체 형식 오류
    }
    return get_object_vars($decoded); // 최상위 객체 필드 반환
}
function require_body_fields(array $body, array $required = [], array $optional = []): void // CSRF 이후 입력 필드 검사
{
    $fields = []; // 필드 오류 수집
    foreach (array_diff($required, array_keys($body)) as $field) // 필수 필드 누락 검사
    {
        $fields[$field] = '필수 입력입니다.'; // 누락 필드 안내
    }
    foreach (array_diff(array_keys($body), array_merge($required, $optional)) as $field) // 미허용 필드 검사
    {
        $fields[$field] = '허용하지 않는 필드입니다.'; // 잘못된 필드 안내
    }
    if ($fields !== []) // 필드 검사 실패
    {
        respond_error('VALIDATION_ERROR', '입력값을 확인하세요.', 422, $fields); // 입력 오류 반환
    }
}
function valid_id(mixed $value, bool $allow_zero = false): bool // 부호 없는 64비트 문자열 판정
{
    if (!is_string($value)) // 문자열 자료형 검사
    {
        return false; // 숫자와 배열 차단
    }
    if ($allow_zero && $value === '0') // 초기 신규 커서 조건
    {
        return true; // 명시적 0 커서 허용
    }
    if (!preg_match('/\A[1-9][0-9]{0,19}\z/D', $value)) // 정규 십진수 형식 검사
    {
        return false; // 부호와 앞자리 0 차단
    }
    return strlen($value) < 20 || strcmp($value, '18446744073709551615') <= 0; // 정수 변환 없는 상한 비교
}
function validate_id(mixed $value, string $field, bool $allow_zero = false, bool $query = false): string // 외부 입력 ID 검증
{
    if (!valid_id($value, $allow_zero)) // 자료형과 범위 확인
    {
        respond_error($query ? 'INVALID_QUERY' : 'VALIDATION_ERROR', '식별자를 확인하세요.', $query ? 400 : 422, [$field => '올바른 식별자 문자열이 필요합니다.']); // 입력 위치별 오류
    }
    return $value; // 원본 문자열 ID 반환
}
function validate_string(mixed $value, string $field, int $minimum, int $maximum): string // UTF-8 문자열 길이 검사
{
    if (!is_string($value) || !mb_check_encoding($value, 'UTF-8') || str_contains($value, "\0") || mb_strlen($value, 'UTF-8') < $minimum || mb_strlen($value, 'UTF-8') > $maximum) // 자료형과 문자 수 및 NUL 검사
    {
        respond_error('VALIDATION_ERROR', '입력값을 확인하세요.', 422, [$field => '문자열 형식과 길이를 확인하세요.']); // 문자열 오류 반환
    }
    return $value; // 변형 없는 원본 반환
}
