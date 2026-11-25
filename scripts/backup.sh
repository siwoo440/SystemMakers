#!/bin/sh
# NAS 호스트에서 DB와 첨부 원본의 일관된 백업 저장
set -eu # 오류 발생 시 중단
umask 077 # 소유자 전용 파일 권한
backupDir=${1:-backups} # 백업 보관 폴더
mkdir -p -- "$backupDir" # 최초 보관 위치 준비
stamp=$(date -u +%Y%m%dT%H%M%SZ) # UTC 백업 시각
temporary=$(mktemp -- "$backupDir/.systemmakers-$stamp-XXXXXXXX") # 같은 폴더에 고유 임시 파일 생성
attachmentTemporary=$(mktemp -- "$backupDir/.attachments-$stamp-XXXXXXXX") # 첨부 원본의 별도 임시 사본
runningServices='' # 정리할 원래 실행 서비스의 초기 상태
cleanup() # 모든 종료 경로의 서비스와 임시 파일 복구
{
    result=$? # 백업 작업 종료 상태
    trap - EXIT # 정리 함수 재실행 방지
    rm -f -- "$temporary" "$attachmentTemporary" # 이번 임시 사본만 제거
    if [ -n "$runningServices" ] # 원래 실행 중인 서비스 존재
    then # 중지한 앱 복구
        docker compose start $runningServices >&2 || result=1 # 원래 앱의 실행 상태 복구
    fi # 서비스 복구 끝
    exit "$result" # 실제 백업과 복구 결과 전달
}
trap cleanup EXIT # 성공과 실패 모두 정리와 원래 서비스 복구
trap 'exit 1' HUP INT TERM # 중단된 백업의 실패 처리
runningState=$(docker compose ps --services --status running) # Compose 조회 실패를 숨기지 않는 실행 상태
runningServices=$(printf '%s\n' "$runningState" | sed -n '/^web$/p; /^realtime$/p; /^proxy$/p' | tr '\n' ' ') # 원래 실행 중인 쓰기 진입점
if [ -n "$runningServices" ] # 동시 쓰기 경합 여부
then # 원본과 메타데이터의 일관된 시점 확보
    docker compose stop $runningServices >&2 # 실행 중이던 앱만 잠시 중지
fi # 쓰기 중지 끝
docker compose exec -T database sh /opt/systemmakers/database.sh backup > "$temporary" # 전체 덤프 스트리밍
test -s "$temporary" # 빈 출력의 발행 방지
docker compose run --rm --no-deps -T --user www-data web sh docker/attachments.sh > "$attachmentTemporary" # 평면 원본 파일만 포함한 볼륨 백업
test -s "$attachmentTemporary" # 누락된 원본 백업의 발행 방지
filename=${temporary##*/} # 경로에서 임시 파일명 추출
backupFile="$backupDir/${filename#.}.sql" # 완료한 사본의 고유 이름
ln -- "$attachmentTemporary" "$backupFile.attachments.tar" # 기존 사본을 덮어쓰지 않는 원본 백업 공개
ln -- "$temporary" "$backupFile" # 기존 사본을 덮어쓰지 않는 원자적 공개
printf '%s\n' "$backupFile" # 해시와 복원에 사용할 경로 출력
