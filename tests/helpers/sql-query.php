<?php // 실제 검사 DB 조회 도구
declare(strict_types=1); // 엄격한 자료형 검사
try // 실제 DB 오류 전달 경계
{
    $testPort = $argv[1] ?? ''; // 검사 포트
    $databaseName = $argv[2] ?? ''; // 독립 검사 DB
    if ($testPort !== '33361' || ($databaseName !== '' && !preg_match('/^systemmakers_[a-z_]+[a-f0-9]{12}$/D', $databaseName))) // 개발 DB 접근 차단
    {
        throw new RuntimeException('전용 검사 DB만 허용'); // 잘못된 접속 중단
    }
    $connectionString = 'mysql:host=127.0.0.1;port=' . $testPort . ';charset=utf8mb4' . ($databaseName === '' ? '' : ';dbname=' . $databaseName); // 격리된 실제 연결
    $databaseConnection = new PDO($connectionString, 'root', '', [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_STRINGIFY_FETCHES => true]); // 검사 전용 인증
    $sqlStatement = $databaseConnection->query(stream_get_contents(STDIN)); // 전달 SQL 실제 실행
    do // 여러 SQL 결과 순서 유지
    {
        if ($sqlStatement->columnCount() > 0) // 행을 반환하는 SQL
        {
            while ($resultRow = $sqlStatement->fetch(PDO::FETCH_NUM)) // 실제 행 순서 유지
            {
                $escapedValues = array_map(static fn ($fieldValue) => $fieldValue === null ? 'NULL' : strtr((string) $fieldValue, ["\\" => "\\\\", "\0" => '\0', "\t" => '\t', "\n" => '\n', "\r" => '\r', "\x1a" => '\Z']), $resultRow); // 기존 배치 출력 이스케이프
                echo implode("\t", $escapedValues) . "\n"; // 기존 검사 TSV 형식
            }
        }
    }
    while ($sqlStatement->nextRowset()); // 다음 SQL 결과 확인
}
catch (Throwable $error) // 실패의 명시적 종료
{
    $errorNumber = $error instanceof PDOException ? ($error->errorInfo[1] ?? 0) : 0; // 실제 MySQL 오류 번호
    fwrite(STDERR, 'ERROR ' . $errorNumber . ' ' . $error->getMessage() . "\n"); // 기존 오류 검사 호환
    exit(1); // 검사 실패 전달
}
