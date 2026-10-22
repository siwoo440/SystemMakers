import assert from "node:assert/strict"; // 실제 출력 검증
import test from "node:test"; // 기본 검사 실행
import { querySql } from "./helpers/sql-query.mjs"; // 실제 검사 DB 연결
test("SQL 검사 도구의 복수 결과·이스케이프·오류·개발 DB 차단", () => // 검사 결과 신뢰 경계
{
    assert.equal(querySql("33361", "", "SELECT NULL, CHAR(9), CHAR(10), CHAR(92), '한글😀'; SELECT 12345;"), "NULL\t\\t\t\\n\t\\\\\t한글😀\n12345"); // NULL·제어 문자·복수 결과
    assert.throws(() => querySql("33361", "", "SELECT missing_column;"), (error) => String(error.stderr).includes("ERROR 1054 ")); // 실제 DB 오류 코드
    assert.throws(() => querySql("33361", "", "SELECT 1; SELECT missing_column;"), (error) => String(error.stderr).includes("ERROR 1054 ")); // 후속 SQL 오류 전달
    assert.throws(() => querySql("33360", "", "SELECT 1;"), (error) => String(error.stderr).includes("전용 검사 DB만 허용")); // 개발 DB 접속 전 차단
    assert.throws(() => querySql("33361", "systemmakers", "SELECT 1;"), (error) => String(error.stderr).includes("전용 검사 DB만 허용")); // 개발 DB 이름 차단
}); // 검사 등록 끝
