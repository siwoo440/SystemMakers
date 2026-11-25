import assert from 'node:assert/strict'; // 실제 복원 결과 검사
import { execFileSync } from 'node:child_process'; // PHP 실행
import { mkdtempSync, rmSync } from 'node:fs'; // 격리된 백업 검사 자료
import path from 'node:path'; // 독립 경로 조합
import test from 'node:test'; // 검사 도구
test('첨부 아카이브는 빈 저장소만 복원하고 잘못된 파일명은 거절', () => // 덮어쓰기와 경로 이탈 방지
{
    const directory = mkdtempSync(path.resolve('.runtime/attachment-archive-')); // 이번 검사 자료 위치
    try // 실제 tar 복원 검사
    {
        const result = execFileSync(process.env.PHP_TEST_BIN || path.resolve('.runtime/php83/php.exe'), ['-c', process.env.PHP_TEST_INI || path.resolve('.runtime/php83.ini'), 'tests/helpers/attachment-archive.php', directory], { encoding: 'utf8', windowsHide: true }); // 실제 PHP 아카이브 처리
        assert.deepEqual(JSON.parse(result), { restored: true, overwrite: true, invalid: true, directories: true }); // 원본 복원과 조용한 엔트리 누락 방지
    }
    finally // 검사 자료의 제한된 정리
    {
        rmSync(directory, { recursive: true, force: true }); // 이번에 생성한 폴더만 제거
    }
});
