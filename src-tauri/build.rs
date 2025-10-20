fn main() {
    // Enable Windows DPI awareness for crisp icons on high-DPI displays
    #[cfg(windows)]
    {
        let mut windows = tauri_build::WindowsAttributes::new();
        windows = windows.app_manifest(r#"
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <assemblyIdentity
    version="1.0.0.0"
    processorArchitecture="*"
    name="iPAGet"
    type="win32"
  />
  <description>iOS App Manager</description>
  <dependency>
    <dependentAssembly>
      <assemblyIdentity
        type="win32"
        name="Microsoft.Windows.Common-Controls"
        version="6.0.0.0"
        processorArchitecture="*"
        publicKeyToken="6595b64144ccf1df"
        language="*"
      />
    </dependentAssembly>
  </dependency>
  <application xmlns="urn:schemas-microsoft-com:asm.v3">
    <windowsSettings>
      <dpiAware xmlns="http://schemas.microsoft.com/SMI/2005/WindowsSettings">true</dpiAware>
      <dpiAwareness xmlns="http://schemas.microsoft.com/SMI/2016/WindowsSettings">PerMonitorV2</dpiAwareness>
    </windowsSettings>
  </application>
</assembly>
"#);
        tauri_build::try_build(
            tauri_build::Attributes::new().windows_attributes(windows)
        ).expect("failed to run build script");
    }
    
    #[cfg(not(windows))]
    {
        tauri_build::build()
    }
}
