<?php // 표준 입력의 첨부 tar를 빈 볼륨으로 복원
declare(strict_types=1); // 엄격한 자료형 검사
if (PHP_SAPI !== 'cli') // 웹에서 관리 도구 실행 차단
{
    exit(1); // 비공개 도구 종료
}
require_once __DIR__ . '/../backend/includes/attachment_archive.php'; // 실제 원본 복원 경계
$temporary = tempnam(sys_get_temp_dir(), 'sm-attachments-'); // 제한된 디스크 임시 위치
$archivePath = $temporary . '.tar'; // tar 해석용 확장자
rename($temporary, $archivePath); // 생성한 임시 파일의 확장자 적용
$exitCode = 0; // 정리 후 반환할 작업 결과
try // 비밀 없는 복원 처리
{
    $output = fopen($archivePath, 'wb'); // 임시 백업 기록 스트림
    try // 큰 백업의 전체 메모리 적재 방지
    {
        if (stream_copy_to_stream(STDIN, $output) === false) // 표준 입력 복사 결과
        {
            throw new RuntimeException('첨부 백업 입력 실패'); // 불완전한 입력 중단
        }
    }
    finally // 임시 백업 파일 핸들 해제
    {
        fclose($output); // 백업 기록 종료
    }
    attachment_restore_archive($archivePath); // 검증한 원본만 빈 저장소로 복원
    fwrite(STDERR, '첨부 원본 복원 완료' . PHP_EOL); // 성공한 관리 작업 기록
}
catch (Throwable $error) // 실패한 복원 보고
{
    fwrite(STDERR, '첨부 복원 중단: 백업 형식·빈 저장소·디스크 공간 확인 필요' . PHP_EOL); // 비밀 없는 안내
    $exitCode = 1; // 정리 후 실패 결과 전달
}
finally // 임시 백업의 모든 종료 경로 정리
{
    unlink($archivePath); // 복원 입력의 임시 사본 제거
}
exit($exitCode); // 임시 자료 정리 후 실제 작업 결과
