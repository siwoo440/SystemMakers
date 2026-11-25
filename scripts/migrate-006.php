<?php // 기존 첨부를 보존하는 비공개 파일 저장소 변경
declare(strict_types=1); // 엄격한 자료형 검사
if (PHP_SAPI !== 'cli') // 웹 실행 차단
{
    http_response_code(404); // 비공개 도구 상태
    exit(1); // 실행 중단
}
require_once __DIR__ . '/../backend/config/database.php'; // 명시적 DB 설정
try // 선행 구조와 적용 상태 확인
{
    $databaseConnection = db(); // 지정한 DB 연결
    if (!str_starts_with((string) $databaseConnection->query('SELECT VERSION()')->fetchColumn(), '8.4.')) // 지원 DB 버전 확인
    {
        throw new RuntimeException('MySQL 8.4 필요'); // 미지원 적용 중단
    }
    $lockAcquired = (int) $databaseConnection->query("SELECT GET_LOCK(SHA2(CONCAT(DATABASE(), ':migration006'),256), 5)")->fetchColumn(); // 동일 변경의 직렬 실행
    if ($lockAcquired !== 1) // 중복 변경 잠금 여부
    {
        throw new RuntimeException('다른 변경 작업 실행 중'); // 경합 중단
    }
    $columns = $databaseConnection->query("SELECT column_name FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='message_attachments'")->fetchAll(PDO::FETCH_COLUMN); // 실제 첨부 구조
    if (!in_array('file_data', $columns, true) || array_intersect(['storage_key', 'preview_mime'], $columns) !== []) // 누락과 부분 적용 검사
    {
        throw new RuntimeException('004 선행 구조 또는 006 적용 상태 확인 필요'); // 재적용과 원본 덮어쓰기 방지
    }
    $migrationFile = __DIR__ . '/../backend/sql/migrations/006_attachment_storage.sql'; // 승인한 고정 SQL
    $databaseConnection->exec(file_get_contents($migrationFile)); // 기존 파일 바이트를 보존한 구조 변경
    fwrite(STDOUT, '006 적용 완료 · SHA256 ' . hash_file('sha256', $migrationFile) . PHP_EOL); // 적용 파일 기록
}
catch (Throwable $caughtException) // 변경 실패의 비밀 없는 안내
{
    fwrite(STDERR, '변경 중단: ' . ($caughtException instanceof PDOException ? 'DB 구조·권한·적용 상태 확인 필요' : $caughtException->getMessage()) . PHP_EOL); // 적용 상태 확인 안내
    exit(1); // 실패 결과 반환
}
