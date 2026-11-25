<?php // 첨부 파일 권한과 공개 정보
declare(strict_types=1); // 엄격한 자료형 검사
require_once __DIR__ . '/direct_messages.php'; // 개인 대화 권한 검사
const ATTACHMENT_MAX_BYTES = 200000000; // 십진수 200 MB 원본 상한
function attachment_valid_size(int $size): bool // 업로드 원본의 정확한 바이트 경계
{
    return $size >= 1 && $size <= ATTACHMENT_MAX_BYTES; // 빈 파일과 200 MB 초과 거절
}
function attachment_storage_directory(): string // 비공개 원본 저장 위치
{
    $directory = getenv('ATTACHMENT_STORAGE_DIR') ?: __DIR__ . '/../../.runtime/attachments'; // 운영 볼륨 또는 개발 비공개 경로
    if (!is_dir($directory) && !mkdir($directory, 0700, true) && !is_dir($directory)) // 신규 저장소 준비
    {
        throw new RuntimeException('Attachment storage unavailable.'); // 저장소 장애의 명시적 실패
    }
    clearstatcache(true, $directory); // 신규 디렉터리의 이전 상태 캐시 해제
    $resolved = realpath($directory); // 실제 저장 위치
    if ($resolved === false) // 실제 저장 위치 확인
    {
        throw new RuntimeException('Attachment storage unavailable.'); // 잘못된 볼륨 설정 거절
    }
    return $resolved; // 실제 비공개 경로
}
function attachment_storage_path(string $key): string // DB 저장 키의 안전한 파일 경로
{
    if (!preg_match('/\A[a-f0-9]{64}\z/D', $key)) // 서버 생성 난수만 허용
    {
        throw new RuntimeException('Invalid attachment key.'); // 경로 이탈 차단
    }
    $path = attachment_storage_directory() . DIRECTORY_SEPARATOR . $key; // 고정 저장소 내부 경로
    if (is_link($path)) // 외부 파일 연결 여부
    {
        throw new RuntimeException('Invalid attachment key.'); // 심볼릭 링크 접근 차단
    }
    return $path; // 검증한 원본 위치
}
function attachment_preview_mime(string $path): ?string // 실제 디코딩을 통과한 이미지 형식
{
    if (filesize($path) > 20000000) // 이미지 검증 메모리 상한
    {
        return null; // 큰 원본은 다운로드로 제공
    }
    $info = @getimagesize($path); // 이미지 헤더와 크기 확인
    $readers = [IMAGETYPE_PNG => ['image/png', 'imagecreatefrompng'], IMAGETYPE_JPEG => ['image/jpeg', 'imagecreatefromjpeg'], IMAGETYPE_WEBP => ['image/webp', 'imagecreatefromwebp']]; // 허용한 실제 형식과 디코더
    if ($info === false || !isset($readers[$info[2]]) || $info[0] < 1 || $info[1] < 1 || $info[0] > 8192 || $info[1] > 8192 || $info[0] * $info[1] > 16000000) // 지원 형식과 이미지 메모리 경계
    {
        return null; // 미검증 또는 과도한 이미지의 inline 차단
    }
    [$mime, $reader] = $readers[$info[2]]; // 검증할 이미지 디코더
    if (!function_exists($reader)) // 런타임 이미지 기능 확인
    {
        return null; // 미지원 파일의 다운로드 유지
    }
    $image = @$reader($path); // 전체 이미지의 실제 디코딩
    if ($image === false) // 손상된 이미지 여부
    {
        return null; // 확장자 위조와 손상 파일의 inline 차단
    }
    imagedestroy($image); // 검사 메모리 해제
    return $mime; // 검증한 이미지 형식
}
function attachment_access(PDO $databaseConnection, string $kind, string $targetId, string $userId, bool $forWrite): void // 대화 권한과 잠금
{
    if ($kind === 'direct') // 개인 대화 여부
    {
        direct_access($databaseConnection, $targetId, $userId, $forWrite); // 참여자와 차단 확인
        return; // 개인 대화 검사 종료
    }
    $channelQuery = $databaseConnection->prepare('SELECT server_id FROM channels WHERE id = :id ' . ($forWrite ? 'FOR UPDATE' : 'FOR SHARE')); // 채널 잠금
    $channelQuery->execute(['id' => $targetId]); // 대상 채널 확인
    $serverId = $channelQuery->fetchColumn(); // 소속 서버 식별자
    if ($serverId === false) // 채널 존재 여부
    {
        throw new MessageAccessException('CHANNEL_NOT_FOUND', 404); // 없는 채널
    }
    $memberQuery = $databaseConnection->prepare('SELECT user_id FROM server_members WHERE server_id = :server AND user_id = :user FOR SHARE'); // 소속 잠금
    $memberQuery->execute(['server' => $serverId, 'user' => $userId]); // 현재 회원 확인
    if ($memberQuery->fetchColumn() === false) // 소속 여부
    {
        throw new MessageAccessException('FORBIDDEN', 403); // 외부 접근 차단
    }
}
function attachment_failure(Throwable $caughtException): never // 트랜잭션 종료 후 권한 오류
{
    if ($caughtException instanceof MessageAccessException || $caughtException instanceof DirectAccessException) // 권한 오류 여부
    {
        respond_error($caughtException->getMessage(), '대화에 접근할 수 없습니다.', $caughtException->getCode()); // 구체적인 내부 정보 비공개
    }
    throw $caughtException; // 나머지 내부 오류 전달
}
