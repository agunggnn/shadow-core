$ErrorActionPreference = 'Stop'

Write-Host "Installing Hetzer CLI globally via npm..."
npm install -g hetzer@0.3.0

Write-Host "Hetzer CLI successfully installed! Run 'hetzer help' or 'npx hetzer' to get started."
