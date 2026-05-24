//go:build !windows

package main

func openWebView(url string) bool { return false }
