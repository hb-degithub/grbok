@echo off
echo Batch started at %DATE% %TIME% > "H:\开发\个人博客\astro-dev2.log"
set ASTRO_TELEMETRY_DISABLED=1
echo Env set: %ASTRO_TELEMETRY_DISABLED% >> "H:\开发\个人博客\astro-dev2.log"
cd /d "H:\开发\个人博客\astro"
echo Running npm in %CD% >> "H:\开发\个人博客\astro-dev2.log"
npm run dev -- --host >> "H:\开发\个人博客\astro-dev2.log" 2>&1
echo Exit code: %ERRORLEVEL% >> "H:\开发\个人博客\astro-dev2.log"
