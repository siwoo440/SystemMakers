import assert from 'node:assert/strict'; // 결과 검증
import { execFileSync } from 'node:child_process'; // PHP 실행
import path from 'node:path'; // 실행 경로
import test from 'node:test'; // 검사 도구
const root = process.cwd(); // 저장소 경로
const php = process.env.PHP_TEST_BIN || path.join(root, '.runtime/php/php.exe'); // 검사 PHP
const relay = path.join(root, 'backend/realtime/MessageRelay.php'); // 검사 대상
function compare(left, right) // 큰 식별자 비교 실행
{
    const source = `require ${JSON.stringify(relay.replaceAll('\\', '/'))}; echo realtime_compare_ids(${JSON.stringify(left)}, ${JSON.stringify(right)});`; // 실제 함수 호출
    return execFileSync(php, ['-r', source], { encoding: 'utf8' }).trim(); // 비교 결과 반환
}
test('부호 없는 64비트 메시지 식별자는 정수 변환 없이 정확하게 비교', () => // 큰 커서 정렬 보장
{
    assert.equal(compare('18446744073709551614', '18446744073709551615'), '-1'); // 최대값 직전 순서
    assert.equal(compare('100', '99'), '1'); // 길이가 다른 식별자 순서
    assert.equal(compare('42', '42'), '0'); // 같은 식별자 순서
}); // 검증 종료
