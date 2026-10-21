<?php // GET DB 연결 상태 API
declare(strict_types=1); // 엄격한 자료형 검사
require_once __DIR__ . '/../includes/bootstrap.php'; // 공통 API 환경
require_method(['GET']); // GET 요청만 허용
require_query_fields([]); // 입력 없는 조회 계약
db()->query('SELECT 1')->fetchColumn(); // 실제 DB 연결과 쿼리 확인
respond_success(['status' => 'ok']); // 설정 비노출 상태 반환
