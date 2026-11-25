<?php // 백업 복원 전후 원본 파일의 무결성 확인
declare(strict_types=1); // 엄격한 자료형 검사
if (PHP_SAPI !== 'cli') // 웹에서 관리 도구 실행 차단
{
    exit(1); // 비공개 도구 종료
}
require_once __DIR__ . '/../backend/config/database.php'; // 지정한 DB 연결
require_once __DIR__ . '/../backend/includes/attachments.php'; // 비공개 원본 경로
try // 누락과 손상 원본 확인
{
    $query = db()->query('SELECT id,storage_key,file_size FROM message_attachments WHERE storage_key IS NOT NULL ORDER BY id'); // 신규 파일의 고정 메타데이터
    while ($row = $query->fetch()) // 원본 하나씩 무결성 확인
    {
        $path = attachment_storage_path($row['storage_key']); // 검증한 고정 저장 경로
        if (!is_file($path) || filesize($path) !== (int) $row['file_size']) // 실제 원본 크기 확인
        {
            throw new RuntimeException('Attachment unavailable.'); // 누락 또는 손상 백업 실패
        }
        $hash = hash_file('sha256', $path); // 제한된 메모리의 원본 해시
        if ($hash === false) // 원본 읽기 성공 여부
        {
            throw new RuntimeException('Attachment unavailable.'); // 읽을 수 없는 원본 거절
        }
        fwrite(STDOUT, $row['id'] . ':' . $hash . PHP_EOL); // 비밀 없는 비교 기준
    }
}
catch (Throwable $error) // 비밀 없는 관리 작업 실패
{
    fwrite(STDERR, '첨부 원본·DB 메타데이터·저장 경로 확인 필요' . PHP_EOL); // 불완전한 백업 또는 복원 안내
    exit(1); // 실제 무결성 검사 실패
}
