<?php // 실제 tar 파일의 복원 경계 검사
declare(strict_types=1); // 엄격한 자료형 검사
$helper = __DIR__ . '/../../backend/includes/attachment_archive.php'; // 실제 복원 함수 위치
if (is_file($helper)) // 구현한 복원 함수 여부
{
    require_once $helper; // 실제 복원 함수 로드
}
$directory = $argv[1]; // 검사 전용 위치
$key = str_repeat('a', 64); // 유효한 비공개 원본 키
$archive = new PharData($directory . '/valid.tar'); // 실제 tar 백업
$archive[$key] = "\x00\xffold bytes"; // 바이너리 원본 보존
putenv('ATTACHMENT_STORAGE_DIR=' . $directory . '/restored'); // 빈 대상 저장소
$result = ['restored' => false, 'overwrite' => false, 'invalid' => false, 'directories' => false]; // 실제 동작 결과
if (function_exists('attachment_restore_archive')) // 복원 함수 구현 여부
{
    attachment_restore_archive($directory . '/valid.tar'); // 새 저장소로 실제 복원
    $result['restored'] = file_get_contents($directory . '/restored/' . $key) === "\x00\xffold bytes"; // 바이너리 무결성
    try // 기존 파일 덮어쓰기 검사
    {
        attachment_restore_archive($directory . '/valid.tar'); // 같은 대상의 중복 복원
    }
    catch (RuntimeException $error) // 기존 원본 보호
    {
        $result['overwrite'] = true; // 덮어쓰기 거절 확인
    }
    $invalidArchive = new PharData($directory . '/invalid.tar'); // 잘못된 백업
    $invalidArchive['unexpected.php'] = '<?php echo 1;'; // 서버 난수 키가 아닌 자료
    putenv('ATTACHMENT_STORAGE_DIR=' . $directory . '/invalid'); // 별도 빈 대상
    try // 잘못된 이름 복원 검사
    {
        attachment_restore_archive($directory . '/invalid.tar'); // 신뢰 경계 밖 자료 적용 시도
    }
    catch (RuntimeException $error) // 잘못된 원본 파일 거절
    {
        $result['invalid'] = count(scandir($directory . '/invalid')) === 2; // 부분 파일 없는 거절 확인
    }
    $directoryArchive = new PharData($directory . '/directory.tar'); // 잘못된 디렉터리 원본
    $directoryArchive->addEmptyDir('unexpected'); // 평면 원본 저장소 밖 구조
    putenv('ATTACHMENT_STORAGE_DIR=' . $directory . '/directories'); // 별도 빈 대상
    try // 반복자에서 생략되는 엔트리 검사
    {
        attachment_restore_archive($directory . '/directory.tar'); // 빈 복원으로 오인할 수 있는 백업
    }
    catch (RuntimeException $error) // 처리하지 않은 엔트리 거절
    {
        $result['directories'] = true; // 조용한 원본 누락 방지
    }
}
echo json_encode($result); // 실제 복원 검사 결과
