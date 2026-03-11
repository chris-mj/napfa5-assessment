$path = 'src\pages\SessionDetail.jsx'
$content = Get-Content $path -Raw
$regex = '\r?\n\s*\) : \(\r?\n\s*<div className="text-xs text-gray-500">No barcode generated yet\.[\s\S]*?\r?\n\s*\) : \('
if ($content -notmatch $regex) { Write-Error 'Pattern not found for cleanup'; exit 1 }
$content = [regex]::Replace($content, $regex, "`n            ) : (")
Set-Content -Path $path -Value $content
