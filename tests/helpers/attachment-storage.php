<?php // 실제 파일과 이미지 판별 검사
declare(strict_types=1); // 엄격한 자료형 검사
require_once __DIR__ . '/../../backend/includes/attachments.php'; // 실제 첨부 함수
$directory = getenv('ATTACHMENT_STORAGE_DIR'); // 검사 전용 경로
$result = ['maximum' => defined('ATTACHMENT_MAX_BYTES') ? ATTACHMENT_MAX_BYTES : null]; // 공개 업로드 상한
foreach (['png', 'jpeg', 'webp'] as $format) // 허용할 이미지 형식
{
    $file = $directory . '/' . $format; // 독립 검사 파일
    $image = imagecreatetruecolor(2, 2); // 작은 실제 이미지
    $writer = 'image' . $format; // 해당 GD 인코더
    $writer($image, $file); // 실제 이미지 기록
    imagedestroy($image); // 이미지 메모리 해제
    $result[$format] = function_exists('attachment_preview_mime') ? attachment_preview_mime($file) : null; // 실제 디코더 결과
}
file_put_contents($directory . '/fake', 'not an image'); // 확장자 위조 자료
file_put_contents($directory . '/svg', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'); // 실행 가능한 비허용 형식
$result['fake'] = function_exists('attachment_preview_mime') ? attachment_preview_mime($directory . '/fake') : null; // 잘못된 내용 거절
$result['svg'] = function_exists('attachment_preview_mime') ? attachment_preview_mime($directory . '/svg') : null; // SVG 미리보기 거절
$result['traversal'] = false; // 경로 이탈 검사 결과
$result['boundary'] = function_exists('attachment_valid_size') && attachment_valid_size(200000000) && !attachment_valid_size(200000001) && !attachment_valid_size(0); // 업로드 API가 사용하는 정확한 크기 경계
if (function_exists('attachment_storage_path')) // 저장소 함수 구현 여부
{
    try // 잘못된 저장 키 검사
    {
        attachment_storage_path('../secret'); // 비공개 경로 이탈 시도
    }
    catch (RuntimeException $error) // 잘못된 키 거절
    {
        $result['traversal'] = true; // 이탈 차단 확인
    }
}
echo json_encode($result); // 실제 검사 결과
