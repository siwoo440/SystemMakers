#!/bin/sh
# NAS 백업의 원본 보존 검사
set -eu # 실패 즉시 종료
testFolder=$(mktemp -d) # 검사 전용 임시 폴더
destination="$testFolder/backups" # 검사 백업 위치
cleanup() # 이 검사에서 만든 파일 정리
{
    rm -f -- "$testFolder/bin/docker" "$destination"/*.sql "$destination"/*.tar "$destination"/.systemmakers-* "$destination"/.attachments-* "$testFolder/actions" # 이번 검사 사본과 실행 대역 제거
    rmdir -- "$destination" "$testFolder/bin" "$testFolder" # 빈 검사 폴더 정리
}
mkdir "$testFolder/bin" "$destination" # 검사 전용 폴더 생성
trap cleanup EXIT # 검사 종료 후 파일 정리
cat > "$testFolder/bin/docker" <<'MOCK' # 컨테이너 경계에서 실패 종류를 재현하는 실행 대역
#!/bin/sh
case "$2" in # 실제 Compose 하위명령 구분
    ps) printf 'web\nrealtime\nproxy\ndatabase\n'; exit "${PS_EXIT:-0}" ;; # 기존 실행 서비스와 조회 실패
    stop) echo stop >> "$ACTION_LOG"; exit 0 ;; # 백업 전 쓰기 중지 관찰
    start) echo start >> "$ACTION_LOG"; exit 0 ;; # 성공과 실패 후 서비스 복구 관찰
    exec) printf '%s\n' "$DUMP_TEXT"; exit "$DUMP_EXIT" ;; # DB 부분 출력과 실제 실패
    run) printf '%s\n' "$TAR_TEXT"; exit "$TAR_EXIT" ;; # 첨부 부분 출력과 실제 실패
    *) exit 2 ;; # 예상하지 않은 관리 작업 거절
esac # 실행 대역 분기 끝
MOCK
chmod 700 "$testFolder/bin/docker" # 검사 전용 실행 허용
export PATH="$testFolder/bin:$PATH" # 실제 DB와 분리
export ACTION_LOG="$testFolder/actions" # 검사한 서비스 상태 변화
export DUMP_EXIT=0 DUMP_TEXT=first TAR_EXIT=0 TAR_TEXT=first-files PS_EXIT=0 # 첫 정상 백업 쌍
first=$(sh scripts/backup.sh "$destination") # 기존 정상 사본 생성
test "$(cat "$first.attachments.tar")" = first-files # 첫 첨부 원본 백업
export DUMP_EXIT=1 DUMP_TEXT=incomplete # 일부 출력 후 실패
if sh scripts/backup.sh "$destination" # 실패가 성공으로 처리되는지 확인
then # 예상과 다른 성공
    exit 1 # 실패 신호 누락
fi # 실패 검사 끝
test "$(cat "$first")" = first # 이전 사본 내용 유지
test "$(ls -A "$destination" | wc -l)" -eq 2 # 불완전한 덤프와 원본 사본 제거
test "$(tail -n 1 "$ACTION_LOG")" = start # DB 실패 뒤 원래 서비스 복구
export DUMP_EXIT=0 DUMP_TEXT=unpublished TAR_EXIT=1 TAR_TEXT=incomplete-files # SQL 성공 후 첨부 백업 실패
if sh scripts/backup.sh "$destination" # 첨부 실패가 성공으로 처리되는지 확인
then # 예상과 다른 성공
    exit 1 # 불완전한 백업 쌍 발행 거절
fi # 첨부 실패 검사 끝
test "$(cat "$first")" = first # 첨부 실패 후 기존 SQL 보존
test "$(cat "$first.attachments.tar")" = first-files # 첨부 실패 후 기존 원본 보존
test "$(ls -A "$destination" | wc -l)" -eq 2 # 부분 SQL과 원본 사본 미발행
test "$(tail -n 1 "$ACTION_LOG")" = start # 첨부 실패 뒤 원래 서비스 복구
export PS_EXIT=1 # Compose 상태 조회 실패
if sh scripts/backup.sh "$destination" # 파이프에 숨겨지는 조회 실패 검사
then # 예상과 다른 성공
    exit 1 # 조회 실패의 성공 처리 거절
fi # 조회 실패 검사 끝
test "$(ls -A "$destination" | wc -l)" -eq 2 # 조회 실패 뒤 임시 사본 제거
export PS_EXIT=0 DUMP_EXIT=0 DUMP_TEXT=second TAR_EXIT=0 TAR_TEXT=second-files # 같은 위치의 두 번째 정상 백업 쌍
second=$(sh scripts/backup.sh "$destination") # 별도 정상 사본 생성
test "$first" != "$second" # 파일 이름 충돌 방지
test "$(cat "$first")" = first # 두 번째 성공 후 원본 유지
test "$(cat "$second")" = second # 새 사본 완전성 확인
test "$(cat "$second.attachments.tar")" = second-files # 새 첨부 사본 완전성 확인
test "$(ls -A "$destination" | wc -l)" -eq 4 # 정상 백업 두 쌍만 보관
