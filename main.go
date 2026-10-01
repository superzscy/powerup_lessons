package main

import (
	"embed"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

//go:embed web/*
var webFiles embed.FS

var trackNamePattern = regexp.MustCompile("(?i)^Power Up Level 1 CD([0-9]+) Track ([0-9]+)\\.mp3$")

type Track struct {
	ID       string
	Book     string
	Disc     string
	Number   int
	FileName string
	relPath  string
}

type Disc struct {
	Name   string
	Number int
	Count  int
	Tracks []Track
}

type Book struct {
	Name  string
	Count int
	Discs []Disc
}

type Library struct {
	Books []Book
}

func (track Track) MarshalJSON() ([]byte, error) {
	return json.Marshal(map[string]any{
		"id": track.ID, "book": track.Book, "disc": track.Disc,
		"number": track.Number, "fileName": track.FileName,
	})
}

func (disc Disc) MarshalJSON() ([]byte, error) {
	return json.Marshal(map[string]any{
		"name": disc.Name, "number": disc.Number, "count": disc.Count, "tracks": disc.Tracks,
	})
}

func (book Book) MarshalJSON() ([]byte, error) {
	return json.Marshal(map[string]any{
		"name": book.Name, "count": book.Count, "discs": book.Discs,
	})
}

func (library Library) MarshalJSON() ([]byte, error) {
	return json.Marshal(map[string]any{"books": library.Books})
}

type libraryIndex struct {
	root   string
	mu     sync.RWMutex
	tracks map[string]Track
}

func (idx *libraryIndex) scan() (Library, map[string]Track, error) {
	rootEntries, err := os.ReadDir(idx.root)
	if err != nil {
		return Library{}, nil, fmt.Errorf("read audio directory: %w", err)
	}

	byBook := make(map[string]map[int][]Track)
	for _, bookEntry := range rootEntries {
		if !bookEntry.IsDir() {
			continue
		}
		bookName := bookEntry.Name()
		bookPath := filepath.Join(idx.root, bookName)

		err = filepath.WalkDir(bookPath, func(path string, entry fs.DirEntry, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			if entry.IsDir() || entry.Type()&fs.ModeSymlink != 0 {
				return nil
			}
			matches := trackNamePattern.FindStringSubmatch(entry.Name())
			if matches == nil {
				return nil
			}
			cdNumber, _ := strconv.Atoi(matches[1])
			trackNumber, _ := strconv.Atoi(matches[2])
			if cdNumber < 1 || trackNumber < 1 {
				return nil
			}

			info, infoErr := entry.Info()
			if infoErr != nil {
				return infoErr
			}
			if !info.Mode().IsRegular() {
				return nil
			}

			rel, relErr := filepath.Rel(idx.root, path)
			if relErr != nil {
				return relErr
			}
			rel = filepath.ToSlash(rel)
			id := base64.RawURLEncoding.EncodeToString([]byte(rel))
			track := Track{
				ID:       id,
				Book:     bookName,
				Disc:     fmt.Sprintf("CD%d", cdNumber),
				Number:   trackNumber,
				FileName: entry.Name(),
				relPath:  rel,
			}
			if byBook[bookName] == nil {
				byBook[bookName] = make(map[int][]Track)
			}
			byBook[bookName][cdNumber] = append(byBook[bookName][cdNumber], track)
			return nil
		})
		if err != nil {
			return Library{}, nil, fmt.Errorf("scan %q: %w", bookName, err)
		}
	}

	bookNames := make([]string, 0, len(byBook))
	for name := range byBook {
		bookNames = append(bookNames, name)
	}
	sort.Slice(bookNames, func(i, j int) bool {
		order := func(name string) int {
			switch name {
			case "Pupil's Book":
				return 0
			case "Activity Book":
				return 1
			default:
				return 2
			}
		}
		if order(bookNames[i]) != order(bookNames[j]) {
			return order(bookNames[i]) < order(bookNames[j])
		}
		return strings.ToLower(bookNames[i]) < strings.ToLower(bookNames[j])
	})

	result := Library{Books: make([]Book, 0, len(bookNames))}
	trackMap := make(map[string]Track)
	for _, bookName := range bookNames {
		discNumbers := make([]int, 0, len(byBook[bookName]))
		for number := range byBook[bookName] {
			discNumbers = append(discNumbers, number)
		}
		sort.Ints(discNumbers)

		book := Book{Name: bookName, Discs: make([]Disc, 0, len(discNumbers))}
		for _, discNumber := range discNumbers {
			tracks := byBook[bookName][discNumber]
			sort.Slice(tracks, func(i, j int) bool {
				if tracks[i].Number != tracks[j].Number {
					return tracks[i].Number < tracks[j].Number
				}
				return tracks[i].FileName < tracks[j].FileName
			})
			for i := range tracks {
				trackMap[tracks[i].ID] = tracks[i]
			}
			disc := Disc{
				Name:   fmt.Sprintf("CD%d", discNumber),
				Number: discNumber,
				Count:  len(tracks),
				Tracks: tracks,
			}
			book.Count += len(tracks)
			book.Discs = append(book.Discs, disc)
		}
		result.Books = append(result.Books, book)
	}
	return result, trackMap, nil
}

func (idx *libraryIndex) refresh() (Library, error) {
	library, tracks, err := idx.scan()
	if err != nil {
		return Library{}, err
	}
	idx.mu.Lock()
	idx.tracks = tracks
	idx.mu.Unlock()
	return library, nil
}

func (idx *libraryIndex) track(id string) (Track, bool) {
	idx.mu.RLock()
	defer idx.mu.RUnlock()
	track, ok := idx.tracks[id]
	return track, ok
}

func main() {
	audioRoot := strings.TrimSpace(os.Getenv("AUDIO_DIR"))
	if audioRoot == "" {
		if _, err := os.Stat("/app/audios"); err == nil {
			audioRoot = "/app/audios"
		} else {
			audioRoot = "audios"
		}
	}
	audioRoot, err := filepath.Abs(audioRoot)
	if err != nil {
		log.Fatalf("resolve audio directory: %v", err)
	}

	index := &libraryIndex{root: audioRoot, tracks: make(map[string]Track)}
	library, err := index.refresh()
	if err != nil {
		log.Fatalf("audio directory %q is not ready: %v", audioRoot, err)
	}
	trackCount := 0
	for _, book := range library.Books {
		trackCount += book.Count
	}
	log.Printf("indexed %d tracks from %d books in %s", trackCount, len(library.Books), audioRoot)

	staticFS, err := fs.Sub(webFiles, "web")
	if err != nil {
		log.Fatalf("load web assets: %v", err)
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/library", func(w http.ResponseWriter, r *http.Request) {
		library, scanErr := index.refresh()
		if scanErr != nil {
			http.Error(w, "无法读取音频目录", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		if err := json.NewEncoder(w).Encode(library); err != nil {
			log.Printf("write library response: %v", err)
		}
	})
	mux.HandleFunc("GET /api/audio/{id}", func(w http.ResponseWriter, r *http.Request) {
		track, ok := index.track(r.PathValue("id"))
		if !ok {
			http.NotFound(w, r)
			return
		}
		fullPath := filepath.Join(index.root, filepath.FromSlash(track.relPath))
		file, openErr := os.Open(fullPath)
		if openErr != nil {
			http.NotFound(w, r)
			return
		}
		defer file.Close()
		info, statErr := file.Stat()
		if statErr != nil || !info.Mode().IsRegular() {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "audio/mpeg")
		w.Header().Set("Cache-Control", "private, max-age=300")
		http.ServeContent(w, r, track.FileName, info.ModTime(), file)
	})
	mux.Handle("GET /assets/", http.StripPrefix("/assets/", http.FileServer(http.FS(staticFS))))
	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		page, readErr := fs.ReadFile(staticFS, "index.html")
		if readErr != nil {
			http.Error(w, "界面文件不可用", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache")
		_, _ = w.Write(page)
	})

	port := strings.TrimSpace(os.Getenv("PORT"))
	if port == "" {
		port = "8080"
	}
	portNumber, err := strconv.Atoi(port)
	if err != nil || portNumber < 1 || portNumber > 65535 {
		log.Fatalf("invalid PORT %q", port)
	}

	server := &http.Server{
		Addr:              ":" + port,
		Handler:           securityHeaders(mux),
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	log.Printf("Power Up audio player listening on http://localhost:%s", port)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("http server: %v", err)
	}
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'")
		next.ServeHTTP(w, r)
	})
}
