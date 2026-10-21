<?php // 초대 발급과 참여 횟수 제한
declare(strict_types=1); // 엄격한 자료형
function consume_management_attempt(PDO $pdo, string $user_id, bool $issue): void // 업무와 독립된 요청 집계
{
    $secret = getenv('AUTH_RATE_LIMIT_KEY'); // 기존 서버 전용 HMAC 키
    if (!is_string($secret) || strlen($secret) < 32) // 설정 오류 차단
    {
        throw new RuntimeException('Invalid limiter configuration.'); // 제한 없는 요청 방지
    }
    $targets = $issue ? ['invite_issue_user' => [$user_id, 10]] : ['invite_join_user' => [$user_id, 10]]; // 계정별 제한
    if (!$issue) // 참여의 추가 IP 경계
    {
        $packed = inet_pton($_SERVER['REMOTE_ADDR'] ?? ''); // 실제 연결 IP 정규화
        if ($packed === false) // 잘못된 주소 차단
        {
            throw new RuntimeException('Invalid peer address.'); // 제한 우회 방지
        }
        $targets['invite_join_ip'] = [inet_ntop($packed), 100]; // IP별 참여 상한
    }
    $buckets = []; // 잠글 버킷 목록
    foreach ($targets as $scope => [$target, $maximum]) // 범위별 HMAC 준비
    {
        $key = hash_hmac('sha256', "management\0" . $scope . "\0" . $target, $secret); // 원문 없는 범위 분리
        $buckets[$key] = [$scope, $maximum]; // 안정된 잠금 대상
    }
    ksort($buckets, SORT_STRING); // 같은 잠금 순서
    for ($retry = 0; $retry < 3; $retry++) // 제한된 충돌 재시도
    {
        try // 버킷 전체의 원자적 판정
        {
            $pdo->beginTransaction(); // 독립 집계 시작
            $rows = []; // 잠긴 상태
            foreach ($buckets as $key => [$scope, $maximum]) // 키 순서 잠금
            {
                $query = $pdo->prepare('INSERT INTO management_rate_limits (bucket_key, scope, attempts, window_started_at, updated_at) VALUES (:key, :scope, 0, UTC_TIMESTAMP(), UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE bucket_key=bucket_key'); // 버킷 확보
                $query->execute(['key' => $key, 'scope' => $scope]); // 신규 또는 기존 잠금
                $query = $pdo->prepare('SELECT attempts, UNIX_TIMESTAMP(window_started_at) AS started FROM management_rate_limits WHERE bucket_key=:key FOR UPDATE'); // 최신 상태
                $query->execute(['key' => $key]); // 버킷 읽기
                $rows[$key] = $query->fetch(); // 상태 보관
            }
            $now = (int) $pdo->query('SELECT UNIX_TIMESTAMP(UTC_TIMESTAMP())')->fetchColumn(); // 잠금 후 DB 현재 시각
            $remaining = 0; // 가장 긴 대기 시간
            foreach ($buckets as $key => [$scope, $maximum]) // 모든 범위 상한 판정
            {
                $age = $now - (int) $rows[$key]['started']; // 현재 창 경과
                if ($age < 600 && (int) $rows[$key]['attempts'] >= $maximum) // 아직 제한된 창
                {
                    $remaining = max($remaining, 600 - $age); // 최대 대기 시간
                }
            }
            if ($remaining > 0) // 하나 이상의 제한
            {
                $pdo->rollBack(); // 다른 버킷도 집계하지 않음
                header('Retry-After: ' . $remaining); // 표준 재시도 안내
                throw new ManagementException('RATE_LIMITED', 429); // 공통 제한 응답
            }
            foreach ($buckets as $key => [$scope, $maximum]) // 허용한 시도만 집계
            {
                $expired = $now - (int) $rows[$key]['started'] >= 600; // 정확한 창 만료
                $query = $pdo->prepare('UPDATE management_rate_limits SET attempts=:attempts, window_started_at=FROM_UNIXTIME(:started), updated_at=UTC_TIMESTAMP() WHERE bucket_key=:key'); // 새 창 또는 누적
                $query->execute(['attempts' => $expired ? 1 : (int) $rows[$key]['attempts'] + 1, 'started' => $expired ? $now : (int) $rows[$key]['started'], 'key' => $key]); // 모든 버킷 갱신
            }
            $pdo->commit(); // 업무 실패와 무관하게 시도 보존
            return; // 집계 종료
        }
        catch (Throwable $error) // 충돌과 업무 오류 처리
        {
            if ($pdo->inTransaction()) // 미완료 집계 확인
            {
                $pdo->rollBack(); // 부분 집계 방지
            }
            if ($error instanceof PDOException && in_array((int) ($error->errorInfo[1] ?? 0), [1205, 1213], true) && $retry < 2) // 잠금 충돌만 재시도
            {
                continue; // 새 집계 시도
            }
            throw $error; // 제한 또는 실제 오류 전달
        }
    }
}
