<?php // GET CSRF 토큰 API
declare(strict_types=1); // 엄격한 자료형 검사
require_once __DIR__ . '/../includes/bootstrap.php'; // 공통 API 환경
require_method(['GET']); // GET 요청만 허용
require_query_fields([]); // 입력 없는 조회 계약
$token = csrf_token(); // 세션별 안정 토큰 조회
close_session(); // 응답 전 세션 잠금 해제
respond_success(['csrf_token' => $token]); // CSRF 토큰 반환
