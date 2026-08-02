package logbuffer

import (
	"container/ring"
	"sync"
)

// Buffer is a thread-safe, in-memory, circular buffer for log lines.
// It implements io.Writer to be compatible with zerolog.
type Buffer struct {
	mu          sync.RWMutex
	ring        *ring.Ring
	size        int
	subscribers map[chan []byte]bool
}

// New creates a new log buffer of a given size.
func New(size int) *Buffer {
	return &Buffer{
		ring:        ring.New(size),
		size:        size,
		subscribers: make(map[chan []byte]bool),
	}
}

// Write implements the io.Writer interface, making it usable with zerolog.
// It stores the log line and broadcasts it to subscribers.
func (b *Buffer) Write(p []byte) (n int, err error) {
	// The input `p` from zerolog is a single log entry as a byte slice (JSON).
	// We need to copy it to ensure the buffer doesn't hold a reference to a reused slice.
	line := make([]byte, len(p))
	copy(line, p)

	b.mu.Lock()
	b.ring.Value = line
	b.ring = b.ring.Next()
	b.mu.Unlock()

	// Broadcast the new line to all subscribers.
	b.mu.RLock()
	defer b.mu.RUnlock()
	for sub := range b.subscribers {
		// Use a non-blocking send. If a subscriber's channel is full,
		// we drop the message for them to prevent blocking the entire logging system.
		select {
		case sub <- line:
		default:
		}
	}

	return len(p), nil
}

// GetHistory retrieves all non-nil log lines from the circular buffer.
func (b *Buffer) GetHistory() [][]byte {
	b.mu.RLock()
	defer b.mu.RUnlock()

	history := make([][]byte, 0, b.size)
	b.ring.Do(func(p interface{}) {
		if p != nil {
			if data, ok := p.([]byte); ok {
				history = append(history, data)
			}
		}
	})
	return history
}

// Subscribe adds a new channel to the subscriber list.
// The caller is responsible for creating the channel.
func (b *Buffer) Subscribe() chan []byte {
	b.mu.Lock()
	defer b.mu.Unlock()

	ch := make(chan []byte, 100) // Buffer to handle bursts
	b.subscribers[ch] = true
	return ch
}

// Unsubscribe removes a channel from the subscriber list and closes it.
func (b *Buffer) Unsubscribe(ch chan []byte) {
	b.mu.Lock()
	defer b.mu.Unlock()

	if _, ok := b.subscribers[ch]; ok {
		delete(b.subscribers, ch)
		close(ch)
	}
}
