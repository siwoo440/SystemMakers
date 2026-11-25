<?php // 비공개 첨부 원본의 안전한 tar 복원
declare(strict_types=1); // 엄격한 자료형 검사
require_once __DIR__ . '/attachments.php'; // 비공개 저장 경계
function attachment_restore_archive(string $archivePath): void // 빈 첨부 저장소에만 원본 복원
{
    $directory = attachment_storage_directory(); // 실제 대상 볼륨
    if (count(scandir($directory)) !== 2) // 기존 파일 또는 디렉터리 여부
    {
        throw new RuntimeException('빈 첨부 저장소만 복원 가능'); // 기존 원본 덮어쓰기 차단
    }
    $resolvedArchive = realpath($archivePath); // 실제 백업 위치
    if ($resolvedArchive === false) // 백업 파일 존재 여부
    {
        throw new RuntimeException('첨부 백업 파일 확인 필요'); // 없는 백업 거절
    }
    $archive = new PharData($resolvedArchive); // 디스크 기반 tar 읽기
    $prefix = 'phar://' . str_replace('\\', '/', $resolvedArchive) . '/'; // 백업 내부 경로 기준
    $entries = []; // 전체 검증을 통과할 파일 목록
    foreach (new RecursiveIteratorIterator($archive) as $entry) // 백업의 실제 원본 순회
    {
        $entryPath = str_replace('\\', '/', $entry->getPathname()); // 내부 경로 표준화
        $key = substr($entryPath, strlen($prefix)); // 백업 기준의 상대 파일명
        if (!str_starts_with($entryPath, $prefix) || !preg_match('/\A[a-f0-9]{64}\z/D', $key) || !$entry->isFile() || $entry->isLink() || $entry->getSize() < 1 || $entry->getSize() > ATTACHMENT_MAX_BYTES) // 종류와 경로 및 원본 크기 확인
        {
            throw new RuntimeException('첨부 백업 내용 확인 필요'); // 링크와 중첩 경로 및 잘못된 키 거절
        }
        $entries[$key] = $entry->getPathname(); // 검증한 원본만 복원 목록에 추가
    }
    if (count($archive) !== count($entries)) // 반복자에서 생략한 디렉터리와 비정상 엔트리 여부
    {
        throw new RuntimeException('첨부 백업 내용 확인 필요'); // 조용한 원본 누락과 빈 복원 오인 방지
    }
    $created = []; // 실패 시 정리할 신규 원본
    try // 검증 후 제한된 메모리 복원
    {
        foreach ($entries as $key => $entryPath) // 검증한 원본 순회
        {
            $source = fopen($entryPath, 'rb'); // 백업 원본 스트림
            $destinationPath = attachment_storage_path($key); // 고정 저장소 내부 위치
            $destination = fopen($destinationPath, 'xb'); // 기존 원본을 덮어쓰지 않는 생성
            if ($source === false || $destination === false) // 파일 입출력 준비 여부
            {
                throw new RuntimeException('첨부 백업 복원 실패'); // 부분 복원 중단
            }
            $created[] = $destinationPath; // 정리할 신규 파일 기록
            try // 오류 시 핸들 해제
            {
                $copied = stream_copy_to_stream($source, $destination); // 전체 메모리 적재 없는 바이트 복원
                if ($copied !== $archive[$key]->getSize() || !chmod($destinationPath, 0600)) // 전체 길이와 원본 권한 확인
                {
                    throw new RuntimeException('첨부 백업 복원 실패'); // 불완전한 원본 거절
                }
            }
            finally // 원본과 대상 핸들 정리
            {
                fclose($source); // 백업 읽기 종료
                fclose($destination); // 원본 기록 종료
            }
        }
    }
    catch (Throwable $error) // 복원 실패 시 신규 파일 정리
    {
        foreach ($created as $createdPath) // 이번 복원에서 생성한 원본만 선택
        {
            unlink($createdPath); // 부분 복원 원본 제거
        }
        throw $error; // 실제 실패 결과 전달
    }
}
