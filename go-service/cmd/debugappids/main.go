package main

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"ipaget-service/internal/certifi"
	"ipaget-service/internal/store"
)

func main() {
	configDir := filepath.Join(os.Getenv("APPDATA"), "iPAGet")
	storeService := store.NewService(configDir, nil)
	certService, err := certifi.NewService(configDir)
	if err != nil {
		panic(err)
	}

	cert, err := certService.GetCertificate("34126370-4149-4b7a-9c84-f6eac94bb0db")
	if err != nil {
		panic(err)
	}
	appleID, _ := cert.RawData["apple_id"].(string)
	creds, err := storeService.GetGSACredentials(appleID)
	if err != nil {
		panic(err)
	}

	client := certifi.NewDeveloperPortalClient()
	sess := client.CreateSession(creds.DSID, creds.AuthToken, creds.AnisetteURL, creds.AnisetteData)
	team := &certifi.Team{TeamID: cert.TeamID, TeamType: "free"}

	items, err := listAppIdentifiers(client, sess, team)
	if err != nil {
		panic(err)
	}

	sort.Strings(items)
	for _, item := range items {
		fmt.Println(item)
	}

	found := false
	for _, item := range items {
		if strings.EqualFold(item, "thewonderofyou.Feather") {
			found = true
			break
		}
	}
	fmt.Printf("FOUND_ORIGINAL=%v\n", found)
}

func listAppIdentifiers(client certifi.DeveloperPortalClient, sess *certifi.DevSession, team *certifi.Team) ([]string, error) {
	impl, ok := client.(interface {
		DebugListAppIdentifiers(sess *certifi.DevSession, team *certifi.Team) ([]string, error)
	})
	if !ok {
		return nil, fmt.Errorf("developer portal client does not support debug listing")
	}
	return impl.DebugListAppIdentifiers(sess, team)
}
