import assert from "node:assert/strict"; // 실제 실행 결과 검사
import { execFileSync } from "node:child_process"; // PowerShell 실행
import path from "node:path"; // 파일 위치 구성
import test from "node:test"; // 자동 검사 도구
const helperPath = path.resolve("scripts/lan-supervisor-utils.ps1").replaceAll("'", "''"); // 실제 공통 함수 경로
function selectAddress(values) // 실제 주소 선택 함수 실행
{
    const argumentsText = values.map((value) => `'${value.replaceAll("'", "''")}'`).join(","); // 검사 입력 목록
    const command = `. '${helperPath}'; Select-SystemMakersLanAddress -Candidates @(${argumentsText})`; // 공통 함수 호출
    return execFileSync("pwsh", ["-NoProfile", "-Command", command], { encoding: "utf8" }).trim(); // 선택 주소 반환
}
test("와이파이의 유효한 사설 IPv4만 접속 주소로 선택", () => // 공인·로컬 주소 제외
{
    assert.equal(selectAddress(["127.0.0.6", "169.254.1.2", "10.0.1.157"]), "10.0.1.157"); // 실제 사설 주소 선택
    assert.equal(selectAddress(["8.8.8.8", "172.32.1.1", "192.168.0.15"]), "192.168.0.15"); // 공인 주소 제외
    assert.equal(selectAddress(["172.16.0.1"]), "172.16.0.1"); // 172 사설 범위 허용
    assert.equal(selectAddress(["0.0.0.0", "127.0.0.6", "8.8.8.8"]), ""); // 공유할 주소 없음
}); // 검사 종료
