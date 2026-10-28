package store

import (
	legacyKeyring "github.com/99designs/keyring"
	ipatoolKeyring "github.com/byteness/keyring"
)

type ipatoolKeyringAdapter struct {
	keyring legacyKeyring.Keyring
}

func (adapter *ipatoolKeyringAdapter) Get(key string) (ipatoolKeyring.Item, error) {
	item, err := adapter.keyring.Get(key)
	if err != nil {
		return ipatoolKeyring.Item{}, err
	}

	return ipatoolKeyring.Item{
		Key:                         item.Key,
		Data:                        item.Data,
		Label:                       item.Label,
		Description:                 item.Description,
		KeychainNotTrustApplication: item.KeychainNotTrustApplication,
		KeychainNotSynchronizable:   item.KeychainNotSynchronizable,
	}, nil
}

func (adapter *ipatoolKeyringAdapter) Set(item ipatoolKeyring.Item) error {
	return adapter.keyring.Set(legacyKeyring.Item{
		Key:                         item.Key,
		Data:                        item.Data,
		Label:                       item.Label,
		Description:                 item.Description,
		KeychainNotTrustApplication: item.KeychainNotTrustApplication,
		KeychainNotSynchronizable:   item.KeychainNotSynchronizable,
	})
}

func (adapter *ipatoolKeyringAdapter) Remove(key string) error {
	return adapter.keyring.Remove(key)
}
