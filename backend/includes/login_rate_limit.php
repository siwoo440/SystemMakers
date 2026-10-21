<?php // DB 공유 로그인 횟수 제한
declare(strict_types=1); // 엄격한 자료형 검사
function consume_login_attempt(PDO $pdo, string $email): void // 이메일과 접속 IP의 원자적 허용 판정
{
    $secret = getenv('AUTH_RATE_LIMIT_KEY'); // 별도 HMAC 비밀 키
    if (!is_string($secret) || strlen($secret) < 32) // 키 누락과 짧은 키 차단
    {
        throw new RuntimeException('Invalid authentication configuration.'); // 제한 없는 로그인 방지
    }
    $address = $_SERVER['REMOTE_ADDR'] ?? ''; // 실제 연결 상대 주소
    $packed = is_string($address) ? inet_pton($address) : false; // 표준 IP 바이트 변환
    if ($packed === false) // 유효한 접속 IP 여부
    {
        throw new RuntimeException('Invalid peer address.'); // IP 제한 우회 차단
    }
    $canonical = inet_ntop($packed); // IPv4와 IPv6 표준 표현
    $buckets = []; // 제한 대상의 익명화 목록
    foreach (['login_email' => [$email, 5], 'login_ip' => [$canonical, 30]] as $scope => [$target, $maximum]) // 범위별 상한
    {
        $key = hash_hmac('sha256', $scope . "\0" . $target, $secret); // 범위 분리 HMAC 키
        $buckets[$key] = ['scope' => $scope, 'maximum' => $maximum]; // 원문 없는 버킷 정보
    }
    ksort($buckets, SORT_STRING); // 요청 전체의 동일 잠금 순서
    for ($retry = 0; $retry < 3; $retry++) // 교착과 잠금 시간 초과의 제한 재시도
    {
        try // 전체 버킷 판정 트랜잭션
        {
            $pdo->beginTransaction(); // 두 버킷 원자성 시작
            $rows = []; // 잠긴 버킷 상태
            foreach ($buckets as $key => $bucket) // HMAC 키 오름차순 잠금
            {
                $insert = $pdo->prepare('INSERT INTO auth_rate_limits (bucket_key, scope, attempts, window_started_at, updated_at) VALUES (:key, :scope, 0, UTC_TIMESTAMP(), UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE bucket_key = bucket_key'); // 새 버킷 확보와 기존 버킷 잠금
                $insert->execute(['key' => $key, 'scope' => $bucket['scope']]); // 중복을 유지한 배타 잠금
                $query = $pdo->prepare('SELECT attempts, UNIX_TIMESTAMP(window_started_at) AS started FROM auth_rate_limits WHERE bucket_key = :key FOR UPDATE'); // 잠긴 현재 창 읽기
                $query->execute(['key' => $key]); // 버킷 상태 조회
                $rows[$key] = $query->fetch(); // 현재 창과 누적 횟수
            }
            $now = (int) $pdo->query('SELECT UNIX_TIMESTAMP(UTC_TIMESTAMP())')->fetchColumn(); // 모든 잠금 확보 뒤 DB 현재 시각
            $remaining = 0; // 제한된 창의 최대 남은 초
            foreach ($buckets as $key => $bucket) // 만료와 제한 판정
            {
                $row = $rows[$key]; // 잠긴 버킷 상태
                $expired = $now - (int) $row['started'] >= 900; // 15분 고정 창 만료
                $rows[$key]['expired'] = $expired; // 업데이트 시 초기화 여부
                if (!$expired && (int) $row['attempts'] >= $bucket['maximum']) // 현재 창의 상한 도달
                {
                    $remaining = max($remaining, 1, (int) $row['started'] + 900 - $now); // 제한된 창 중 최대 대기
                }
            }
            if ($remaining > 0) // 어느 한 버킷이라도 제한 도달
            {
                $pdo->rollBack(); // 두 버킷 모두 변경 취소
                header('Retry-After: ' . $remaining); // 정수 재시도 대기
                respond_error('RATE_LIMITED', '로그인 시도가 많습니다. 잠시 후 다시 시도하세요.', 429); // 비밀번호 검사 전 차단
            }
            foreach ($rows as $key => $row) // 허용된 요청만 양쪽 증가
            {
                $update = $pdo->prepare('UPDATE auth_rate_limits SET attempts = :attempts, window_started_at = FROM_UNIXTIME(:started), updated_at = FROM_UNIXTIME(:updated) WHERE bucket_key = :key'); // 허용 횟수와 고정 창 저장
                $update->execute(['attempts' => $row['expired'] ? 1 : (int) $row['attempts'] + 1, 'started' => $row['expired'] ? $now : (int) $row['started'], 'updated' => $now, 'key' => $key]); // 만료 창만 새 시작 시각
            }
            $pdo->commit(); // 해시 검사 전에 허용 시도 확정
            return; // 인증 성공과 무관한 횟수 유지
        }
        catch (PDOException $exception) // SQL 실패와 교착 처리
        {
            if ($pdo->inTransaction()) // 열린 트랜잭션 여부
            {
                $pdo->rollBack(); // 부분 버킷 변경 취소
            }
            if ($retry < 2 && in_array((int) ($exception->errorInfo[1] ?? 0), [1205, 1213], true)) // 재시도 가능한 잠금 충돌
            {
                usleep(random_int(10000, 30000)); // 짧은 무작위 충돌 분산
                continue; // 동일 순서로 전체 재시도
            }
            throw $exception; // 재시도 초과의 공통 내부 오류
        }
        catch (Throwable $exception) // SQL 이외 트랜잭션 실패
        {
            if ($pdo->inTransaction()) // 부분 변경 존재 여부
            {
                $pdo->rollBack(); // 안전한 전체 롤백
            }
            throw $exception; // 공통 내부 오류 처리
        }
    }
}
