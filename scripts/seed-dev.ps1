param # 개발 데이터 준비 인수
( # 인수 목록 시작
    [Parameter(Mandatory = $true)][string]$OwnerUsername, # 이미 가입한 서버 소유자
    [string[]]$Members = @(), # 추가로 참여할 기존 계정
    [string]$PhpPath = '' # 별도 PHP 실행 위치
) # 인수 목록 종료
$ErrorActionPreference = 'Stop' # 준비 오류 즉시 중단
$seedProjectRoot = Split-Path -Parent $PSScriptRoot # 프로젝트 루트
$seedSettingsPath = Join-Path $seedProjectRoot '.runtime/web-env.json' # 개인 실행 설정
if (Test-Path -LiteralPath $seedSettingsPath) # 로컬 설정 존재 여부
{
    $seedSettings = Get-Content -LiteralPath $seedSettingsPath -Raw -Encoding UTF8 | ConvertFrom-Json # 개인 설정 읽기
    foreach ($seedProperty in $seedSettings.PSObject.Properties) # 설정값 순회
    {
        [Environment]::SetEnvironmentVariable($seedProperty.Name, [string]$seedProperty.Value, 'Process') # 현재 실행 환경에만 적용
    }
}
if ([string]::IsNullOrWhiteSpace($PhpPath)) # 기본 PHP 선택
{
    $PhpPath = Join-Path $seedProjectRoot '.runtime/php/php.exe' # 프로젝트 전용 도구
}
$seedArguments = @() # 안전한 개별 인수 목록
$seedIni = Join-Path $seedProjectRoot '.runtime/php.ini' # 로컬 PHP 확장 설정
if (Test-Path -LiteralPath $seedIni) # PHP 설정 존재 여부
{
    $seedArguments += @('-c', $seedIni) # DB 확장 적용
}
$seedArguments += @((Join-Path $seedProjectRoot 'scripts/seed-dev.php'), ('--owner=' + $OwnerUsername)) # 기존 소유자 지정
foreach ($seedMember in $Members) # 명시한 추가 계정 순회
{
    $seedArguments += '--member=' + $seedMember # 멤버마다 별도 인수 전달
}
& $PhpPath @seedArguments # 개발 데이터 준비 실행
exit $LASTEXITCODE # 실제 실행 결과 전달
