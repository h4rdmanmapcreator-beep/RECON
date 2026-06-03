//go:build window

package main

// useWebViewByDefault = true makes recon-window.exe open in a native WebView2
// window by default instead of launching the browser.
// Requires the Microsoft Edge WebView2 Runtime to be installed.
// Falls back to the default browser automatically if WebView2 is unavailable.
const useWebViewByDefault = true
