<?php // 검증된 프로필 사진 저장과 조회
 declare(strict_types=1); // 엄격한 자료형
require_once __DIR__ . '/../includes/bootstrap.php'; // 인증과 요청 검증
require_method(['GET', 'POST', 'DELETE']); // 허용 메서드
$databaseConnection = db(); // 데이터베이스 연결
$currentUser = require_user($databaseConnection); // 로그인과 계정 확인
if ($_SERVER['REQUEST_METHOD'] === 'GET') // 검증된 사진 조회
{
    require_query_fields(['user_id']); // 대상 필드만 허용
    $userId = validate_id($_GET['user_id'] ?? null, 'user_id', false, true); // 대상 식별자
    close_session(); // 세션 잠금 해제
    $databaseQuery = $databaseConnection->prepare('SELECT picture_mime,picture_data FROM user_profiles WHERE user_id=:id'); // 검증된 사진만 조회
    $databaseQuery->execute(['id' => $userId]); // 대상 계정 적용
    $picture = $databaseQuery->fetch(); // 사진 조회 결과
    if ($picture === false || $picture['picture_data'] === null || !in_array($picture['picture_mime'], ['image/png', 'image/jpeg'], true)) // 사진 없음 또는 잘못된 유형
    {
        respond_error('NOT_FOUND', '사진을 찾을 수 없습니다.', 404); // 사진 없음
    }
    header_remove('X-Powered-By'); // PHP 정보 숨김
    header('Content-Type: ' . $picture['picture_mime']); // 검증된 이미지 형식
    header('Content-Length: ' . strlen($picture['picture_data'])); // 실제 바이트 수
    header('Content-Disposition: inline'); // 브라우저 이미지 표시
    header('Cache-Control: no-store'); // 개인 상태 캐시 방지
    header('X-Content-Type-Options: nosniff'); // 형식 추측 차단
    echo $picture['picture_data']; // 재인코딩된 이미지
    exit; // 추가 출력 방지
}
require_query_fields([]); // 변경 요청 조회 조건 차단
require_csrf(); // 요청 위조 방지
if ($_SERVER['REQUEST_METHOD'] === 'DELETE') // 본인 사진 제거
{
    close_session(); // DB 작업 전 세션 해제
    $databaseQuery = $databaseConnection->prepare('UPDATE user_profiles SET picture_mime=NULL,picture_data=NULL WHERE user_id=:id'); // 상태 메시지 유지
    $databaseQuery->execute(['id' => $currentUser['id']]); // 본인 사진만 제거
    respond_success(['has_picture' => false]); // 삭제 결과
}
$contentLength = $_SERVER['CONTENT_LENGTH'] ?? ''; // 전체 요청 크기
if (!ctype_digit((string) $contentLength) || (int) $contentLength > 1100000) // multipart 상한
{
    respond_error('PAYLOAD_TOO_LARGE', '사진 크기를 확인하세요.', 413); // 큰 요청 차단
}
if (strtolower(trim(explode(';', $_SERVER['CONTENT_TYPE'] ?? '')[0])) !== 'multipart/form-data') // multipart 유형 검사
{
    respond_error('UNSUPPORTED_MEDIA_TYPE', '이미지 파일 요청이 필요합니다.', 415); // 요청 형식 오류
}
if ($_POST !== [] || array_keys($_FILES) !== ['picture'] || !is_array($_FILES['picture'])) // 불필요한 필드와 파일 검사
{
    respond_error('VALIDATION_ERROR', '사진 파일을 확인하세요.', 422); // 파일 필드 오류
}
$upload = $_FILES['picture']; // PHP 업로드 결과
if (($upload['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK || !is_string($upload['tmp_name'] ?? null) || !is_uploaded_file($upload['tmp_name'])) // 업로드 출처와 오류 검사
{
    respond_error('VALIDATION_ERROR', '사진 파일을 확인하세요.', 422); // 업로드 오류
}
$fileSize = filesize($upload['tmp_name']); // 실제 파일 바이트
if ($fileSize === false || $fileSize < 1 || $fileSize > 1048576) // 실제 파일 크기 검사
{
    respond_error('VALIDATION_ERROR', '사진은 1 MiB 이하여야 합니다.', 422); // 사진 크기 오류
}
if (!function_exists('imagecreatefromstring') || !function_exists('imagepng') || !function_exists('imagejpeg')) // 이미지 디코더 확인
{
    respond_error('IMAGE_UNAVAILABLE', '사진 처리를 사용할 수 없습니다.', 503); // 이미지 처리 기능 부재
}
$pictureBytes = file_get_contents($upload['tmp_name']); // 임시 파일 본문
try // 잘못된 파일의 경고 차단
{
    $imageInfo = $pictureBytes === false ? false : getimagesizefromstring($pictureBytes); // 실제 이미지 헤더 검사
}
catch (Throwable $caughtException) // 손상된 헤더
{
    $imageInfo = false; // 형식 오류 처리
}
if ($imageInfo === false || !in_array($imageInfo[2] ?? 0, [IMAGETYPE_PNG, IMAGETYPE_JPEG], true) || $imageInfo[0] < 1 || $imageInfo[1] < 1 || $imageInfo[0] > 4096 || $imageInfo[1] > 4096 || $imageInfo[0] * $imageInfo[1] > 4000000) // 허용 형식과 디코딩 전 픽셀 상한
{
    respond_error('VALIDATION_ERROR', '올바른 PNG 또는 JPEG 사진이 필요합니다.', 422); // 안전하지 않은 이미지
}
$bufferLevel = ob_get_level(); // 기존 출력 버퍼 단계
try // 실제 디코딩과 재인코딩
{
    $image = imagecreatefromstring($pictureBytes); // 실제 이미지 복원
    if ($image === false) // 디코딩 실패
    {
        throw new RuntimeException('Invalid image.'); // 실패 처리
    }
    imagesavealpha($image, true); // PNG 투명도 보존
    ob_start(); // 재인코딩 결과 수집
    $encoded = $imageInfo[2] === IMAGETYPE_PNG ? imagepng($image) : imagejpeg($image, null, 90); // 안전한 이미지 본문 생성
    $encodedBytes = ob_get_clean(); // 출력 버퍼 회수
    imagedestroy($image); // 이미지 메모리 해제
    if (!$encoded || !is_string($encodedBytes) || strlen($encodedBytes) > 4194304) // 인코딩 결과와 크기 검사
    {
        throw new RuntimeException('Image encoding failed.'); // 실패 처리
    }
}
catch (Throwable $caughtException) // 손상된 본문과 변환 실패
{
    while (ob_get_level() > $bufferLevel) // 새 출력 버퍼
    {
        ob_end_clean(); // 부분 이미지 출력 제거
    }
    respond_error('VALIDATION_ERROR', '올바른 PNG 또는 JPEG 사진이 필요합니다.', 422); // 검증 실패
}
$pictureMime = $imageInfo[2] === IMAGETYPE_PNG ? 'image/png' : 'image/jpeg'; // 서버가 확인한 형식
close_session(); // DB 작업 전 세션 해제
$databaseQuery = $databaseConnection->prepare("INSERT INTO user_profiles (user_id,picture_mime,picture_data) VALUES (:id,:mime,:data) ON DUPLICATE KEY UPDATE picture_mime=VALUES(picture_mime),picture_data=VALUES(picture_data)"); // 본인 사진만 저장
$databaseQuery->bindValue(':id', $currentUser['id'], PDO::PARAM_STR); // 문자열 계정 ID
$databaseQuery->bindValue(':mime', $pictureMime, PDO::PARAM_STR); // 실제 이미지 유형
$databaseQuery->bindValue(':data', $encodedBytes, PDO::PARAM_LOB); // 재인코딩 바이너리
$databaseQuery->execute(); // 사진과 형식 원자적 저장
respond_success(['has_picture' => true]); // 저장 완료
