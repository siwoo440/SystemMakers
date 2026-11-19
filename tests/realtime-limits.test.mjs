import assert from 'node:assert/strict'; // 결과 검사
import { execFileSync } from 'node:child_process'; // 실제 PHP 실행
import path from 'node:path'; // 실행 경로
import test from 'node:test'; // 검사 도구
test('실제 WebSocket 버퍼가 큰 프레임과 분할 누적 및 느린 수신 거절', () => // 라이브러리 경계 검사
{
    const phpBinary = process.env.PHP_TEST_BIN || path.resolve('.runtime/php83/php.exe'); // PHP 위치
    const result = execFileSync(phpBinary, ['-c', process.env.PHP_TEST_INI || path.resolve('.runtime/php83.ini'), 'tests/helpers/realtime-limits.php'], { encoding: 'utf8', windowsHide: true }); // 실제 프로토콜 검사
    assert.deepEqual(JSON.parse(result), { normal: true, large: true, fragmented: true, slow: true, emptyFragments: true }); // 모든 제한 검사
});
