<?php // get_deletion_preview 공개 관리 진입점
declare(strict_types=1); // 엄격한 자료형
$management_operation = 'get_deletion_preview'; // 고정 내부 업무 선택
require __DIR__ . '/../includes/management_endpoint.php'; // 공통 보안과 요청 처리
