<?php // PDO 연결 설정
declare(strict_types=1); // 엄격한 자료형 검사
function database_setting(string $name, bool $allow_empty = false): string // 필수 환경 설정 조회
{
    $value = getenv($name); // 환경 변수 읽기
    if ($value === false || (!$allow_empty && trim($value) === '')) // 누락 설정 확인
    {
        throw new RuntimeException('Missing database configuration.'); // 기본 DB 연결 방지
    }
    return $value; // 명시된 설정 반환
}
function db(): PDO // 요청별 실제 DB 연결
{
    static $connection = null; // 요청 내부 연결 재사용
    if ($connection instanceof PDO) // 기존 연결 확인
    {
        return $connection; // 기존 연결 반환
    }
    $host = database_setting('MYSQL_HOST'); // 명시된 DB 호스트
    $port = database_setting('MYSQL_PORT'); // 명시된 DB 포트
    $database = database_setting('MYSQL_DATABASE'); // 필수 DB 이름
    $user = database_setting('MYSQL_USER'); // 필수 DB 사용자
    $password = database_setting('MYSQL_PASSWORD', true); // 명시된 비밀번호와 개발용 빈 값
    if (!preg_match('/\A(?:[a-zA-Z0-9._-]+|\[[a-fA-F0-9:]+\])\z/D', $host) || !preg_match('/\A[0-9]{1,5}\z/D', $port) || (int) $port < 1 || (int) $port > 65535 || !preg_match('/\A[a-zA-Z0-9_]+\z/D', $database)) // DSN 구분자 주입과 범위 검사
    {
        throw new RuntimeException('Invalid database configuration.'); // 잘못된 연결 설정 차단
    }
    $dsn = 'mysql:host=' . $host . ';port=' . $port . ';dbname=' . $database . ';charset=utf8mb4'; // UTF-8 전용 연결 주소
    $connection = new PDO($dsn, $user, $password, // 실제 MySQL 연결
    [ // PDO 연결 속성
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, // SQL 오류 예외 처리
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC, // 이름 기반 행 반환
        PDO::ATTR_EMULATE_PREPARES => false, // 실제 prepared statement
        PDO::ATTR_STRINGIFY_FETCHES => true, // 큰 식별자 문자열 보존
        PDO::ATTR_TIMEOUT => 5 // 연결 대기 제한
    ]); // 연결 속성 종료
    $connection->exec("SET SESSION time_zone = '+00:00'"); // DB 연결 UTC 시각
    return $connection; // 설정된 연결 반환
}
