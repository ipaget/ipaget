package appstore

import (
	"time"

	"github.com/rs/zerolog"
)

type App struct {
	ID                        int64      `json:"trackId,omitempty"`
	BundleID                  string     `json:"bundleId,omitempty"`
	Name                      string     `json:"trackName,omitempty"`
	Version                   string     `json:"version,omitempty"`
	Price                     float64    `json:"price,omitempty"`
	FormattedPrice            string     `json:"formattedPrice,omitempty"`
	PurchaseDate              time.Time  `json:"purchaseDate,omitzero"`
	Platforms                 []Platform `json:"platforms,omitzero"`
	IconURL60                 string     `json:"artworkUrl60,omitempty"`
	IconURL100                string     `json:"artworkUrl100,omitempty"`
	IconURL512                string     `json:"artworkUrl512,omitempty"`
	Description               string     `json:"description,omitempty"`
	ReleaseNotes              string     `json:"releaseNotes,omitempty"`
	SellerName                string     `json:"sellerName,omitempty"`
	ArtistID                  int64      `json:"artistId,omitempty"`
	Genres                    []string   `json:"genres,omitempty"`
	PrimaryGenreName          string     `json:"primaryGenreName,omitempty"`
	ContentAdvisoryRating     string     `json:"contentAdvisoryRating,omitempty"`
	AverageUserRating         float64    `json:"averageUserRating,omitempty"`
	UserRatingCount           int        `json:"userRatingCount,omitempty"`
	FileSizeBytes             string     `json:"fileSizeBytes,omitempty"`
	MinimumOsVersion          string     `json:"minimumOsVersion,omitempty"`
	ReleaseDate               string     `json:"releaseDate,omitempty"`
	CurrentVersionReleaseDate string     `json:"currentVersionReleaseDate,omitempty"`
	ScreenshotUrls            []string   `json:"screenshotUrls,omitempty"`
	IpadScreenshotUrls        []string   `json:"ipadScreenshotUrls,omitempty"`
	SupportedDevices          []string   `json:"supportedDevices,omitempty"`
	LanguageCodesISO2A        []string   `json:"languageCodesISO2A,omitempty"`
	Features                  []string   `json:"features,omitempty"`
}

type VersionHistoryInfo struct {
	App                App
	LatestVersion      string
	VersionIdentifiers []string
}

type VersionDetails struct {
	VersionID     string
	VersionString string
	Success       bool
	Error         string
}

type Apps []App

func (apps Apps) MarshalZerologArray(a *zerolog.Array) {
	for _, app := range apps {
		a.Object(app)
	}
}

func (a App) MarshalZerologObject(event *zerolog.Event) {
	event.
		Int64("id", a.ID).
		Str("bundleID", a.BundleID).
		Str("name", a.Name).
		Str("version", a.Version).
		Float64("price", a.Price)

	if !a.PurchaseDate.IsZero() {
		event.Time("purchaseDate", a.PurchaseDate)
	}

	if a.Platforms != nil {
		platforms := make([]string, len(a.Platforms))
		for index, platform := range a.Platforms {
			platforms[index] = string(platform)
		}

		event.Strs("platforms", platforms)
	}
}
