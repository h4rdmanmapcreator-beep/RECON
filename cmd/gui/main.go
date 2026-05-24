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
	"embed"
	"encoding/json"
	"flag"
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"

	inidata "github.com/bill-rich/cncstats/Data"
	"github.com/bill-rich/cncstats/pkg/bitparse"
	"github.com/bill-rich/cncstats/pkg/iniparse"
	"github.com/bill-rich/cncstats/pkg/zhreplay"
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
