<?php // GET 현재 사용자 API
declare(strict_types=1); // 엄격한 자료형 검사
require_once __DIR__ . '/../includes/bootstrap.php'; // 공통 API 환경
require_method(['GET']); // 메서드 우선 검사
$user = require_user(db()); // 세션과 실제 계정 확인
require_query_fields([]); // 보호된 요청 인증 후 입력 검사
close_session(); // 사용자 정보 읽기 후 잠금 해제
respond_success(['user' => $user]); // 본인 계정 정보 반환
