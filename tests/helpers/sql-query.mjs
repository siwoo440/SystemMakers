import { execFileSync } from "node:child_process"; // 실제 PHP 실행
import path from "node:path"; // 설정 경로 조합
import { fileURLToPath } from "node:url"; // 저장소 위치 변환
const root = fileURLToPath(new URL("../../", import.meta.url)); // 저장소 기준 위치
export function querySql(port, database, statement) // 실제 MySQL 검사 전용 실행
{
    const php = process.env.PHP_TEST_BIN || path.join(root, ".runtime/php/php.exe"); // 기존 PHP 실행 환경
    return execFileSync(php, ["-c", path.join(root, ".runtime/php.ini"), fileURLToPath(new URL("./sql-query.php", import.meta.url)), String(port), database], { input: statement, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], windowsHide: true }).trim(); // 재시도 없는 실제 결과
}
