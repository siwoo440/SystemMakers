<?php // 서버 관리 API 공통 HTTP 경계
declare(strict_types=1); // 엄격한 자료형
require_once __DIR__ . '/bootstrap.php'; // 기존 보안과 JSON 처리
require_once __DIR__ . '/server_management.php'; // 관리 업무
require_once __DIR__ . '/management_rate_limit.php'; // 독립 요청 집계
$contracts = [ // 고정된 필드 계약
    'list_servers' => ['GET', []], // 내 서버 목록
    'create_server' => ['POST', ['name']], // 서버와 기본 채널 생성
    'get_server_invite' => ['GET', ['server_id']], // 초대 상태 조회
    'create_server_invite' => ['POST', ['server_id']], // 새 코드 발급
    'revoke_server_invite' => ['POST', ['server_id']], // 현재 코드 폐기
    'join_server' => ['POST', ['code']], // 코드로 참여
    'leave_server' => ['POST', ['server_id']], // 본인 탈퇴
    'get_deletion_preview' => ['GET', ['resource_type', 'resource_id']], // 영향 미리보기
    'delete_server' => ['POST', ['server_id', 'confirm_name']], // 이름 확인 삭제
]; // 계약 목록 종료
[$method, $fields] = $contracts[$management_operation]; // 고정 진입점의 계약
require_method([$method]); // 메서드 우선 검사
$pdo = db(); // 실제 DB 연결
$user = require_user($pdo); // 본문 전 계정 확인
if ($method === 'GET') // 읽기 요청
{
    require_query_fields($fields); // 중복·미허용 쿼리 차단
    $input = $_GET; // 검증할 원본 값
}
else // 상태 변경 요청
{
    $input = read_json_body(); // 크기와 JSON 검사
    require_csrf(); // 위조 요청 차단
    require_body_fields($input, $fields); // 필수·미허용 필드
}
foreach ($fields as $field) // 필드별 엄격한 형식 검사
{
    $value = $input[$field] ?? null; // 누락 포함 원본 값
    if (in_array($field, ['server_id', 'resource_id'], true)) // 문자열 ID 필드
    {
        $input[$field] = validate_id($value, $field, false, $method === 'GET'); // 기존 ID 범위 계약
    }
    elseif (in_array($field, ['name', 'confirm_name'], true)) // 한 줄 자원 이름
    {
        $value = validate_string($value, $field, 1, 32768); // 기존 JSON 바이트 한도 안의 정규화 전 원문
        if (preg_match('/[\x{0000}-\x{001F}\x{007F}-\x{009F}]/u', $value)) // 줄바꿈 등 제어 문자
        {
            respond_error('VALIDATION_ERROR', '이름에는 제어 문자를 사용할 수 없습니다.', 422, [$field => '한 줄 이름을 입력하세요.']); // 명확한 필드 오류
        }
        $input[$field] = validate_string(preg_replace('/\A\p{Z}+|\p{Z}+\z/u', '', $value), $field, 1, 100); // 앞뒤 구분 공백 정리
    }
    elseif ($field === 'code') // 초대 코드 입력
    {
        if (!is_string($value) || !preg_match('/\A[a-f0-9]{64}\z/D', trim($value, ' '))) // 정확한 소문자 코드
        {
            respond_error('VALIDATION_ERROR', '초대 코드 형식을 확인하세요.', 422, ['code' => '64자리 초대 코드가 필요합니다.']); // 형식 오류
        }
        $input[$field] = trim($value, ' '); // ASCII 공백만 정리
    }
    elseif (!in_array($value, ['server', 'channel'], true)) // 미리보기 대상 종류
    {
        respond_error('INVALID_QUERY', '삭제 대상을 확인하세요.', 400); // 제한된 대상만 허용
    }
}
close_session(); // DB 잠금 전 세션 해제
try // 업무 도메인 오류 변환
{
    if ($management_operation === 'create_server_invite') // 권한 확인 후 발급 집계
    {
        management_actor($pdo, management_server($pdo, $input['server_id'], false), $user['id'], true, false); // 잠금 없는 사전 소유자 검사
        consume_management_attempt($pdo, $user['id'], true); // 업무 재시도 전에 한 번 집계
    }
    elseif ($management_operation === 'join_server') // 코드 확인 전 시도 집계
    {
        consume_management_attempt($pdo, $user['id'], false); // 성공·무효 코드 모두 집계
    }
    $result = run_management($pdo, $management_operation, $user['id'], $input); // 현재 권한 재검사와 업무
    respond_success($result['data'], $result['status']); // 커밋된 공개 결과
}
catch (ManagementException $error) // 정책에 따른 실패 안내
{
    if ($management_operation === 'join_server' && $error->getMessage() === 'SERVER_NOT_FOUND') // 후보 조회 뒤 서버 삭제 경합
    {
        $error = new ManagementException('INVALID_INVITE', 400); // 코드의 일반 무효 계약 유지
    }
    $messages = ['FORBIDDEN' => '이 작업에 접근할 수 없습니다.', 'SERVER_NOT_FOUND' => '서버를 찾을 수 없습니다.', 'CHANNEL_NOT_FOUND' => '채널을 찾을 수 없습니다.', 'INVALID_INVITE' => '초대 코드가 유효하지 않습니다.', 'OWNER_CANNOT_LEAVE' => '소유자는 서버에서 탈퇴할 수 없습니다.', 'NAME_MISMATCH' => '현재 이름을 다시 확인하세요.', 'RATE_LIMITED' => '요청이 많습니다. 잠시 후 다시 시도하세요.']; // 정보 노출 없는 문구
    respond_error($error->getMessage(), $messages[$error->getMessage()] ?? '요청을 처리할 수 없습니다.', $error->getCode()); // 공통 오류 계약
}
