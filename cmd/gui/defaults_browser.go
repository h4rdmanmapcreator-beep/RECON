//go:build !window

package main

// useWebViewByDefault controls whether the app opens in a native WebView2 window
// (true) or the system default browser (false).  The default browser build is
// the most compatible option — it works even on machines without the Edge
// WebView2 Runtime installed.
const useWebViewByDefault = false
