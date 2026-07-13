$content = @'
; AI DB Query Windows Installer (NSIS)
; -------------------------------------------------------
; Installs to user-local directory (no admin rights required).
; Writes uninstall info to HKCU. Creates Start Menu shortcuts.
; Bilingual: English (default) + Simplified Chinese.
; --------------------------------------------------------------------

; --- Basic configuration ----------------------------------------------------

!define PRODUCT_NAME "AI DB Query"
!define PRODUCT_VERSION "0.1.0"
!define PRODUCT_PUBLISHER "AI DB Query"
!define PRODUCT_WEB_SITE "http://localhost:5173"

Name "${PRODUCT_NAME} ${PRODUCT_VERSION}"
OutFile "..\dist\AIDBQuery-Setup.exe"
InstallDir "$LOCALAPPDATA\${PRODUCT_NAME}"
RequestExecutionLevel user          ; no admin required
SetCompressor /SOLID lzma
ShowInstDetails show
ShowUninstDetails show

; --- Modern UI --------------------------------------------------------------

!include "MUI2.nsh"

!define MUI_ABORTWARNING
!define MUI_UNABORTWARNING

; Finish page: launch app checkbox + desktop shortcut checkbox
!define MUI_FINISHPAGE_RUN "$INSTDIR\AIDBQuery.exe"
!define MUI_FINISHPAGE_RUN_TEXT "$(LANG_RUN_TEXT)"
!define MUI_FINISHPAGE_SHOWREADME ""
!define MUI_FINISHPAGE_SHOWREADME_NOTCHECKED
!define MUI_FINISHPAGE_SHOWREADME_TEXT "$(LANG_DESKTOP_TEXT)"
!define MUI_FINISHPAGE_SHOWREADME_FUNCTION CreateDesktopShortcut

; --- Installer pages (must be inserted before MUI_LANGUAGE) ------------------

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

; --- Uninstaller pages ------------------------------------------------------

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

; --- Language support (MUST be after all pages; LangStrings after MUI_LANGUAGE) ---

!insertmacro MUI_LANGUAGE "English"
!insertmacro MUI_LANGUAGE "SimpChinese"

; --- Localized strings (after MUI_LANGUAGE so ${LANG_ENGLISH} / ${LANG_SIMPCHINESE} are defined) ---

LangString LANG_RUN_TEXT      ${LANG_ENGLISH}      "Launch ${PRODUCT_NAME}"
LangString LANG_RUN_TEXT      ${LANG_SIMPCHINESE}  "启动 ${PRODUCT_NAME}"

LangString LANG_DESKTOP_TEXT  ${LANG_ENGLISH}      "Create Desktop Shortcut"
LangString LANG_DESKTOP_TEXT  ${LANG_SIMPCHINESE}  "创建桌面快捷方式"

LangString LANG_UNINSTALL     ${LANG_ENGLISH}      "Uninstall ${PRODUCT_NAME}"
LangString LANG_UNINSTALL     ${LANG_SIMPCHINESE}  "卸载 ${PRODUCT_NAME}"

; --- Desktop shortcut function (called when checkbox is checked) -------------

Function CreateDesktopShortcut
  CreateShortCut "$DESKTOP\${PRODUCT_NAME}.lnk" \
    "$INSTDIR\AIDBQuery.exe" "" "$INSTDIR\AIDBQuery.exe" 0
FunctionEnd

; --- Installer section ------------------------------------------------------

Section "Install"
  SetOutPath "$INSTDIR"

  ; Launcher executable
  File "..\dist\installer\AIDBQuery.exe"

  ; Backend
  SetOutPath "$INSTDIR\backend"
  File "..\dist\installer\backend.exe"

  ; Frontend server (static files embedded inside via PyInstaller)
  SetOutPath "$INSTDIR\frontend"
  File "..\dist\installer\server.exe"

  ; Initial database
  SetOutPath "$INSTDIR\data"
  File "..\dist\installer\data\config.db"

  ; Logs directory (created empty, written at runtime)
  CreateDirectory "$INSTDIR\logs"

  ; Start Menu shortcuts
  CreateDirectory "$SMPROGRAMS\${PRODUCT_NAME}"
  CreateShortCut "$SMPROGRAMS\${PRODUCT_NAME}\${PRODUCT_NAME}.lnk" \
    "$INSTDIR\AIDBQuery.exe" "" "$INSTDIR\AIDBQuery.exe" 0
  CreateShortCut "$SMPROGRAMS\${PRODUCT_NAME}\$(LANG_UNINSTALL).lnk" \
    "$INSTDIR\uninst.exe"

  ; Uninstaller
  WriteUninstaller "$INSTDIR\uninst.exe"

  ; Registry (HKCU - no admin required)
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" \
    "DisplayName" "${PRODUCT_NAME}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" \
    "UninstallString" "$INSTDIR\uninst.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" \
    "DisplayVersion" "${PRODUCT_VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" \
    "Publisher" "${PRODUCT_PUBLISHER}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" \
    "URLInfoAbout" "${PRODUCT_WEB_SITE}"
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" \
    "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" \
    "NoRepair" 1
SectionEnd

; --- Uninstaller section ----------------------------------------------------

Section "Uninstall"
  ; Terminate running processes silently
  nsExec::ExecToLog 'taskkill /f /im AIDBQuery.exe'
  nsExec::ExecToLog 'taskkill /f /im backend.exe'
  nsExec::ExecToLog 'taskkill /f /im server.exe'

  ; Remove files
  Delete "$INSTDIR\AIDBQuery.exe"
  Delete "$INSTDIR\backend\backend.exe"
  Delete "$INSTDIR\frontend\server.exe"
  RMDir "$INSTDIR\frontend"
  RMDir "$INSTDIR\backend"
  RMDir /r "$INSTDIR\logs"

  ; Preserve data/config.db (user's database); uncomment to remove:
  ; RMDir /r "$INSTDIR\data"

  Delete "$INSTDIR\uninst.exe"
  RMDir "$INSTDIR"

  ; Remove Start Menu entries
  Delete "$SMPROGRAMS\${PRODUCT_NAME}\${PRODUCT_NAME}.lnk"
  Delete "$SMPROGRAMS\${PRODUCT_NAME}\$(LANG_UNINSTALL).lnk"
  RMDir "$SMPROGRAMS\${PRODUCT_NAME}"

  ; Remove Desktop shortcut
  Delete "$DESKTOP\${PRODUCT_NAME}.lnk"

  ; Remove registry entries
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}"
SectionEnd
'@

$path = Join-Path (Split-Path $PSScriptRoot -Parent) "installer\installer.nsi"
# UTF8 with BOM on Windows PowerShell; UTF8 no BOM on PowerShell Core
if ($PSVersionTable.PSVersion.Major -le 5) {
    $Utf8BomEncoding = New-Object System.Text.UTF8Encoding $true
    [System.IO.File]::WriteAllText($path, $content, $Utf8BomEncoding)
} else {
    $content | Set-Content -Path $path -Encoding utf8BOM
}
Write-Host "installer.nsi written successfully (UTF-8 BOM)"
