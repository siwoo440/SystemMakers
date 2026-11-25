import assert from 'node:assert/strict'; // 실제 PHP 결과 검사
import { execFileSync } from 'node:child_process'; // 별도 PHP 프로세스
import { mkdtempSync, rmSync } from 'node:fs'; // 격리된 저장소 준비와 정리
import path from 'node:path'; // 검사 경로 조합
import test from 'node:test'; // 검사 도구
test('첨부 저장소는 200 MB 상한과 검증된 이미지 및 비공개 키만 허용', () => // 실제 파일 저장 경계
{
    const directory = mkdtempSync(path.resolve('.runtime/attachment-unit-')); // 검사 전용 디렉터리
    try // 오류 시 검사 자료 정리
    {
        const result = execFileSync(process.env.PHP_TEST_BIN || path.resolve('.runtime/php83/php.exe'), ['-c', process.env.PHP_TEST_INI || path.resolve('.runtime/php83.ini'), 'tests/helpers/attachment-storage.php'], { env: { ...process.env, ATTACHMENT_STORAGE_DIR: directory }, encoding: 'utf8', windowsHide: true }); // 실제 PHP와 이미지 디코더 실행
        assert.deepEqual(JSON.parse(result), { maximum: 200000000, png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp', fake: null, svg: null, traversal: true, boundary: true }); // 보안 경계별 실제 결과
    }
    finally // 이번 검사 저장소만 정리
    {
        rmSync(directory, { recursive: true, force: true }); // 격리된 생성 자료 제거
    }
});
