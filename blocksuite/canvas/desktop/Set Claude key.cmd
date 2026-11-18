@echo off
cd /d "%~dp0"
echo Your key is saved in this folder only (claude-key.txt) and is only sent to Anthropic.
set /p K=Paste your Anthropic API key, then press Enter: 
>claude-key.txt echo %K%
echo Saved. If Canvas is open, reload its window (Ctrl+R).
pause
