#!/bin/sh
# 중지된 별도 프로젝트의 빈 DB와 빈 첨부 볼륨으로만 복원
set -eu # 오류와 누락 변수의 즉시 중단
backupFile=${1:?완료한 SQL 백업 경로 필요} # 신뢰한 자체 백업 위치
test -s "$backupFile" # 실제 DB 백업 확인
test -s "$backupFile.attachments.tar" # 같은 시점의 원본 백업 필수
runningState=$(docker compose ps --services --status running) # Compose 실패를 숨기지 않는 상태 조회
if printf '%s\n' "$runningState" | sed -n '/^web$/p; /^realtime$/p; /^proxy$/p' | grep -q . # 실행 중인 앱 여부
then # 운영 중 복원 차단
    echo '복원 중단: 별도 프로젝트의 웹·실시간·프록시 중지 필요' >&2 # 쓰기 경합 방지 안내
    exit 1 # 운영 서비스 변경 차단
fi # 중지 상태 검사 끝
docker compose exec -T database sh /opt/systemmakers/database.sh assert-empty # 기존 DB 덮어쓰기 거절
docker compose run --rm --no-deps -T --user www-data web php scripts/restore-attachments.php < "$backupFile.attachments.tar" # 검증한 원본만 빈 볼륨으로 복원
docker compose exec -T database sh /opt/systemmakers/database.sh restore-empty < "$backupFile" # 빈 DB의 명시적 백업 복원
docker compose exec -T database sh /opt/systemmakers/database.sh restrict-app # 복원 후 앱 DML 권한 유지
echo 'DB와 첨부 원본 복원 완료: 서비스 시작 전 무결성 확인 필요' >&2 # 실제 완료한 복원 결과
