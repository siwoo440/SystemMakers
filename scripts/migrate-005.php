<?php // 친구 관계 보존형 구조 변경
declare(strict_types=1); // 엄격한 자료형 검사
if (PHP_SAPI !== 'cli') // 웹 실행 차단
{
    http_response_code(404); // 비공개 상태
    exit(1); // 실행 중단
}
require_once __DIR__ . '/../backend/config/database.php'; // 명시적 DB 연결
try // 변경 전 구조 확인
{
    $databaseConnection = db(); // 실제 DB 연결
    $databaseVersion = (string) $databaseConnection->query('SELECT VERSION()')->fetchColumn(); // DB 버전 확인
    if (!str_starts_with($databaseVersion, '8.4.')) // 지원 버전 검사
    {
        throw new RuntimeException('MySQL 8.4 필요'); // 미지원 DB 차단
    }
    $lockAcquired = (int) $databaseConnection->query("SELECT GET_LOCK(SHA2(CONCAT(DATABASE(), ':migration005'),256), 5)")->fetchColumn(); // 변경 직렬화
    if ($lockAcquired !== 1) // 잠금 획득 실패
    {
        throw new RuntimeException('다른 변경 작업 실행 중'); // 경합 중단
    }
    $existingTables = $databaseConnection->query('SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE()')->fetchAll(PDO::FETCH_COLUMN); // 현재 테이블 목록
    foreach (['users', 'direct_conversations', 'direct_messages', 'user_blocks', 'user_profiles', 'message_attachments'] as $tableName) // 선행 구조 확인
    {
        if (!in_array($tableName, $existingTables, true)) // 필수 테이블 누락
        {
            throw new RuntimeException('기존 및 002~004 스키마 확인 필요'); // 잘못된 대상 중단
        }
    }
    if (in_array('friendships', $existingTables, true)) // 기존 적용 확인
    {
        throw new RuntimeException('친구 테이블 존재: 재실행 거절, 실제 적용 상태 확인 필요'); // 기존 데이터 보존
    }
    $migrationFile = __DIR__ . '/../backend/sql/migrations/005_friendships.sql'; // 고정 변경 파일
    $databaseConnection->exec(file_get_contents($migrationFile)); // 친구 관계 테이블 추가
    fwrite(STDOUT, '005 적용 완료 · SHA256 ' . hash_file('sha256', $migrationFile) . PHP_EOL); // 적용 기록
}
catch (Throwable $caughtException) // 실패와 부분 상태 처리
{
    fwrite(STDERR, '변경 중단: ' . ($caughtException instanceof PDOException ? 'DB 구조·권한·적용 상태 확인 필요' : $caughtException->getMessage()) . PHP_EOL); // 비밀 없는 오류
    exit(1); // 실패 종료
}
