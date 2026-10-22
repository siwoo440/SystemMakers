<?php // 실제 검사 DB 조회 도구
declare(strict_types=1); // 엄격한 자료형 검사
try // 실제 DB 오류 전달 경계
{
    $port = $argv[1] ?? ''; // 검사 포트
    $database = $argv[2] ?? ''; // 독립 검사 DB
    if ($port !== '33361' || ($database !== '' && !preg_match('/^systemmakers_[a-z_]+[a-f0-9]{12}$/D', $database))) // 개발 DB 접근 차단
    {
        throw new RuntimeException('전용 검사 DB만 허용'); // 잘못된 접속 중단
    }
    $dsn = 'mysql:host=127.0.0.1;port=' . $port . ';charset=utf8mb4' . ($database === '' ? '' : ';dbname=' . $database); // 격리된 실제 연결
    $pdo = new PDO($dsn, 'root', '', [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_STRINGIFY_FETCHES => true]); // 검사 전용 인증
    $statement = $pdo->query(stream_get_contents(STDIN)); // 전달 SQL 실제 실행
    do // 여러 SQL 결과 순서 유지
    {
        if ($statement->columnCount() > 0) // 행을 반환하는 SQL
        {
            while ($row = $statement->fetch(PDO::FETCH_NUM)) // 실제 행 순서 유지
            {
                $values = array_map(static fn ($value) => $value === null ? 'NULL' : strtr((string) $value, ["\\" => "\\\\", "\0" => '\0', "\t" => '\t', "\n" => '\n', "\r" => '\r', "\x1a" => '\Z']), $row); // 기존 배치 출력 이스케이프
                echo implode("\t", $values) . "\n"; // 기존 검사 TSV 형식
            }
        }
    }
    while ($statement->nextRowset()); // 다음 SQL 결과 확인
}
catch (Throwable $error) // 실패의 명시적 종료
{
    $number = $error instanceof PDOException ? ($error->errorInfo[1] ?? 0) : 0; // 실제 MySQL 오류 번호
    fwrite(STDERR, 'ERROR ' . $number . ' ' . $error->getMessage() . "\n"); // 기존 오류 검사 호환
    exit(1); // 검사 실패 전달
}
