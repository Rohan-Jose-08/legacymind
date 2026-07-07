# Builds a sandboxed legacy-execution image for one COBOL module.
#
# Usage (from the legacymind repo root):
#   .\harness\build-legacy-image.ps1                                   # payroll defaults
#   .\harness\build-legacy-image.ps1 -Source examples/other.cbl -Tag legacymind/legacy-other
#
# Other platforms: run the equivalent docker command directly —
#   docker build -f harness/gnucobol/Dockerfile --build-arg SOURCE=examples/payroll.cbl -t legacymind/legacy-payroll .
param(
    [string]$Source = "examples/payroll.cbl",
    [string]$Tag = "legacymind/legacy-payroll"
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot

docker build -f (Join-Path $repoRoot "harness/gnucobol/Dockerfile") `
    --build-arg "SOURCE=$Source" `
    -t $Tag `
    $repoRoot
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Output ""
Write-Output "built $Tag from $Source"
Write-Output "verify-config argv: [`"docker`", `"run`", `"--rm`", `"-i`", `"--network`", `"none`", `"$Tag`"]"
