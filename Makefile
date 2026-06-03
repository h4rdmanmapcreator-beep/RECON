.PHONY: test sync-tactics

test:
	go test -timeout=5m $(shell go list ./...)

# sync-tactics: keep pkg/detect/tactics/ in sync with detector/tactics/
# Run this whenever the TypeScript tactic JSON files are updated.
sync-tactics:
	cp detector/tactics/china.json pkg/detect/tactics/china.json
	cp detector/tactics/usa.json   pkg/detect/tactics/usa.json
	cp detector/tactics/gla.json   pkg/detect/tactics/gla.json
	@echo "Tactics synced. Run 'go build ./...' to embed the updated data."
