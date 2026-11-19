<?php // 운영 공개 주소와 실시간 수신 설정
declare(strict_types=1); // 엄격한 자료형 검사
function deployment_validate_origin(string $origin, bool $allowHttp = false): string // 경로 없는 공개 출처 검사
{
    if (!preg_match('/\A(https?):\/\/(\[[0-9a-fA-F:]+\]|[a-zA-Z0-9.-]+)(?::([0-9]{1,5}))?\z/D', $origin, $parts)) // 출처 전체 형식 검사
    {
        throw new RuntimeException('Invalid public origin.'); // 헤더와 주소 주입 차단
    }
    $scheme = $parts[1]; // 연결 방식
    $host = strtolower($parts[2]); // 호스트 대소문자 정규화
    $port = isset($parts[3]) ? (int) $parts[3] : ($scheme === 'https' ? 443 : 80); // 기본 포트 적용
    $validHost = str_starts_with($host, '[') ? filter_var(substr($host, 1, -1), FILTER_VALIDATE_IP, FILTER_FLAG_IPV6) !== false : filter_var($host, FILTER_VALIDATE_DOMAIN, FILTER_FLAG_HOSTNAME) !== false; // 도메인과 IPv6 검사
    if (!$validHost || (!$allowHttp && $scheme !== 'https') || $port < 1 || $port > 65535) // 운영 보안 조건과 포트 범위
    {
        throw new RuntimeException('Invalid public origin.'); // 잘못된 운영 설정 차단
    }
    return $scheme . '://' . $host . ($port === ($scheme === 'https' ? 443 : 80) ? '' : ':' . $port); // 브라우저와 같은 출처 표현
}
function deployment_public_origin(): ?string // 선택적 운영 출처 조회
{
    $origin = getenv('APP_PUBLIC_ORIGIN'); // 명시된 공개 주소
    if ($origin === false || $origin === '') // 기존 로컬 환경 여부
    {
        return null; // 기존 로컬 실행 유지
    }
    return deployment_validate_origin($origin, in_array(getenv('APP_ENV'), ['development', 'test'], true)); // 운영 HTTPS 강제
}
function realtime_configuration(): array // 실시간 실행 경계 확인
{
    $host = getenv('REALTIME_LISTEN_HOST') ?: '127.0.0.6'; // 기본 로컬 수신 주소
    $port = getenv('REALTIME_LISTEN_PORT') ?: '8090'; // 기본 실시간 포트
    $publicOrigin = deployment_public_origin(); // 검증된 공개 출처
    $origin = deployment_validate_origin(getenv('REALTIME_ALLOWED_ORIGIN') ?: ($publicOrigin ?? 'http://127.0.0.6:8088'), true); // 정확한 허용 출처
    $container = getenv('REALTIME_CONTAINER') === '1'; // 명시적 컨테이너 모드
    $octets = array_map('intval', explode('.', $host)); // IPv4 네트워크 구간
    $privateHost = count($octets) === 4 && ($octets[0] === 10 || ($octets[0] === 172 && $octets[1] >= 16 && $octets[1] <= 31) || ($octets[0] === 192 && $octets[1] === 168)); // 사설망 수신 구간
    $allowedHost = str_starts_with($host, '127.') || (getenv('REALTIME_ALLOW_LAN') === '1' && $privateHost) || ($container && $host === '0.0.0.0'); // 기존 로컬과 명시적 컨테이너 허용
    if (filter_var($host, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) === false || !$allowedHost || !preg_match('/\A[0-9]{1,5}\z/D', $port) || (int) $port < 1 || (int) $port > 65535 || ($container && ($publicOrigin === null || $origin !== $publicOrigin))) // 수신과 출처 계약 확인
    {
        throw new RuntimeException('Invalid realtime configuration.'); // 위험한 수신 설정 차단
    }
    return ['host' => $host, 'port' => (int) $port, 'origin' => $origin]; // 검증된 실행 값
}
