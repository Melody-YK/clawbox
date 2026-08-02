@echo off
cd /d "e:\clawbox_linux-main\clawbox_linux-main"
echo Installing dependencies...
npm install
echo Starting development server...
npm run dev
pause