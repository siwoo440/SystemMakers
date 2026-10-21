<?php // 보존형 8단계 변경 실행 도구
declare(strict_types=1); // 엄격한 자료형
if (PHP_SAPI !== 'cli') // 웹 실행 차단
{
    http_response_code(404); // 비공개 도구 상태
    exit(1); // 실행 중단
}
require_once __DIR__ . '/../backend/config/database.php'; // 환경 기반 DB 연결
try // 적용 전 검사와 구체적 종료 상태
{
    $pdo = db(); // 명시된 DB 연결
    $version = (string) $pdo->query('SELECT VERSION()')->fetchColumn(); // 실제 DB 버전
    if (!str_starts_with($version, '8.4.')) // 검증한 DB 계열 확인
    {
        throw new RuntimeException('MySQL 8.4 필요'); // 다른 DB 적용 차단
    }
    $locked = (int) $pdo->query("SELECT GET_LOCK(SHA2(CONCAT(DATABASE(), ':migration001'),256), 5)")->fetchColumn(); // 긴 DB 이름도 안전한 변경 직렬화
    if ($locked !== 1) // 중복 실행 대기 실패
    {
        throw new RuntimeException('다른 변경 작업 실행 중'); // 경합 적용 차단
    }
    $tables = $pdo->query('SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE()')->fetchAll(PDO::FETCH_COLUMN); // 실제 적용 상태
    foreach (['users', 'servers', 'server_members', 'channels', 'messages', 'auth_rate_limits'] as $table) // 기존 구조 필수 조건
    {
        if (!in_array($table, $tables, true)) // 초기 구조 누락
        {
            throw new RuntimeException('기존 스키마 확인 필요'); // 잘못된 대상 중단
        }
    }
    if (array_intersect(['server_invites', 'management_rate_limits'], $tables) !== []) // 재적용과 부분 실패 구분
    {
        throw new RuntimeException('기존 변경 테이블 존재: 재실행 거절, 실제 적용 상태 확인 필요'); // 자동 덮어쓰기 차단
    }
    $file = __DIR__ . '/../backend/sql/migrations/001_server_invites_and_limits.sql'; // 고정 변경 파일
    $pdo->exec(file_get_contents($file)); // 기존 자료 삭제 없는 DDL 실행
    fwrite(STDOUT, '001 적용 완료 · SHA256 ' . hash_file('sha256', $file) . PHP_EOL); // 배포 기록용 파일 해시
}
catch (Throwable $error) // 부분 적용 포함 실패 보고
{
    fwrite(STDERR, '변경 중단: ' . ($error instanceof PDOException ? 'DB 구조·권한·부분 적용 상태 확인 필요' : $error->getMessage()) . PHP_EOL); // 비밀 없는 진단
    exit(1); // 실패 종료
}
