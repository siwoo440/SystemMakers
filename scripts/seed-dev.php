<?php // 기존 가입 계정의 개발용 채팅 공간 준비
declare(strict_types=1); // 엄격한 자료형 검사
if (PHP_SAPI !== 'cli') // 웹 실행 차단
{
    http_response_code(404); // 비공개 스크립트 상태
    exit; // 웹 호출 종료
}
if (!in_array(getenv('APP_ENV'), ['development', 'test'], true)) // 개발과 테스트 환경 제한
{
    fwrite(STDERR, "개발 또는 테스트 환경에서만 실행할 수 있습니다.\n"); // 운영 실행 거절 안내
    exit(1); // 실패 종료 상태
}
require_once __DIR__ . '/../backend/config/database.php'; // 명시적 환경 설정의 PDO 연결
$pdo = null; // 롤백할 연결 보관
try // 부분 생성과 비밀 오류 노출 방지
{
    $options = getopt('', ['owner:', 'member:'], $argument_end); // 기존 계정 지정 옵션
    if ($argument_end !== count($argv) || !isset($options['owner']) || !is_string($options['owner'])) // 미지원 인수와 소유자 누락 확인
    {
        throw new InvalidArgumentException('Invalid arguments.'); // 잘못된 실행 인수 차단
    }
    $owner_name = strtolower(trim($options['owner'])); // 소유자 사용자명 정규화
    $members = $options['member'] ?? []; // 선택한 추가 멤버 목록
    $members = is_array($members) ? $members : [$members]; // 반복 옵션 자료형 통일
    $names = [$owner_name]; // 소유자를 포함한 대상 목록
    foreach ($members as $member) // 명시한 추가 계정 순회
    {
        if (!is_string($member)) // 잘못된 옵션 값 확인
        {
            throw new InvalidArgumentException('Invalid member.'); // 비문자 계정 차단
        }
        $names[] = strtolower(trim($member)); // 멤버 사용자명 정규화
    }
    $names = array_values(array_unique($names)); // 중복 계정 제거
    foreach ($names as $name) // 허용된 사용자명 검증
    {
        if (!preg_match('/\A[a-z0-9_]{3,32}\z/D', $name)) // 가입 계약과 같은 사용자명 범위
        {
            throw new InvalidArgumentException('Invalid username.'); // 잘못된 계정 입력 거절
        }
    }
    $pdo = db(); // 준비 대상 DB 연결
    $pdo->beginTransaction(); // 전체 개발 데이터 원자성 시작
    $lookup = $pdo->prepare('SELECT id, username FROM users WHERE username IN (' . implode(',', array_fill(0, count($names), '?')) . ') ORDER BY id FOR UPDATE'); // 기존 계정의 일관된 잠금 순서
    $lookup->execute($names); // 준비할 실제 계정 조회
    $users = array_column($lookup->fetchAll(), 'id', 'username'); // 사용자명별 실제 ID
    if (count($users) !== count($names)) // 가입되지 않은 대상 확인
    {
        throw new RuntimeException('Account missing.'); // 임의 계정 생성 차단
    }
    $owner_id = (string) $users[$owner_name]; // 실제 소유자 ID
    $server_name = 'SystemMakers 개발 서버'; // 개발 전용 공간 이름
    $find = $pdo->prepare('SELECT id FROM servers WHERE owner_id = :owner AND name = :name ORDER BY id LIMIT 1 FOR UPDATE'); // 같은 소유자의 준비된 공간 확인
    $find->execute(['owner' => $owner_id, 'name' => $server_name]); // 반복 실행 대상 조회
    $server_id = $find->fetchColumn(); // 기존 공간 또는 없음
    if ($server_id === false) // 최초 실행 여부
    {
        $create = $pdo->prepare('INSERT INTO servers (name, owner_id) VALUES (:name, :owner)'); // 개발 공간 생성 쿼리
        $create->execute(['name' => $server_name, 'owner' => $owner_id]); // 실제 소유자 지정
        $server_id = $pdo->lastInsertId(); // 생성된 서버 문자열 ID
    }
    foreach ($users as $id) // 지정한 기존 계정만 소속 준비
    {
        $owner = (string) $id === $owner_id; // 서버 소유자 여부
        $insert = $pdo->prepare('INSERT INTO server_members (server_id, user_id, role) VALUES (:server, :user, :role) ON DUPLICATE KEY UPDATE role = ' . ($owner ? "'owner'" : 'role')); // 기존 일반 멤버의 관리 역할 보존
        $insert->execute(['server' => $server_id, 'user' => $id, 'role' => $owner ? 'owner' : 'member']); // 서버 소속 준비
    }
    foreach (['일반', '개발', '공지'] as $name) // 최초 개발 채널 목록
    {
        $insert = $pdo->prepare('INSERT INTO channels (server_id, name) VALUES (:server, :name) ON DUPLICATE KEY UPDATE name = name'); // 기존 채널을 지우지 않는 생성
        $insert->execute(['server' => $server_id, 'name' => $name]); // 중복 없는 채널 준비
    }
    $channels = $pdo->prepare('SELECT id FROM channels WHERE server_id = :server ORDER BY id'); // 준비한 채널 식별자 조회
    $channels->execute(['server' => $server_id]); // 실제 결과 조회
    $channel_ids = array_map('strval', $channels->fetchAll(PDO::FETCH_COLUMN)); // 문자열 ID 배열
    $pdo->commit(); // 전체 개발 데이터 준비 확정
    fwrite(STDOUT, json_encode(['success' => true, 'data' => ['server_id' => (string) $server_id, 'channel_ids' => $channel_ids]], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR) . "\n"); // 비밀 없는 준비 결과
}
catch (Throwable $exception) // 설정과 계정 및 SQL 오류 처리
{
    if ($pdo instanceof PDO && $pdo->inTransaction()) // 부분 데이터 생성 여부
    {
        $pdo->rollBack(); // 전체 준비 취소
    }
    fwrite(STDERR, "개발 데이터 준비에 실패했습니다. 환경 설정과 기존 사용자명을 확인하세요.\n"); // 접속 정보 없는 오류 안내
    exit(1); // 실패 종료 상태
}
