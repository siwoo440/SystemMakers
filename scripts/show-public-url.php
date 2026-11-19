<?php // 설정한 웹 주소와 WSS 진단 주소 출력
declare(strict_types=1); // 엄격한 자료형 검사
if (PHP_SAPI !== 'cli') // 웹 실행 차단
{
    exit(1); // 비공개 도구 종료
}
require_once __DIR__ . '/../backend/includes/deployment.php'; // 공개 출처 검증
try // 잘못된 주소의 비공개 오류 처리
{
    $origin = deployment_public_origin(); // 명시된 실제 공개 주소
    if ($origin === null) // 도메인 미설정 여부
    {
        throw new RuntimeException('공개 주소 설정 필요'); // 가짜 링크 생성 차단
    }
    fwrite(STDOUT, '웹 접속: ' . $origin . '/Team006/index.html' . PHP_EOL); // 사용자용 링크 출력
    fwrite(STDOUT, 'WSS 진단: ' . preg_replace('/\Ahttp/', 'ws', $origin) . '/Team006/realtime' . PHP_EOL); // 실시간 진단 주소 출력
    fwrite(STDOUT, '상태: 설정 주소이며 실제 외부 접속 확인 필요' . PHP_EOL); // 설정과 검증 결과 구분
}
catch (Throwable $caughtException) // 누락 또는 잘못된 설정
{
    fwrite(STDERR, '공개 주소 설정 확인 필요' . PHP_EOL); // 비밀 없는 안내
    exit(1); // 주소 출력 실패
}
