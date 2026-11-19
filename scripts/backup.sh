#!/bin/sh
# NAS 호스트에서 MySQL 백업 저장
set -eu # 오류 발생 시 중단
umask 077 # 소유자 전용 파일 권한
backupDir=${1:-backups} # 백업 보관 폴더
mkdir -p -- "$backupDir" # 최초 보관 위치 준비
stamp=$(date -u +%Y%m%dT%H%M%SZ) # UTC 백업 시각
temporary=$(mktemp -- "$backupDir/.systemmakers-$stamp-XXXXXXXX") # 같은 폴더에 고유 임시 파일 생성
trap 'rm -f -- "$temporary"' EXIT # 완료 또는 실패 시 임시 파일 정리
trap 'exit 1' HUP INT TERM # 중단된 백업의 실패 처리
docker compose exec -T database sh /opt/systemmakers/database.sh backup > "$temporary" # 전체 덤프 스트리밍
test -s "$temporary" # 빈 출력의 발행 방지
filename=${temporary##*/} # 경로에서 임시 파일명 추출
backupFile="$backupDir/${filename#.}.sql" # 완료한 사본의 고유 이름
ln -- "$temporary" "$backupFile" # 기존 사본을 덮어쓰지 않는 원자적 공개
printf '%s\n' "$backupFile" # 해시와 복원에 사용할 경로 출력
