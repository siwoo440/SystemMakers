<?php // 이미지의 필수 실행 기능 확인
declare(strict_types=1); // 엄격한 자료형 검사
foreach (['pdo_mysql', 'mbstring', 'gd'] as $extensionName) // 기존 앱 필수 확장
{
    if (!extension_loaded($extensionName)) // 확장 누락 여부
    {
        exit(1); // 불완전한 이미지 거절
    }
}
if (!in_array('argon2id', password_algos(), true) || PHP_INT_SIZE !== 8) // 비밀번호 해시와 식별자 구조 지원
{
    exit(1); // 지원하지 않는 런타임 거절
}
if (!function_exists('imagecreatefromwebp') || !(gd_info()['WebP Support'] ?? false)) // 검증한 WebP 미리보기 기능
{
    exit(1); // 미리보기 기능 없는 이미지 거절
}
