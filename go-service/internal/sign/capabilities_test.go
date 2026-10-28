package sign

import "testing"

func TestApplyInfoPlistOverridesWritesCapabilities(t *testing.T) {
	infoPlist := map[string]interface{}{
		"CFBundleURLTypes":                 []interface{}{"legacy"},
		"UISupportedInterfaceOrientations": []interface{}{"UIInterfaceOrientationPortrait"},
	}

	changed := applyInfoPlistOverrides(infoPlist, SignerOptions{
		FileSharing:              true,
		RemoveURLScheme:          true,
		OrientationLandscapeRight: true,
		BgAudio:                  true,
		AllowsArbitraryLoads:     true,
		NoEncryptionDecl:         true,
	})

	if !changed {
		t.Fatal("applying capability overrides must report a change")
	}
	if infoPlist["UISupportsDocumentBrowser"] != true {
		t.Fatalf("UISupportsDocumentBrowser = %v", infoPlist["UISupportsDocumentBrowser"])
	}
	if _, exists := infoPlist["CFBundleURLTypes"]; exists {
		t.Fatal("RemoveURLScheme must drop CFBundleURLTypes")
	}
	orientations, ok := infoPlist["UISupportedInterfaceOrientations"].([]string)
	if !ok || len(orientations) != 1 || orientations[0] != "UIInterfaceOrientationLandscapeRight" {
		t.Fatalf("unexpected orientations: %v", infoPlist["UISupportedInterfaceOrientations"])
	}
	modes, ok := infoPlist["UIBackgroundModes"].([]string)
	if !ok || len(modes) != 1 || modes[0] != "audio" {
		t.Fatalf("unexpected background modes: %v", infoPlist["UIBackgroundModes"])
	}
	ats, ok := infoPlist["NSAppTransportSecurity"].(map[string]interface{})
	if !ok || ats["NSAllowsArbitraryLoads"] != true {
		t.Fatalf("unexpected ATS dictionary: %v", infoPlist["NSAppTransportSecurity"])
	}
	if infoPlist["ITSAppUsesNonExemptEncryption"] != false {
		t.Fatalf("ITSAppUsesNonExemptEncryption = %v", infoPlist["ITSAppUsesNonExemptEncryption"])
	}
}

func TestApplyInfoPlistOverridesIsNoOpWithoutOptions(t *testing.T) {
	infoPlist := map[string]interface{}{"CFBundleDisplayName": "Example"}
	if applyInfoPlistOverrides(infoPlist, SignerOptions{}) {
		t.Fatal("empty options must not modify the Info.plist")
	}
	if len(infoPlist) != 1 {
		t.Fatalf("Info.plist was modified: %v", infoPlist)
	}
}
