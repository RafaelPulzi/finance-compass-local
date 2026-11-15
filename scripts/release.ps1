# Publica uma versão do Finance Compass como release público.
#
# O repositório do código é privado, então um release aqui não seria baixável
# por ninguém; a distribuição vive em finance-compass-releases (público), que
# contém só o README de apresentação e os instaladores. Este script é o
# caminho inteiro: build dos instaladores a partir do checkout atual e upload
# para lá, com a versão lida de src-tauri/tauri.conf.json — o mesmo lugar de
# onde o instalador tira o nome do arquivo, para que os dois nunca discordem.
#
# Uso:  .\scripts\release.ps1 -NotesFile notas.md
# Antes: suba a "version" em src-tauri/tauri.conf.json E package.json,
# escreva as notas da versão num arquivo, e esteja na main, limpa.

param(
  [Parameter(Mandatory = $true)]
  [string]$NotesFile,
  [string]$Repo = "RafaelPulzi/finance-compass-releases"
)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent

# Um release é um carimbo público sobre um commit preciso: recusar um estado
# que nenhum commit descreve, ou que ainda não passou pela main.
if ((git -C $root status --porcelain) -ne $null) {
  throw "A árvore de trabalho tem alterações não commitadas. Faça o release de um estado limpo."
}
if ((git -C $root branch --show-current) -ne "main") {
  throw "Faça o release a partir da main, não de uma branch de feature."
}
if (-not (Test-Path $NotesFile)) {
  throw "Arquivo de notas não encontrado: $NotesFile"
}

$version = (Get-Content "$root\src-tauri\tauri.conf.json" -Raw | ConvertFrom-Json).version
$tag = "v$version"

# cargo não está no PATH de shells antigos (ver README).
$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"

Push-Location $root
try {
  npm run tauri build
  if ($LASTEXITCODE -ne 0) { throw "npm run tauri build falhou." }
} finally {
  Pop-Location
}

$bundle = "$root\src-tauri\target\release\bundle"
$assets = @(
  "$bundle\nsis\Finance Compass_${version}_x64-setup.exe",
  "$bundle\msi\Finance Compass_${version}_x64_en-US.msi"
)
foreach ($asset in $assets) {
  if (-not (Test-Path $asset)) { throw "Instalador esperado não existe: $asset" }
}

# A tag no repositório do código diz qual commit virou esta versão.
git -C $root tag $tag
git -C $root push origin $tag

gh release create $tag -R $Repo --title "Finance Compass $version" --notes-file $NotesFile @assets
if ($LASTEXITCODE -ne 0) { throw "gh release create falhou." }

Write-Host "Publicado: https://github.com/$Repo/releases/tag/$tag"
