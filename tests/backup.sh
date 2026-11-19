#!/bin/sh
# NAS 백업의 원본 보존 검사
set -eu # 실패 즉시 종료
testFolder=$(mktemp -d) # 검사 전용 임시 폴더
destination="$testFolder/backups" # 검사 백업 위치
cleanup() # 이 검사에서 만든 파일 정리
{
    rm -f -- "$testFolder/bin/docker" "$destination"/*.sql "$destination"/.systemmakers-* # 검사 사본과 실행 대역 제거
    rmdir -- "$destination" "$testFolder/bin" "$testFolder" # 빈 검사 폴더 정리
}
mkdir "$testFolder/bin" "$destination" # 검사 전용 폴더 생성
trap cleanup EXIT # 검사 종료 후 파일 정리
printf '%s\n' '#!/bin/sh' 'printf "%s\n" "$DUMP_TEXT"' 'exit "$DUMP_EXIT"' > "$testFolder/bin/docker" # 부분 출력과 종료 상태 재현
chmod 700 "$testFolder/bin/docker" # 검사 전용 실행 허용
export PATH="$testFolder/bin:$PATH" # 실제 DB와 분리
export DUMP_EXIT=0 DUMP_TEXT=first # 첫 정상 백업 자료
first=$(sh scripts/backup.sh "$destination") # 기존 정상 사본 생성
export DUMP_EXIT=1 DUMP_TEXT=incomplete # 일부 출력 후 실패
if sh scripts/backup.sh "$destination" # 실패가 성공으로 처리되는지 확인
then # 예상과 다른 성공
    exit 1 # 실패 신호 누락
fi # 실패 검사 끝
test "$(cat "$first")" = first # 이전 사본 내용 유지
test "$(ls -A "$destination" | wc -l)" -eq 1 # 불완전한 덤프 제거
export DUMP_EXIT=0 DUMP_TEXT=second # 같은 위치에 두 번째 저장
second=$(sh scripts/backup.sh "$destination") # 별도 정상 사본 생성
test "$first" != "$second" # 파일 이름 충돌 방지
test "$(cat "$first")" = first # 두 번째 성공 후 원본 유지
test "$(cat "$second")" = second # 새 사본 완전성 확인
