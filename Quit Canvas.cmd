@echo off
rem Stops the local Canvas server (the board itself is kept in the app window's storage).
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing -Headers @{ 'x-canvas' = 'quit' } http://127.0.0.1:7357/__quit -TimeoutSec 2 | Out-Null } catch {}"
