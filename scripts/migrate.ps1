param # 변경 실행 인수
( # 인수 목록 시작
    [string]$PhpPath = '' # 별도 PHP 실행 위치
) # 인수 목록 종료
$ErrorActionPreference = 'Stop' # 실행 실패 즉시 중단
$migrationRoot = Split-Path -Parent $PSScriptRoot # 프로젝트 루트
if ([string]::IsNullOrWhiteSpace($PhpPath)) # 기본 PHP 선택
{ # 기본 실행 위치
    $PhpPath = Join-Path $migrationRoot '.runtime/php/php.exe' # 프로젝트 PHP
} # 기본 실행 위치 끝
$migrationArguments = @() # 안전한 개별 인수
$migrationIni = Join-Path $migrationRoot '.runtime/php.ini' # 개인 PHP 설정
if (Test-Path -LiteralPath $migrationIni) # 확장 설정 존재
{ # 로컬 확장 연결
    $migrationArguments += @('-c', $migrationIni) # PDO 확장 준비
} # 로컬 확장 연결 끝
$migrationArguments += Join-Path $migrationRoot 'scripts/migrate.php' # 고정 변경 실행 파일
& $PhpPath @migrationArguments # 명시한 환경 변수의 DB에 적용
exit $LASTEXITCODE # 실제 적용 결과 전달
