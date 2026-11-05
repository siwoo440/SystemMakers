param # 실시간 서버 실행 인수
(
    [string]$phpPath = '', # PHP 실행 파일 경로
    [string]$phpIni = '' # PHP 설정 파일 경로
)
$ErrorActionPreference = 'Stop' # 오류 발생 시 종료
$projectRoot = Split-Path -Parent $PSScriptRoot # 프로젝트 루트
$localSettings = Join-Path $projectRoot '.runtime/web-env.json' # 개인 환경 설정
if (Test-Path -LiteralPath $localSettings) # 개인 설정 존재 확인
{
    $configuration = Get-Content -LiteralPath $localSettings -Raw -Encoding UTF8 | ConvertFrom-Json # 설정 읽기
    foreach ($property in $configuration.PSObject.Properties) # 실행 환경 항목 순회
    {
        [Environment]::SetEnvironmentVariable($property.Name, [string]$property.Value, 'Process') # 현재 프로세스에만 적용
    }
}
if ([string]::IsNullOrWhiteSpace($phpPath)) # 기본 PHP 선택
{
    $phpPath = Join-Path $projectRoot '.runtime/php83/php.exe' # PHP 8.3 실행 파일
}
if ([string]::IsNullOrWhiteSpace($phpIni)) # 기본 PHP 설정 선택
{
    $phpIni = Join-Path $projectRoot '.runtime/php83.ini' # PHP 8.3 설정 파일
}
if (-not (Test-Path -LiteralPath $phpPath) -or -not (Test-Path -LiteralPath $phpIni)) # 실행 도구와 설정 검사
{
    throw 'PHP 8.3 실행 파일과 설정을 준비하세요.' # 누락 설정 안내
}
$autoloadPath = Join-Path $projectRoot 'backend/realtime/vendor/autoload.php' # Composer 자동 로더
if (-not (Test-Path -LiteralPath $autoloadPath)) # 외부 라이브러리 설치 검사
{
    throw 'backend/realtime에서 Composer 의존성을 설치하세요.' # 설치 안내
}
$serverPath = Join-Path $projectRoot 'backend/realtime/server.php' # 실시간 서버 진입점
Write-Output 'SystemMakers WebSocket: ws://127.0.0.6:8090/Team006/realtime' # 기본 접속 경로
& $phpPath -c $phpIni $serverPath # PHP 8.3 실시간 서버 실행
exit $LASTEXITCODE # 서버 종료 상태 전달
