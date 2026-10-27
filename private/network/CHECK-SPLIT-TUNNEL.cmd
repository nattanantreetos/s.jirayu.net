@echo off
chcp 65001 >nul
title SEEN Split Tunnel - Read-only route check
echo This command only displays routes. It does not change the network.
echo IPv4: no VPN 0.0.0.0/1 or 128.0.0.0/1 should remain.
echo Keep only the private server network 10.3.0.0/16 through VPN.
route print -4
route print -6
echo.
echo Also verify the public website and your game after connecting the NEW profile.
pause
