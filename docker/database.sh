#!/bin/sh
# 시스템 셸로 DB 관리 작업 실행
set -eu # 오류와 누락 변수의 즉시 중단
case "${MYSQL_DATABASE:-}:${MYSQL_USER:-}" in # SQL 식별자 허용 문자 검사
    *[!a-zA-Z0-9_:]*|:*|*:) exit 1 ;; # 비어 있거나 잘못된 이름 거절
esac # 이름 검사 끝
export MYSQL_PWD="${MYSQL_ROOT_PASSWORD:?관리자 설정 필요}" # 명령줄 비밀번호 노출 방지
mysql_admin() # 관리자 DB 명령 경계
{
    mysql --user=root --database="$MYSQL_DATABASE" "$@" # 명시한 DB에만 연결
}
require_empty() # 기존 데이터 덮어쓰기 방지
{
    tableCount=$(mysql_admin -Nse 'SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE()') # 실제 테이블 수
    if [ "$tableCount" != 0 ] # 빈 DB 여부
    then # 기존 DB 처리
        echo '중단: 빈 DB만 초기화 또는 복원 가능' >&2 # 원본 보존 안내
        exit 1 # 기존 DB 변경 중단
    fi # 빈 DB 검사 끝
}
case "${1:-}" in # 명시적 관리 작업 선택
    assert-empty) # 별도 복원 절차의 기존 DB 보호
        require_empty # 실제 빈 DB 여부 확인
        ;; # 검사 분기 끝
    migrate-006) # 기존 005 DB의 첨부 저장소 변경
        existing=$(mysql_admin -Nse "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='message_attachments' AND column_name='file_data'") # 선행 첨부 열 확인
        introduced=$(mysql_admin -Nse "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='message_attachments' AND column_name IN ('storage_key','preview_mime')") # 기존 또는 부분 변경 확인
        if [ "$existing" != 1 ] || [ "$introduced" != 0 ] # 선행 구조와 재적용 경계
        then # 잘못된 변경 대상
            echo '변경 중단: 004 선행 구조 또는 006 적용 상태 확인 필요' >&2 # 원본 보존 안내
            exit 1 # 중복 변경 차단
        fi # 대상 확인 끝
        mysql_admin < /opt/systemmakers/sql/migrations/006_attachment_storage.sql # 원본 BLOB을 보존한 메타데이터 변경
        ;; # 첨부 변경 분기 끝
    migrate-007) # 기존 개인 대화의 읽음 상태 변경
        existing=$(mysql_admin -Nse "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='direct_messages'") # 선행 개인 대화 확인
        introduced=$(mysql_admin -Nse "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='direct_read_receipts'") # 기존 또는 부분 테이블 확인
        indexCount=$(mysql_admin -Nse "SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='direct_messages' AND index_name='idx_direct_messages_incoming'") # 부분 변경 인덱스 확인
        if [ "$existing" != 1 ] || [ "$introduced" != 0 ] || [ "$indexCount" != 0 ] # 선행 구조와 재적용 경계
        then # 잘못된 변경 대상
            echo '변경 중단: 002 선행 구조 또는 007 적용 상태 확인 필요' >&2 # 부분 적용 검사 안내
            exit 1 # 중복 변경 차단
        fi # 대상 확인 끝
        mysql_admin < /opt/systemmakers/sql/migrations/007_direct_read_receipts.sql # 지정한 읽음 상태 변경만 실행
        ;; # 읽음 상태 변경 분기 끝
    bootstrap-empty) # 신규 빈 DB 전용 준비
        require_empty # 기존 자료 보호
        mysql_admin < /opt/systemmakers/sql/schema.sql # 빈 DB 기본 구조
        for migrationFile in /opt/systemmakers/sql/migrations/*.sql # 변경 순서 적용
        do # 각 변경 실행
            mysql_admin < "$migrationFile" # 초기 DB의 순차 변경
        done # 신규 구조 준비 끝
        ;; # 신규 준비 분기 끝
    restore-empty) # 별도 빈 DB로만 복원
        require_empty # 기존 자료 덮어쓰기 차단
        mysql_admin # 표준 입력의 신뢰한 백업 복원
        ;; # 복원 분기 끝
    backup) # 일관된 논리 백업
        mysqldump --user=root --single-transaction --hex-blob --routines --triggers --events --no-tablespaces --set-gtid-purged=OFF "$MYSQL_DATABASE" # 바이너리와 관계 보존
        ;; # 백업 분기 끝
    restrict-app) # 운영 앱의 DDL 권한 제거
        grantDatabase=$(printf '%s' "$MYSQL_DATABASE" | sed 's/_/\\_/g') # 공식 이미지와 같은 밑줄 식별자 이스케이프
        mysql_admin -e "REVOKE ALL PRIVILEGES ON \`$grantDatabase\`.* FROM '$MYSQL_USER'@'%'; GRANT SELECT, INSERT, UPDATE, DELETE ON \`$grantDatabase\`.* TO '$MYSQL_USER'@'%';" # 대상 DB의 최소 앱 권한
        ;; # 권한 분기 끝
    *) # 미지정 작업 거절
        echo '작업: bootstrap-empty | restore-empty | backup | restrict-app | assert-empty | migrate-006 | migrate-007' >&2 # 가능한 관리 명령 안내
        exit 1 # 임의 기본 작업 차단
        ;; # 거절 분기 끝
esac # 관리 작업 끝
