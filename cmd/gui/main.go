// Package main is a native-window GUI for browsing .rep replay files.
//
// It starts a tiny localhost HTTP server that uses the bundled INI data
// (embedded into the binary at build time) to parse replays, serves an
// embedded HTML page with an event timeline view, and opens it inside a
// WebView2 window. If WebView2 is unavailable on the target machine
// (e.g. an older Windows 10 install missing the Edge WebView2 Runtime),
// the GUI falls back to the user's default browser so the app still
// works without any external setup.
package main

import (
	"bytes"
	"embed"
	"encoding/json"
	"flag"
	"fmt"
	"image/png"
	"io/fs"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"runtime"
	"strings"

	inidata "github.com/bill-rich/cncstats/Data"
	"github.com/bill-rich/cncstats/pkg/bitparse"
	"github.com/bill-rich/cncstats/pkg/iniparse"
	"github.com/bill-rich/cncstats/pkg/zhreplay"
	"github.com/ftrvxmtrx/tga"
	log "github.com/sirupsen/logrus"
)

//go:embed static
var staticFS embed.FS

// loadEmbeddedStores builds the four iniparse stores entirely from the
// INI tree embedded into the binary. No disk access required.
func loadEmbeddedStores() (*iniparse.ObjectStore, *iniparse.PowerStore, *iniparse.UpgradeStore, *iniparse.ColorStore, error) {
	sub, err := fs.Sub(inidata.FS, "INI")
	if err != nil {
		return nil, nil, nil, nil, fmt.Errorf("embedded sub: %w", err)
	}
	o, err := iniparse.NewObjectStoreFS(sub)
	if err != nil {
		return nil, nil, nil, nil, fmt.Errorf("object store: %w", err)
	}
	p, err := iniparse.NewPowerStoreFS(sub)
	if err != nil {
		return nil, nil, nil, nil, fmt.Errorf("power store: %w", err)
	}
	u, err := iniparse.NewUpgradeStoreFS(sub)
	if err != nil {
		return nil, nil, nil, nil, fmt.Errorf("upgrade store: %w", err)
	}
	c, err := iniparse.NewColorStoreFS(sub)
	if err != nil {
		return nil, nil, nil, nil, fmt.Errorf("color store: %w", err)
	}
	return o, p, u, c, nil
}

func main() {
	addr := flag.String("addr", "127.0.0.1:0", "HTTP listen address (port 0 = pick free port)")
	webview := flag.Bool("webview", false, "Open in a native WebView2 window instead of the default browser (requires Edge WebView2 Runtime)")
	noOpen := flag.Bool("no-open", false, "Don't open anything; just print the URL and wait")
	flag.Parse()

	setupLogFile()
	log.Info("CnC Replay Browser starting")

	obj, pow, up, col, err := loadEmbeddedStores()
	if err != nil {
		log.WithError(err).Fatal("could not load bundled INI data")
	}
	log.Info("bundled INI data loaded")

	sub, err := fs.Sub(staticFS, "static")
	if err != nil {
		log.WithError(err).Fatal("embed sub")
	}

	mux := http.NewServeMux()
	mux.Handle("/", http.FileServer(http.FS(sub)))
	mux.HandleFunc("/parse", func(w http.ResponseWriter, r *http.Request) {
		handleParse(w, r, obj, pow, up, col)
	})
	mux.HandleFunc("/map/preview", handleMapPreview)

	l, err := net.Listen("tcp", *addr)
	if err != nil {
		log.WithError(err).Fatal("listen")
	}
	url := fmt.Sprintf("http://%s/", l.Addr().String())
	log.WithField("url", url).Info("GUI server ready")

	go func() {
		if err := http.Serve(l, mux); err != nil {
			log.WithError(err).Fatal("serve")
		}
	}()

	if *noOpen {
		fmt.Println("Open this URL:", url)
		select {}
	}

	// Default: open in the system default browser. Every Windows PC
	// has one, so this works without any external runtime (unlike
	// WebView2, which needs the Edge WebView2 Runtime installed).
	// The opt-in -webview flag is for when you specifically want a
	// native-feeling window and know WebView2 is available.
	if !*webview {
		openBrowser(url)
		select {}
	}

	if !openWebView(url) {
		log.Warn("WebView2 unavailable on this machine (Edge WebView2 Runtime missing?), falling back to default browser")
		openBrowser(url)
		select {}
	}
}

func handleParse(w http.ResponseWriter, r *http.Request, obj *iniparse.ObjectStore, pow *iniparse.PowerStore, up *iniparse.UpgradeStore, col *iniparse.ColorStore) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	if err := r.ParseMultipartForm(128 << 20); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	file, _, err := r.FormFile("file")
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	defer file.Close()

	bp := &bitparse.BitParser{
		Source:       file,
		ObjectStore:  obj,
		PowerStore:   pow,
		UpgradeStore: up,
		ColorStore:   col,
	}
	replay := zhreplay.NewReplay(bp)
	v2 := zhreplay.ConvertToBasicEnhancedReplayV2(replay)
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(v2); err != nil {
		log.WithError(err).Error("encode response")
	}
}

