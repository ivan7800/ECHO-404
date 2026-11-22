$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
foreach ($name in @('py', 'python')) {
    if (-not (Get-Command $name -ErrorAction SilentlyContinue)) { continue }
    $prefix = if ($name -eq 'py') { @('-3') } else { @() }
    & $name @prefix -c 'import sys; raise SystemExit(sys.version_info < (3, 9))' *> $null
    if ($LASTEXITCODE -ne 0) { continue }
    & $name @prefix server.py --open
    exit $LASTEXITCODE
}
Write-Error 'Necesitas Python 3.9 o posterior.'
exit 1
