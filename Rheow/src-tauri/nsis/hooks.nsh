; Rheow NSIS Custom Hooks
; Provides thorough uninstallation with user confirmation for app data and settings

; Align header image to the right side so it never collides with page title / subtitle
!define MUI_HEADERIMAGE_RIGHT

!macro NSIS_HOOK_PREUNINSTALL
  MessageBox MB_YESNO|MB_ICONQUESTION "Do you want to delete your download history, databases, and application settings?$\n$\n(Note: Files already saved in your Downloads folder will not be affected.)" /SD IDNO IDNO keep_user_data
    DetailPrint "Removing application user data..."
    RMDir /r "$APPDATA\com.rheow.app"
    RMDir /r "$LOCALAPPDATA\com.rheow.app"
  keep_user_data:
!macroend