// handleMapPreview returns a PNG-encoded preview of the .tga that lives
// next to the user's local copy of the map (in their Documents tree).
// The browser can't render .tga directly, so we decode and re-encode
// here. Returns 404 if the map folder isn't present locally — that's
// the normal case for maps the user never downloaded.
func handleMapPreview(w http.ResponseWriter, r *http.Request) {
	name := strings.TrimSpace(r.URL.Query().Get("name"))
	// We deliberately keep an inner trailing space if the user sent one:
	// some custom maps have folder names like "[rank] vendetta zh v1 "
	// with a trailing space that is part of the actual directory name.
	// Strip leading/trailing whitespace introduced by URL handling but
	// re-attach a single trailing space if the raw query indicates one.
	if raw := r.URL.Query().Get("name"); strings.HasSuffix(raw, " ") && !strings.HasSuffix(name, " ") {
		name += " "
	}
	if name == "" {
		http.Error(w, "name query param required", http.StatusBadRequest)
		return
	}
	tgaPath, err := findMapTGA(name)
	if err != nil {
		http.NotFound(w, r)
		return
	}

	f, err := os.Open(tgaPath)
	if err != nil {
		log.WithError(err).WithField("path", tgaPath).Warn("could not open map preview")
		http.NotFound(w, r)
		return
	}
	defer f.Close()

	img, err := tga.Decode(f)
	if err != nil {
		log.WithError(err).WithField("path", tgaPath).Warn("could not decode tga")
		http.Error(w, "tga decode failed: "+err.Error(), http.StatusInternalServerError)
		return
	}

	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		log.WithError(err).Error("png encode failed")
		http.Error(w, "png encode failed", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Cache-Control", "public, max-age=3600")
	_, _ = w.Write(buf.Bytes())
}

// userMapsDir returns the canonical user maps directory on Windows.
// On other OSes it returns the closest equivalent under the home dir
// so the code at least compiles; map previews are realistically a
// Windows-only feature since ZH is a Windows game.
func userMapsDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, "Documents", "Command and Conquer Generals Zero Hour Data", "Maps"), nil
}

// findMapTGA looks for the .tga preview of a map by trying the most
// common layouts. The map name is the folder name as it appears on disk
// (which is usually the same as the .map file basename). Returns the
// absolute path to the .tga or an error if nothing matched.
func findMapTGA(name string) (string, error) {
	maps, err := userMapsDir()
	if err != nil {
		return "", err
	}
	// Reject obvious path-escape attempts. The map name is supposed to
	// be just a folder name, never a path with separators.
	if strings.ContainsAny(name, `\/`) || strings.Contains(name, "..") {
		return "", fmt.Errorf("invalid map name")
	}

	candidates := []string{
		filepath.Join(maps, name, name+".tga"),
		filepath.Join(maps, name, name+".TGA"),
		filepath.Join(maps, name+".tga"),
	}
	for _, c := range candidates {
		if st, err := os.Stat(c); err == nil && !st.IsDir() {
			return c, nil
		}
	}
	return "", fmt.Errorf("no preview found for %q", name)
}

// mapNameFromPath extracts the folder/basename of a map given a value
// from the replay header's MapPath field. The header value can be any
// of:
//
//	Maps\Tournament Desert\Tournament Desert.map  -> "Tournament Desert"
//	maps/tournament island                        -> "tournament island"
//	[rank] vendetta zh v1                         -> "[rank] vendetta zh v1"
//
// Currently unused on the server (the client extracts and passes the
// name directly) but kept here for documentation and future use.
var _ = mapNameFromPath

func mapNameFromPath(mapPath string) string {
	p := strings.ReplaceAll(mapPath, "\\", "/")
	p = strings.TrimSuffix(p, ".map")
	p = strings.TrimSuffix(p, ".MAP")
	base := path.Base(p)
	if base == "" || base == "." || base == "/" {
		return ""
	}
	return base
}

// setupLogFile redirects logrus to a file next to the executable so
// crashes are diagnosable even when the binary is built with
// -H windowsgui (no console). Falls back to stderr if the file can't
// be opened.
func setupLogFile() {
	exe, err := os.Executable()
	if err != nil {
		return
	}
	logPath := filepath.Join(filepath.Dir(exe), "cncstats-gui.log")
	f, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0644)
	if err != nil {
		log.WithError(err).Warn("could not open log file, keeping stderr")
		return
	}
	log.SetOutput(f)
	log.SetFormatter(&log.TextFormatter{FullTimestamp: true, DisableColors: true})
}

// openBrowser launches the OS default browser at url. Uses `cmd /c start`
// on Windows because it reliably dispatches via the registered protocol
// handler (more robust than rundll32 url.dll across Windows versions).
func openBrowser(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		// The empty "" is the start command's title arg; required when
		// the first quoted arg might otherwise be parsed as the title.
		cmd = exec.Command("cmd", "/c", "start", "", url)
	case "darwin":
		cmd = exec.Command("open", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	if err := cmd.Start(); err != nil {
		log.WithError(err).WithField("url", url).Error("could not open default browser")
	}
}
