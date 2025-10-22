param(
  [string]$ApiUrl = "http://localhost:4000"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Ok($message)   { Write-Host "[OK]   $message" -ForegroundColor Green }
function Warn($message) { Write-Host "[WARN] $message" -ForegroundColor Yellow }
function Err($message)  { Write-Host "[ERR]  $message" -ForegroundColor Red }

$hasError = $false

function Find-InFiles {
  param(
    [string[]]$Roots,
    [string[]]$Patterns
  )
  $files = Get-ChildItem -Path $Roots -Recurse -Include *.ts -ErrorAction SilentlyContinue
  if (-not $files) { return @() }
  $result = Select-String -Path $files.FullName -Pattern $Patterns -SimpleMatch -ErrorAction SilentlyContinue -List
  return $result
}

# 0) Workspace skeleton
$requiredPaths = @(
  "pnpm-workspace.yaml",
  "turbo.json",
  ".github/workflows/ci.yml",
  "apps/api",
  "apps/web",
  "packages/core",
  "packages/http",
  "packages/queue",
  "packages/security",
  "packages/drive",
  "packages/slack",
  "packages/llm",
  "packages/metrics",
  "packages/config",
  "apps/api/prisma/schema.prisma",
  ".env.example"
)

$missingPaths = @()
$root = Get-Location
foreach ($path in $requiredPaths) {
  $fullPath = Join-Path -Path $root -ChildPath $path
  if (-not (Test-Path -Path $fullPath)) {
    $missingPaths += $path
  }
}

if ($missingPaths.Count -eq 0) {
  Ok "workspace scaffold present"
} else {
  Err "missing paths: $($missingPaths -join ', ')"
  $hasError = $true
}

# 1) Prisma schema models
$schemaPath = "apps/api/prisma/schema.prisma"
$expectedModels = @(
  "Org","User","Role","Session","AuditEvent","Meeting","Doc",
  "Issue","OutboxMessage","Integration","Setting","UndoEvent"
)
if (Test-Path $schemaPath) {
  $schemaText = Get-Content $schemaPath -Raw
  $missingModels = @($expectedModels | Where-Object { $schemaText -notmatch "model\s+$_\s+\{" })
  if ($missingModels.Count -eq 0) {
    Ok "prisma models defined"
  } else {
    Warn "missing prisma models: $($missingModels -join ', ')"
  }
} else {
  Err "prisma schema not found at $schemaPath"
  $hasError = $true
}

# 2) API entry point
$apiEntry = "apps/api/src/index.ts"
if (Test-Path $apiEntry) {
  Ok "api entry file present ($apiEntry)"
} else {
  Err "api entry file missing ($apiEntry)"
  $hasError = $true
}

# 3) OpenAPI/Swagger config
$openApiMatches = Find-InFiles -Roots "apps/api/src" -Patterns @("@fastify/swagger","openapi")
if ($openApiMatches) {
  Ok "openapi/swagger configuration detected"
} else {
  Warn "openapi/swagger configuration not found"
}

# 4) OTel / metrics files
$otelMatches = Find-InFiles -Roots @("packages/metrics","apps/api/src") -Patterns @("opentelemetry","Telemetry")
if ($otelMatches) {
  Ok "otel/metrics files detected"
} else {
  Warn "otel/metrics files not found"
}

# 5) tldv webhook route
$tldvRoute = Find-InFiles -Roots "apps/api/src" -Patterns @("/tldv")
if ($tldvRoute) {
  Ok "tldv webhook route detected"
} else {
  Warn "tldv webhook route not found"
}

# 6) Drive wrapper
$driveFiles = Get-ChildItem -Path "packages/drive" -Recurse -Include *.ts -ErrorAction SilentlyContinue
if ($driveFiles) {
  Ok "drive wrapper package detected"
} else {
  Warn "drive wrapper package not found"
}

# 7) Slack interactions
$slackRoute = Find-InFiles -Roots "apps/api/src" -Patterns @("/slack/interactions","slackService.verifyRequest")
if ($slackRoute) {
  Ok "slack interactions route detected"
} else {
  Warn "slack interactions route not found"
}

# 8) D/A/R/A route
$daraRoute = Find-InFiles -Roots "apps/api/src" -Patterns @("extract-dara","llm.extractDara")
if ($daraRoute) {
  Ok "dara extraction route detected"
} else {
  Warn "dara extraction route not found"
}

# 9) Issues API
$issuesRoute = Find-InFiles -Roots "apps/api/src" -Patterns @("/issues")
if ($issuesRoute) {
  Ok "issues api route detected"
} else {
  Warn "issues api route not found"
}

# 10) Undo and outbox
$undoRoute = Find-InFiles -Roots "apps/api/src" -Patterns @("/undo")
if ($undoRoute) {
  Ok "undo route detected"
} else {
  Warn "undo route not found"
}

$outboxRoute = Find-InFiles -Roots "apps/api/src" -Patterns @("/outbox")
if ($outboxRoute) {
  Ok "outbox route detected"
} else {
  Warn "outbox route not found"
}

# 11) Dashboard json
if (Test-Path "packages/metrics/dashboards") {
  Ok "dashboard directory present"
} else {
  Warn "dashboard directory missing"
}

# 12) Live endpoints
foreach ($endpoint in @("/health","/openapi.json")) {
  try {
    $response = Invoke-WebRequest -Uri ("{0}{1}" -f $ApiUrl, $endpoint) -UseBasicParsing -TimeoutSec 2
    if ($response.StatusCode -eq 200) {
      Ok "$endpoint returned 200"
    } else {
      Warn "$endpoint returned status $($response.StatusCode)"
    }
  } catch {
    Warn "$endpoint request failed ($ApiUrl): $($_.Exception.Message)"
  }
}

if ($hasError) {
  Err "progress check completed with blocking issues"
  exit 1
} else {
  Ok "progress check completed"
}
