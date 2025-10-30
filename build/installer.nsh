!macro preInit
  System::Call 'SHCore::SetProcessDpiAwareness(i 1)i.R0'
  
!macroend

!macro customUnInit
  System::Call 'SHCore::SetProcessDpiAwareness(i 1)i.R0'
!macroend

!macro customWelcomePage
  # Welcome Page is not added by default for installer.
  !insertMacro MUI_PAGE_WELCOME
  ; !define $MUI_WELCOMEFINISHPAGE_BITMAP "windows_installer_header.bmp"
!macroend