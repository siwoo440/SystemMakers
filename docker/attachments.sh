#!/bin/sh
# 평면 비공개 원본 파일의 스트리밍 tar 백업
set -eu # 원본 조회와 백업 실패의 즉시 중단
storage=${ATTACHMENT_STORAGE_DIR:?첨부 저장소 경로 필요} # 명시한 비공개 볼륨
test -d "$storage" # 저장소 누락의 빈 백업 처리 방지
fileList=$(mktemp) # 큰 원본 목록의 제한된 메모리 보관
trap 'rm -f -- "$fileList"' EXIT # 모든 종료 경로의 임시 목록 제거
trap 'exit 1' HUP INT TERM # 중단된 백업의 실패 결과
find "$storage" -mindepth 1 -maxdepth 1 ! -type f -print > "$fileList" # 링크 또는 예상하지 않은 디렉터리 검사
if [ -s "$fileList" ] # 원본 이외 구조 존재 여부
then # 불완전 백업 차단
    echo '첨부 백업 중단: 원본 저장소 구조 확인 필요' >&2 # 잘못된 볼륨 안내
    exit 1 # 링크와 폴더의 조용한 누락 방지
fi # 저장소 구조 검사 끝
find "$storage" -mindepth 1 -maxdepth 1 -type f -printf '%f\0' > "$fileList" # 루트 엔트리 없는 NUL 구분 원본 파일명
tar --null --verbatim-files-from -C "$storage" -T "$fileList" -cf - # 기존 원본을 메모리 적재 없이 백업
